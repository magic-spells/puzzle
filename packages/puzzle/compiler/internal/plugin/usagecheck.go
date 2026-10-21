package plugin

// usagecheck.go — the per-file check behind the usage scan (DECISION-D89).
//
// The defines and the formatter manifest are fixed before a pass from what
// the scan read. The .pzl OnLoad compiles whatever the app imports, which can
// include a .pzl the scan never read: a package that does not declare
// Puzzle, a file under a pruned directory, a folder linked in from outside
// every node_modules. Such a file's features are compiled out, and before this
// check the first anyone heard of it was a production-only throw ("#html
// reached the DOM") or a function rendering through the missing-name guard.
//
// So OnLoad records the usage of every compiled .pzl the scan did not read,
// keyed by path like the <style> collector (an incremental context caches
// OnLoad results, so the record has to outlive the pass that made it), and an
// OnEnd callback fails the pass when any recorded file needs a feature or a
// library function this pass compiled out. The check costs nothing for files
// the scan read: their usage is already in the bits.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

// noteCompiled records (or forgets) one successfully compiled .pzl for the
// check. p.mu must NOT be held.
func (p *Plugin) noteCompiled(path string, src []byte) {
	p.mu.Lock()
	active := p.usageSet
	scanned := p.scanned[path] || p.scanned[resolveSymlinks(path)]
	if !active || scanned {
		delete(p.unscanned, path)
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()

	allow, err := builtinAllowlist()
	if err != nil {
		return
	}
	fu := fileUsageFromSource(p.appRoot, path, string(src), allow)
	p.mu.Lock()
	p.unscanned[path] = fu
	p.mu.Unlock()
}

// checkUsageOnEnd is the OnEnd half: it runs after every pass, incremental
// rebuilds included, and adds one error per unscanned file whose features are
// off. A pass that already failed is left alone — its graph is incomplete, and
// the check runs again on the pass that succeeds.
func (p *Plugin) checkUsageOnEnd(workDir string) func(*api.BuildResult) (api.OnEndResult, error) {
	return func(result *api.BuildResult) (api.OnEndResult, error) {
		if len(result.Errors) > 0 {
			return api.OnEndResult{}, nil
		}
		var graph map[string]bool
		if result.Metafile != "" {
			graph = metafilePZL(result.Metafile, workDir)
		}
		return api.OnEndResult{Errors: p.featureMismatches(graph)}, nil
	}
}

// featureMismatches returns an error for each recorded file whose usage needs a
// feature bit or a library function the current Usage left out. graph, when
// non-nil, is this pass's module graph: a file no longer imported is dropped
// rather than reported (its cached OnLoad record would otherwise outlive the
// import).
func (p *Plugin) featureMismatches(graph map[string]bool) []api.Message {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.usageSet {
		return nil
	}
	paths := make([]string, 0, len(p.unscanned))
	for path := range p.unscanned {
		if graph != nil && !graph[path] && !graph[resolveSymlinks(path)] {
			delete(p.unscanned, path)
			continue
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)

	var msgs []api.Message
	for _, path := range paths {
		missing := p.missingLocked(p.unscanned[path])
		if len(missing) == 0 {
			continue
		}
		msgs = append(msgs, usageMismatchMessage(p.relName(path), missing, p.mismatchHint(path)))
	}
	return msgs
}

// missingLocked lists what fu needs that this pass compiled out, in a stable
// order. lazy() is deliberately absent: it is a route-table fact read from the
// app's scripts, and the text match that finds it would fail builds over a
// package template that merely mentions the word.
func (p *Plugin) missingLocked(fu fileUsage) []string {
	f := p.features
	var out []string
	switch {
	case fu.hasRawSan && (!f.RawHTML || !f.RawSanitize):
		out = append(out, "raw()")
	case fu.hasRawHTML && !f.RawHTML:
		out = append(out, "newline_to_br()")
	}
	if fu.hasFlip && !f.Flip {
		out = append(out, "the flip attribute")
	}
	if fu.hasPortal && !f.Portal {
		out = append(out, "<Portal>")
	}
	if fu.hasRawAt && !f.RawAt {
		out = append(out, "a {#raw} block")
	}
	if fu.hasSnippets && !f.Snippets {
		out = append(out, "snippets")
	}
	if fu.hasComponentSlot && !f.ComponentSlot {
		out = append(out, "<Component>")
	}
	if fu.hasCondSlot && !f.ConditionalSlot {
		out = append(out, "a conditional <Slot/>")
	}
	var fns []string
	for _, name := range fu.formatters {
		// `t` is service-bound and configured, never a manifest entry (D175).
		if name != TranslateFormatter && !p.formatters[name] {
			fns = append(fns, name+"()")
		}
	}
	sort.Strings(fns)
	return append(out, fns...)
}

func usageMismatchMessage(name string, missing []string, hint string) api.Message {
	return api.Message{
		Text: fmt.Sprintf("this .pzl uses %s, which this build compiled out: the usage scan never read the file", strings.Join(missing, ", ")),
		Location: &api.Location{
			File: name,
			Line: 1,
		},
		Notes: []api.Note{
			{Text: hint},
			{Text: "A running `puzzle dev` reads installed packages at startup: restart it after installing or changing a package."},
		},
	}
}

// mismatchHint picks the fix for one unscanned file. A file inside
// node_modules, or outside the project root (an npm-linked checkout), belongs
// to the package whose manifest sits nearest above it: when that manifest does
// not declare Puzzle, declaring it is the fix; when it already does, the file
// sits where the package walk does not read (an app, a root-level example or
// test folder, a package the walk cannot reach). A project file outside both
// walks must move.
func (p *Plugin) mismatchHint(path string) string {
	const move = "Move it under the project root, outside node_modules, dist/, build/, vendor/ and dot-directories, so the usage scan reads it."
	real := resolveSymlinks(path)
	inPackages := strings.Contains(filepath.ToSlash(real), "/node_modules/")
	outside := p.appRoot != "" && !strings.HasPrefix(real, p.appRoot+string(filepath.Separator))
	if !inPackages && !outside {
		return move
	}
	manifest := nearestManifest(filepath.Dir(real), p.appRoot)
	if manifest == "" {
		if inPackages {
			return `Its package has no package.json: give it one that lists "@magic-spells/puzzle" in peerDependencies so the usage scan reads its .pzl files.`
		}
		return move
	}
	owner := filepath.ToSlash(manifest)
	if !manifestDeclaresPuzzle(manifest) {
		return fmt.Sprintf(`Its package (%s) does not declare Puzzle: add "@magic-spells/puzzle" to that package's peerDependencies so the usage scan reads its .pzl files.`, owner)
	}
	return fmt.Sprintf("Its package (%s) declares Puzzle, but the usage scan does not read this file: it skips apps (a puzzle.config.js outside node_modules), example/, examples/, test/, tests/ and __tests__/ at a package root, and packages outside every node_modules the project resolves from. Import the component from the package's shipped source, or install the package so node_modules reaches it.", owner)
}

// nearestManifest returns the package.json nearest above dir, or "" when the
// search reaches appRoot (the app's own manifest is not a package's) or the
// filesystem root.
func nearestManifest(dir, appRoot string) string {
	for {
		if dir == appRoot {
			return ""
		}
		candidate := filepath.Join(dir, "package.json")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// metafilePZL returns the absolute .pzl inputs of an esbuild metafile, whose
// keys are relative to the pass's working directory.
func metafilePZL(metafileJSON, workDir string) map[string]bool {
	var mf struct {
		Inputs map[string]json.RawMessage `json:"inputs"`
	}
	if err := json.Unmarshal([]byte(metafileJSON), &mf); err != nil {
		return nil
	}
	if workDir == "" {
		workDir, _ = os.Getwd()
	}
	out := make(map[string]bool, len(mf.Inputs))
	for key := range mf.Inputs {
		if !strings.HasSuffix(key, ".pzl") {
			continue
		}
		path := filepath.FromSlash(key)
		if !filepath.IsAbs(path) {
			path = filepath.Join(workDir, path)
		}
		out[path] = true
		out[resolveSymlinks(path)] = true
	}
	return out
}
