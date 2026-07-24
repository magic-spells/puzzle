package build

import (
	"fmt"
	"path/filepath"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

// newBundleOptions assembles the shared esbuild BuildOptions. `dev` selects the
// __PUZZLE_DEV__ define: "true" for development builds (the watch/dev loop is
// always dev), "false" for production, where MinifySyntax DCEs every guarded
// branch so the runtime's HMR machinery costs zero production bytes (§27, D57).
func newBundleOptions(absRoot, entry, outdir string, pl *plugin.Plugin, dev bool) api.BuildOptions {
	// The runtime reads __PUZZLE_DEV__ through a `typeof` probe, so the define
	// must be a boolean literal expression esbuild can constant-fold + DCE.
	devLiteral := "false"
	if dev {
		devLiteral = "true"
	}

	buildOpts := api.BuildOptions{
		EntryPoints: []string{entry},
		Bundle:      true,
		Outdir:      outdir,
		Write:       true,
		Format:      api.FormatESModule, // index.html loads the bundle as <script type="module">
		Sourcemap:   api.SourceMapLinked,
		// ES2022 lets esbuild emit private class fields natively instead of
		// lowering them to WeakMap helpers (~870 B gzip saved per bundle). Browser
		// floor: Chrome 84 / Safari 14.1 / Firefox 90 — all comfortably below our
		// SPA-only target.
		Target: api.ES2022,
		// Dev-flag define for the state-preserving HMR reload (§27, D57). Production
		// (dev=false) folds it to `false`; the runtime's `if (DEV)` branches then
		// minify away entirely.
		Define:   map[string]string{"__PUZZLE_DEV__": devLiteral},
		Plugins:  []api.Plugin{pl.ESBuild()},
		LogLevel: api.LogLevelSilent,
	}

	configureRuntime(absRoot, &buildOpts, pl)
	return buildOpts
}

func scanFormatters(absRoot string, pl *plugin.Plugin) error {
	// Scan the whole project, not just app/, so a .pzl imported from a sibling
	// directory still contributes its formatters (the scan errs toward
	// over-inclusion; see plugin.ScanFormatters).
	used, err := plugin.ScanFormatters(absRoot)
	if err != nil {
		return fmt.Errorf("scanning template formatters: %w", err)
	}
	pl.SetFormatters(used)
	return nil
}

func configureRuntime(absRoot string, buildOpts *api.BuildOptions, pl *plugin.Plugin) {
	if buildOpts.Alias == nil {
		buildOpts.Alias = map[string]string{}
	}

	// The app-source alias (SPEC §40, D75): '@' resolves to <root>/app, so
	// '@/components/Icon.pzl' works from any depth instead of climbing '../../'.
	// esbuild's resolver matches aliases on SEGMENT boundaries and only for
	// package paths (internal/resolver: key, or key followed by '/'), so a bare
	// '@' key catches '@/…' while leaving '@magic-spells/…' — and every other
	// scoped package — untouched. npm cannot publish a package named exactly
	// '@', so there is no collision surface.
	buildOpts.Alias["@"] = filepath.Join(absRoot, "app")

	// Resolution of '@magic-spells/puzzle' (constellation/doc/DOC-COMPILER-DESIGN.md §b).
	//
	// v1 decision: when building an app that lives inside this repo (the
	// examples/todos), the runtime is NOT installed in node_modules, so normal
	// node resolution fails. We locate the repo's client-runtime/index.js by
	// walking up from the app root for the package.json whose "name" is
	// "@magic-spells/puzzle" and alias the bare specifier to it. When the
	// package IS installed (a real, published app), no such ancestor exists and
	// we leave resolution to esbuild's node_modules walk. Phase 3/publishing
	// revisits this.
	if runtime := FindRuntime(absRoot); runtime != "" {
		buildOpts.Alias["@magic-spells/puzzle"] = runtime
		// Subpath exports need their own entries — the bare alias points at a
		// FILE, so prefix substitution would produce index.js/morph. Longest
		// key wins, so the bare specifier stays untouched (v1.23, D55).
		buildOpts.Alias["@magic-spells/puzzle/morph"] = filepath.Join(filepath.Dir(runtime), "morph.js")
		// The SSG runtime (prerenderToDir) resolves the same way — the hybrid
		// build's prerender bundle imports it. The target file may not exist in
		// an older checkout; esbuild only errs if something actually imports it,
		// which happens only under `puzzle build --hybrid`.
		buildOpts.Alias["@magic-spells/puzzle/ssg"] = filepath.Join(filepath.Dir(runtime), "ssg", "index.js")
		// The static-pages kernel (mountStatic, D81) resolves the same way — each
		// generated per-page entry imports it. Same lazy-error posture as /ssg: the
		// file may be absent in an older checkout, and only a `puzzle build
		// --static` page entry imports it, so esbuild errs only then.
		buildOpts.Alias["@magic-spells/puzzle/static"] = filepath.Join(filepath.Dir(runtime), "static", "index.js")
		pl.SetRuntimeDir(filepath.Dir(runtime))
		return
	}

	if runtime := FindInstalledRuntime(absRoot); runtime != "" {
		pl.SetRuntimeDir(filepath.Dir(runtime))
	}
}
