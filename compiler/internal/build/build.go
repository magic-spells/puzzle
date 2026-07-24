// Package build drives a full `puzzle build` (constellation/doc/DOC-COMPILER-DESIGN.md §b): one
// esbuild api.Build pass over app/app.js with the .pzl plugin registered, then
// the collected global CSS and the static public/ assets are written next to
// the bundle. It replaces the Phase 1 prototype orchestrator (internal/compiler,
// deleted): no intermediate files, no runtime concatenation — the runtime is a
// package esbuild resolves and bundles.
package build

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// Options configure a build.
type Options struct {
	// Development disables minification (readable output for debugging and the
	// compiled-fixture test). Production (the default, Development=false) minifies.
	Development bool

	// Runner runs the Tailwind pipeline when puzzle.config.js declares it. Left
	// nil, the real npx-backed runner is used; tests inject a fake. It is only
	// consulted when a config actually enables Tailwind.
	Runner styles.Runner

	// Output is the prerender mode requested on the CLI: "" (no flag), "static"
	// (the true static-pages mode, `--static`), or "hybrid" (prerender + SPA
	// takeover, `--hybrid`). It is reconciled with puzzle.config.js `output` in
	// Build: a flag and a *different* config value is an error; either one alone
	// (or agreeing) selects the mode. Empty on both sides is the default SPA build.
	Output string
}

