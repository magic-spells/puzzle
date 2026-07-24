// Package plugin implements the esbuild onLoad plugin for *.pzl files
// (constellation/doc/DOC-COMPILER-DESIGN.md §b). Everything happens in memory, per file:
// read → SplitSections → codegen.Compile → return JS. Parse/codegen errors
// become esbuild api.Message values with file/line/col (§e) so the build fails
// with normal esbuild formatting; a file that fails to compile emits no output.
//
// <style> blocks are collected into a per-plugin, mutex-guarded map (esbuild
// runs onLoad concurrently across files) and joined deterministically — sorted
// by file path — into a single global CSS string via CSS().
package plugin

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// Plugin owns the cross-file state of one build: the app root (used to derive
// stable, app-relative filenames for error reporting and the D20 emission-mode
// decision) and the thread-safe <style> collector.
type Plugin struct {
	appRoot   string
	assetsDir string // <appRoot>/app/assets — {#svg} paths resolve from here (D46)

	mu          sync.Mutex
	css         map[string]string // keyed by absolute file path for deterministic ordering
	formatters  map[string]bool
	hasFlip     bool
	hasHeadTags bool
	runtimeDir  string
}

// New creates a Plugin rooted at the app directory (the directory containing
// app/app.js). appRoot should be absolute. The root is symlink-resolved up
// front so relName() compares like with like: esbuild reports args.Path with
// symlinks resolved, and an unresolved root (macOS /var → /private/var, a
// symlinked project dir) would make filepath.Rel fall back to the absolute
// path — hashing a machine-specific string into ScopeID (D59 byte-stability).
func New(appRoot string) *Plugin {
	appRoot = resolveSymlinks(appRoot)
	return &Plugin{
		appRoot:    appRoot,
		assetsDir:  filepath.Join(appRoot, "app", "assets"),
		css:        map[string]string{},
		formatters: map[string]bool{"escape": true},
	}
}

// ESBuild returns the api.Plugin to register in BuildOptions.Plugins.
func (p *Plugin) ESBuild() api.Plugin {
	return api.Plugin{
		Name:  "puzzle-pzl",
		Setup: p.setup,
	}
}

func (p *Plugin) setup(build api.PluginBuild) {
	// {#svg} dedup virtual modules (D46 amendment) — resolve/serve one shared
	// factory module per unique asset so esbuild stores each icon once.
	p.setupSVGAssets(build)

	build.OnResolve(api.OnResolveOptions{Filter: "^" + ManifestSpecifier + "$"}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
		return api.OnResolveResult{
			Path:      args.Path,
			Namespace: manifestNamespace,
		}, nil
	})

	build.OnLoad(api.OnLoadOptions{Filter: ".*", Namespace: manifestNamespace}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
		out, err := p.formatterManifest()
		if err != nil {
			return api.OnLoadResult{Errors: []api.Message{{Text: err.Error()}}}, nil
		}
		p.mu.Lock()
		resolveDir := p.runtimeDir
		p.mu.Unlock()
		loader := api.LoaderJS
		return api.OnLoadResult{
			Contents:   &out,
			Loader:     loader,
			ResolveDir: resolveDir,
		}, nil
	})

	build.OnLoad(api.OnLoadOptions{Filter: `\.pzl$`}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
		src, err := os.ReadFile(args.Path)
		if err != nil {
			// A genuine I/O error is a hard failure, not a positioned
			// compile error.
			return api.OnLoadResult{}, err
		}

		// App-relative filename: drives ModeForPath (app/views, app/layouts →
		// view mode) and makes error locations readable. Fall back to the
		// absolute path if it is somehow outside the root.
		name := p.relName(args.Path)

		sec, serr := parser.SplitSections(string(src), name)
		if serr != nil {
			return api.OnLoadResult{Errors: toMessages(serr, name)}, nil
		}

		res, cerr := codegen.Compile(sec, codegen.Options{
			Filename: name,
			Mode:     codegen.ModeForPath(name),
			// The app-relative name is also the module stamp (D81): view/layout
			// classes carry Class.__pzlModule so the static-pages build can map a
			// route back to its source .pzl for per-page entry generation.
			ModulePath: name,
			AssetsDir:  p.assetsDir,
			// Bundled builds dedup {#svg} into shared virtual modules (D46
			// amendment); the standalone pzlc path leaves this off and inlines.
			SVGDedup: true,
		})
		if cerr != nil {
			// Never emit partial output for a failed file (§e). WatchFiles still
			// carries any {#svg} paths seen (incl. a missing one) so esbuild
			// invalidates this cached failure once the file appears (D46).
			return api.OnLoadResult{
				Errors:     toMessages(cerr, name),
				WatchFiles: res.InlinedFiles,
			}, nil
		}
		out := res.JS

		// Out-of-band codegen warnings (e.g. a template expression referencing a
		// <script> import). The bundle build runs at LogLevelSilent, so print
		// directly to stderr rather than routing through esbuild's suppressed
		// warning channel; the generated JS is unaffected.
		for _, w := range res.Warnings {
			fmt.Fprintf(os.Stderr, "%s:%d:%d: warning: %s\n", w.File, w.Line, w.Col, w.Message)
		}

		// Set-or-delete keeps the collector correct across incremental rebuilds
		// (the persistent dev api.Context reuses one Plugin — see build.WatchBuilder):
		// a file edited to REMOVE its <style> must drop its old entry, not keep
		// the stale block. onLoad re-runs for every changed file, so this fires
		// whenever a .pzl's styles appear or disappear. Deleted files (whose
		// onLoad never re-runs) are pruned separately in CSS().
		p.mu.Lock()
		if sec.HasStyles {
			body := sec.Styles
			if sec.StylesScoped {
				// Scoped styles (v1.27, D59): wrap the verbatim block in a native
				// @scope rule keyed by the SAME scope id codegen stamped on the root
				// (codegen.ScopeID over the same app-relative `name`), so the rule and
				// the data-<scopeId> attribute always agree. Aggregation/sorting/
				// pruning and the Tailwind pipeline are untouched — @scope is plain CSS.
				body = "@scope ([data-" + codegen.ScopeID(name) + "]) {\n" + body + "\n}"
			}
			p.css[args.Path] = body
		} else {
			delete(p.css, args.Path)
		}
		p.mu.Unlock()

		// TypeScript scripts (v1.22, D54): <script lang="ts"> marks the whole
		// generated module TS so esbuild strips types (transpile-only, like Vite).
		// The injected render tail + runtime import are plain JS, which is valid TS,
		// so one loader covers the mixed module. Absent lang → LoaderJS, byte-for-byte
		// as before.
		loader := api.LoaderJS
		if sec.ScriptsLang == "ts" {
			loader = api.LoaderTS
		}
		return api.OnLoadResult{
			Contents:   &out,
			Loader:     loader,
			ResolveDir: filepath.Dir(args.Path),
			// WatchFiles = {#svg}-inlined files: esbuild's incremental context caches
			// OnLoad results, so an edit to an inlined svg would otherwise not rebuild
			// this .pzl. Listing them invalidates the cache on the next Rebuild (D46).
			WatchFiles: res.InlinedFiles,
		}, nil
	})
}