// Build compiles the app rooted at root (the directory containing app/app.js)
// into root/dist. It returns a formatted error if esbuild reports any errors.
func Build(root string, opts Options) error {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolving app root: %w", err)
	}

	entry := filepath.Join(absRoot, "app", "app.js")
	if _, err := os.Stat(entry); err != nil {
		return fmt.Errorf("entry point not found: %s (expected app/app.js under %s)", entry, absRoot)
	}
	outdir := filepath.Join(absRoot, "dist")

	// Load puzzle.config.js ONCE for the whole build: it drives both the
	// console-stripping decision below and the Tailwind step, so loading it here
	// (rather than inside runTailwind) avoids a second node invocation per build.
	// No config file is not an error. A malformed one now fails the build up
	// front, BEFORE the stale-dist prune — previously runTailwind surfaced it
	// only after the last good dist/ had already been cleared.
	cfg, err := config.LoadConfig(absRoot)
	if err != nil {
		return err
	}

	// Reject a public/ tree that would clobber compiler output BEFORE touching
	// dist/ — a config error must never destroy the last good build.
	if err := ValidatePublic(absRoot); err != nil {
		return err
	}

	// Build into a temporary STAGING dir and swap it in for dist/ only after
	// esbuild, the styles pipeline, AND public copying all succeed. Previously
	// dist/ was wiped up front, so ANY .pzl compile error (or a Tailwind failure)
	// left the last good build as an EMPTY directory. Staging closes that hole: on
	// any failure below, dist/ is left exactly as it was.
	//
	// The staging dir is a sibling of dist/ under the app root (via MkdirTemp in
	// absRoot), so the final rename is same-filesystem (atomic, no cross-device
	// copy). Building from scratch each time also prunes stale output for free — a
	// since-removed public asset or a deleted view's chunk cannot linger, since the
	// swapped-in tree only ever contains what this build produced.
	//
	// One-shot path only: the incremental dev/watch path (watch.go) deliberately
	// keeps dist warm and rebuilds in place — it is untouched here.
	staging, err := os.MkdirTemp(absRoot, ".dist-staging-*")
	if err != nil {
		return fmt.Errorf("creating build staging dir under %s: %w", absRoot, err)
	}
	// MkdirTemp creates the dir 0700; dist/ is conventionally 0755 (it may be
	// served directly), so match that after the swap-in.
	_ = os.Chmod(staging, 0o755)
	swapped := false
	defer func() {
		// Leave nothing behind on failure (and on the success path the rename has
		// already consumed staging, so RemoveAll is a harmless no-op).
		if !swapped {
			os.RemoveAll(staging)
		}
	}()

	pl := plugin.New(absRoot)
	if err := scanUsage(absRoot, pl); err != nil {
		return err
	}

	buildOpts := newBundleOptions(absRoot, entry, staging, pl, opts.Development)
	// Salvaged from the prototype's BuildOptions block (compiler.go): the same
	// minify toggles, flipped to on-by-default (production) with --mode
	// development turning them off.
	if !opts.Development {
		buildOpts.MinifyWhitespace = true
		buildOpts.MinifyIdentifiers = true
		buildOpts.MinifySyntax = true
		// Linked source maps are an explicit production opt-in. Development
		// retains the shared options' existing linked-map behavior.
		if cfg.Build.SourceMap {
			buildOpts.Sourcemap = api.SourceMapLinked
		}
		// Strip console.* diagnostics from production bundles only (~570 B gzip),
		// unless puzzle.config.js opts out with build.dropConsole: false. The
		// framework's runtime advisory warnings are dev-mode-only by design — dev
		// builds keep every console.* call intact regardless of this setting.
		if cfg.DropConsole() {
			buildOpts.Drop = api.DropConsole
		}
	}

	result := api.Build(buildOpts)
	if len(result.Errors) > 0 {
		lines := api.FormatMessages(result.Errors, api.FormatMessagesOptions{
			Kind:          api.ErrorMessage,
			Color:         ui.New(os.Stderr).Enabled(),
			TerminalWidth: 0,
		})
		return fmt.Errorf("puzzle build failed:\n%s", strings.Join(lines, "\n"))
	}

	// Styles → one global stylesheet (index.html links /styles.css): the
	// Tailwind layer (when puzzle.config.js declares it) followed by the
	// collected <style> blocks. A declared-but-unrunnable Tailwind fails the
	// build — the pipeline is never silently skipped. Written into staging, not
	// dist/, so a Tailwind failure above never touches the last good build.
	tailwindCSS, err := runTailwind(absRoot, cfg, opts)
	if err != nil {
		return err
	}
	final := styles.Compose(tailwindCSS, pl.CSS())
	if err := os.WriteFile(filepath.Join(staging, "styles.css"), []byte(final), 0o644); err != nil {
		return fmt.Errorf("writing styles.css: %w", err)
	}

	// Static assets: index.html and anything else under the app's public/ dir,
	// copied into staging. The copied set is only useful to the incremental dev
	// path (deletion mirroring); the one-shot build starts from an empty staging
	// tree, so stale outputs simply never make it in.
	if _, err := copyPublic(absRoot, staging); err != nil {
		return fmt.Errorf("copying public assets: %w", err)
	}

	// Prerender modes (D67 hybrid / D81 static): render each route inside staging,
	// AFTER the shell (public/index.html) has been copied in — the prerender
	// injects into it — and BEFORE the swap, so a prerender failure discards
	// staging and leaves the last good dist/ untouched (same guarantee as a
	// compile failure). The effective mode reconciles the CLI flag with
	// puzzle.config.js `output`.
	mode, err := resolveOutputMode(opts.Output, cfg)
	if err != nil {
		return err
	}
	switch mode {
	case "hybrid":
		if err := prerenderHybrid(absRoot, staging); err != nil {
			return err
		}
	case "static":
		if err := prerenderStaticPages(absRoot, staging, cfg, opts.Development); err != nil {
			return err
		}
		if !opts.Development && !cfg.Build.SourceMap {
			if err := removeStaticSourceMaps(filepath.Join(staging, staticPagesDir)); err != nil {
				return fmt.Errorf("disabling static source maps: %w", err)
			}
		}
	}

	// Everything succeeded — swap staging in for dist/. Guard the replace so only
	// the computed absRoot/dist path is ever moved, never the app root or an
	// unexpected location. The previous dist is renamed aside first; if installing
	// staging fails, swapOutput restores it instead of leaving the app buildless.
	if filepath.Dir(outdir) != absRoot || filepath.Base(outdir) != "dist" {
		return fmt.Errorf("refusing to replace unexpected dist path: %s", outdir)
	}
	if err := swapOutput(staging, outdir); err != nil {
		return err
	}
	swapped = true

	return nil
}

// resolveOutputMode reconciles the CLI --static/--hybrid flag (flag ∈ {"",
// "static", "hybrid"}) with puzzle.config.js `output`. A flag combined with a
// DIFFERENT config value is a hard error naming both; otherwise the non-empty
// side wins (they agree when both are set). Empty on both sides is the default
// SPA build.
func resolveOutputMode(flag string, cfg config.Config) (string, error) {
	cfgOut := cfg.Output
	if flag != "" && cfgOut != "" && flag != cfgOut {
		return "", fmt.Errorf(
			"puzzle build --%s conflicts with output: '%s' in %s — pass --%s, or change the config output key",
			flag, cfgOut, config.ConfigFileName, cfgOut,
		)
	}
	if flag != "" {
		return flag, nil
	}
	return cfgOut, nil
}

// removeStaticSourceMaps removes linked-map sidecars and their trailing
// sourceMappingURL comments from the true-static browser output tree. Applying
// the production opt-out after that separate browser pass keeps development
// behavior and the temporary inline-mapped Node prerender bundle unchanged.
func removeStaticSourceMaps(outdir string) error {
	if _, err := os.Stat(outdir); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	const sourceMapComment = "\n//# sourceMappingURL="
	return filepath.WalkDir(outdir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".js.map") {
			return os.Remove(path)
		}
		if filepath.Ext(entry.Name()) != ".js" {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		js := string(data)
		idx := strings.LastIndex(js, sourceMapComment)
		if idx < 0 {
			return nil
		}
		return os.WriteFile(path, []byte(js[:idx+1]), 0o644)
	})
}

// swapOutput durably replaces outdir with staging. An existing output is moved
// to a randomly named sibling first, keeping the last good build recoverable
// until staging has landed. If that second rename fails, the old output is put
// back; after success the old sibling is removed.
func swapOutput(staging, outdir string) error {
	switch _, err := os.Lstat(outdir); {
	case os.IsNotExist(err):
		if err := os.Rename(staging, outdir); err != nil {
			return fmt.Errorf("finalizing dist %s: %w", outdir, err)
		}
		return nil
	case err != nil:
		return fmt.Errorf("checking dist %s: %w", outdir, err)
	}

	parent := filepath.Dir(outdir)
	old, err := os.MkdirTemp(parent, filepath.Base(outdir)+".old-*")
	if err != nil {
		return fmt.Errorf("reserving previous dist path beside %s: %w", outdir, err)
	}
	if err := os.Remove(old); err != nil {
		return fmt.Errorf("preparing previous dist path %s: %w", old, err)
	}
	if err := os.Rename(outdir, old); err != nil {
		return fmt.Errorf("preserving previous dist %s: %w", outdir, err)
	}
	if err := os.Rename(staging, outdir); err != nil {
		if restoreErr := os.Rename(old, outdir); restoreErr != nil {
			return fmt.Errorf("finalizing dist %s: %v (restoring previous dist from %s also failed: %v)", outdir, err, old, restoreErr)
		}
		return fmt.Errorf("finalizing dist %s: %w", outdir, err)
	}
	if err := os.RemoveAll(old); err != nil {
		return fmt.Errorf("removing previous dist %s: %w", old, err)
	}
	return nil
}

// runTailwind runs the Tailwind pipeline when cfg enables it and returns the
// generated CSS. Tailwind not declared returns "" with no error and never
// invokes the runner. cfg is loaded once by Build and threaded in, so node is
// not evaluated a second time per build.
func runTailwind(absRoot string, cfg config.Config, opts Options) (string, error) {
	if !cfg.TailwindEnabled() {
		return "", nil
	}
	runner := opts.Runner
	if runner == nil {
		runner = styles.NpxRunner{}
	}
	css, err := runner.Run(styles.RunOptions{
		AppRoot:    absRoot,
		Input:      styles.DefaultInput(absRoot),
		Production: !opts.Development,
	})
	if err != nil {
		return "", err
	}
	return css, nil
}

// reservedOutputNames are the root-level filenames the compiler itself writes
// into dist/. A public/ asset with one of these names at the ROOT of the public
// tree would silently overwrite compiler output, so it is rejected up front (see
// ValidatePublic). Nested files with these names (public/vendor/app.js) are fine.
// Keys are lowercase — the ValidatePublic lookup folds case so an App.js /
// STYLES.CSS still collides on the case-insensitive filesystems macOS and
// Windows default to (where dist/ would be clobbered just the same).
var reservedOutputNames = map[string]bool{
	"app.js":     true,
	"app.js.map": true,
	"styles.css": true,
}