// CSS returns every collected <style> block, sorted by source file path and
// joined with blank lines. v1 emits global CSS with no scoping.
func (p *Plugin) CSS() string {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Prune styles from files that no longer exist. Under an incremental dev
	// rebuild (build.WatchBuilder) a deleted .pzl's onLoad never re-runs, so its
	// entry would otherwise linger; a fresh one-shot build.Build starts with an
	// empty map and never hits this. (A file that still exists but was un-imported
	// is not pruned here — a rare case outside the "deleted file" contract.)
	for path := range p.css {
		if _, err := os.Stat(path); err != nil {
			delete(p.css, path)
		}
	}

	paths := make([]string, 0, len(p.css))
	for path := range p.css {
		paths = append(paths, path)
	}
	sort.Strings(paths)

	var b strings.Builder
	for _, path := range paths {
		block := strings.TrimSpace(p.css[path])
		if block == "" {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(block)
	}
	if b.Len() > 0 {
		b.WriteString("\n")
	}
	return b.String()
}

// PruneCSS drops collected <style> entries whose source .pzl is not in keep,
// the set of absolute source paths in the current module graph (derived from the
// esbuild metafile after a successful incremental rebuild). This catches the one
// case CSS()'s os.Stat prune cannot: a file still on disk but no longer imported,
// whose onLoad never re-runs so its stale block would otherwise linger.
//
// Both sides are symlink-resolved before comparison so a keep-set path computed
// from a cwd-relative metafile key matches a css key set from esbuild's resolved
// args.Path even when a symlinked prefix (macOS /tmp → /private/tmp) differs.
func (p *Plugin) PruneCSS(keep map[string]bool) {
	resolved := make(map[string]bool, len(keep))
	for path := range keep {
		resolved[resolveSymlinks(path)] = true
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	for path := range p.css {
		if !resolved[resolveSymlinks(path)] {
			delete(p.css, path)
		}
	}
}

// resolveSymlinks returns path with symlinks resolved, or path unchanged if it
// cannot be resolved (e.g. it no longer exists) — fail-soft so a transient stat
// error never corrupts the comparison.
func resolveSymlinks(path string) string {
	if r, err := filepath.EvalSymlinks(path); err == nil {
		return r
	}
	return path
}

// relName renders an app-root-relative, forward-slashed path for a .pzl file.
// The incoming path is symlink-resolved to match the resolved appRoot (see
// New) — Rel over a mixed resolved/unresolved pair yields `..`-prefixed junk.
func (p *Plugin) relName(path string) string {
	if p.appRoot != "" {
		if rel, err := filepath.Rel(p.appRoot, resolveSymlinks(path)); err == nil && !strings.HasPrefix(rel, "..") {
			return filepath.ToSlash(rel)
		}
	}
	return filepath.ToSlash(path)
}

// toMessages converts a parser/codegen error into esbuild messages — one
// message per ParseError, batching an ErrorList (§e).
func toMessages(err error, fallbackFile string) []api.Message {
	switch e := err.(type) {
	case parser.ErrorList:
		msgs := make([]api.Message, 0, len(e))
		for _, pe := range e {
			msgs = append(msgs, peMessage(pe, fallbackFile))
		}
		if len(msgs) == 0 {
			return []api.Message{{Text: err.Error()}}
		}
		return msgs
	case *parser.ParseError:
		return []api.Message{peMessage(e, fallbackFile)}
	default:
		return []api.Message{{Text: err.Error()}}
	}
}

// peMessage maps a *parser.ParseError to an api.Message. ParseError columns are
// 1-based; esbuild Location.Column is 0-based in bytes.
func peMessage(pe *parser.ParseError, fallbackFile string) api.Message {
	file := pe.File
	if file == "" {
		file = fallbackFile
	}
	col := pe.Col - 1
	if col < 0 {
		col = 0
	}
	msg := api.Message{
		Text: pe.Message,
		Location: &api.Location{
			File:   file,
			Line:   pe.Line,
			Column: col,
		},
	}
	if pe.Note != "" {
		msg.Notes = []api.Note{{Text: pe.Note}}
	}
	return msg
}