// PublicDir returns the resolved static-assets source directory (app/public,
// else a root-level public/), or "" if neither exists. Exported so `puzzle dev`
// can watch a root-level public/ tree that lies OUTSIDE the watched app/ dir
// (app/public is already inside it). It delegates to the same resolver the
// copier uses, so the watched dir and the copied dir never diverge.
func PublicDir(root string) string {
	return publicDir(root)
}

// publicDir returns the app's static-assets source directory, or "" if none.
// The examples keep assets under app/public/; a flat public/ at the root is also
// honored (app/public/ wins when both exist).
func publicDir(root string) string {
	src := filepath.Join(root, "app", "public")
	if dirExists(src) {
		return src
	}
	src = filepath.Join(root, "public")
	if dirExists(src) {
		return src
	}
	return ""
}

// ValidatePublic reports an error if the app's public/ tree contains a
// ROOT-LEVEL file whose name collides with a reserved compiler output
// (app.js, app.js.map, styles.css). Such a file would be copied over the
// bundle/stylesheet the build just produced. Nested occurrences are allowed. It
// is exported so `puzzle dev` (a separate package) can revalidate on every
// incremental rebuild. No public/ dir is not an error.
func ValidatePublic(root string) error {
	src := publicDir(root)
	if src == "" {
		return nil
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return fmt.Errorf("reading public assets: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if reservedOutputNames[strings.ToLower(name)] {
			return fmt.Errorf(
				"public asset %s would overwrite compiler output dist/%s (%s is a reserved output name); rename or remove it",
				filepath.Join(src, name), name, name,
			)
		}
	}
	return nil
}

// copyPublic copies the app's static assets into dist and returns the set of
// dist-relative paths (slash-separated, files only) it wrote this pass. The
// examples/todos keeps them under app/public/; a flat public/ at the root is
// also honored. The returned set lets the incremental dev path mirror
// deletions across rebuilds (WatchBuilder.Rebuild); the one-shot build ignores
// it (it starts from a freshly-wiped dist). Compiler outputs (app.js,
// app.js.map, styles.css) are never produced here, so they never appear in the
// set — a mirror built from it can never delete a build output.
func copyPublic(root, outdir string) (map[string]bool, error) {
	copied := make(map[string]bool)
	src := publicDir(root)
	if src == "" {
		return copied, nil // nothing to copy is not an error
	}
	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(outdir, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		// Atomic write: in the dev fallback path this rewrites dist/index.html
		// while the server may be serving it, so avoid the truncate-then-write
		// window that could hand a client a partial file.
		if err := fsutil.WriteFileAtomic(target, data, 0o644); err != nil {
			return err
		}
		copied[filepath.ToSlash(rel)] = true
		return nil
	})
	return copied, err
}

// FindRuntime walks up from start looking for the in-repo runtime: a directory
// holding client-runtime/index.js whose package.json is named
// "@magic-spells/puzzle". Returns the absolute path to index.js, or "" if none.
func FindRuntime(start string) string {
	dir, err := filepath.Abs(start)
	if err != nil {
		dir = start
	}
	for {
		idx := filepath.Join(dir, "client-runtime", "index.js")
		if fsutil.FileExists(idx) && PkgIsPuzzle(filepath.Join(dir, "package.json")) {
			return idx
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// FindInstalledRuntime walks up from start for an installed Puzzle runtime and
// returns the absolute path to its client-runtime/index.js, or "" if absent.
func FindInstalledRuntime(start string) string {
	dir, err := filepath.Abs(start)
	if err != nil {
		dir = start
	}
	for {
		idx := filepath.Join(dir, "node_modules", "@magic-spells", "puzzle", "client-runtime", "index.js")
		if fsutil.FileExists(idx) {
			return idx
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// PkgIsPuzzle reports whether pkgPath is a package.json for
// "@magic-spells/puzzle".
func PkgIsPuzzle(pkgPath string) bool {
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return false
	}
	var pkg struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}
	return pkg.Name == "@magic-spells/puzzle"
}

// FileExists exposes the build package's historical file probe while sharing
// its implementation with the rest of the compiler.
func FileExists(path string) bool {
	return fsutil.FileExists(path)
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
