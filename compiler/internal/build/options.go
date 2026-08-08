package build

import (
	"fmt"
	"path/filepath"
	"strconv"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

// bundleFlags carries the per-call BUILD facts that select the literal defines.
// Every field is decided by the caller — the one-shot app build has already
// resolved its output mode, the watch builder is always development — so no call
// site has to re-derive a mode from an empty-string sentinel, and adding a
// define does not silently default an existing caller to the wrong value.
type bundleFlags struct {
	// Dev selects __PUZZLE_DEV__ (§27, D57): the HMR snapshot/restore machinery,
	// the window publish, the DevTools bridge, and the profiler seam.
	Dev bool
	// Takeover selects __PUZZLE_TAKEOVER__: "this bundle may adopt prerendered
	// DOM". True for the hybrid app bundle (the router takes over the
	// `data-puzzle-ssg` container at navigation zero), for the true-static
	// per-page bundles (mountStatic adopts the prerendered page), and for every
	// dev/watch build. FALSE for a plain SPA bundle — nothing ever stamps the
	// marker, so the router's takeover branches are unreachable — and for the
	// node-platform prerender bundle, which GENERATES the markup and never
	// adopts it.
	Takeover bool
}

// newBundleOptions assembles the shared esbuild BuildOptions. All runtime probes
// receive boolean literal defines so esbuild can constant-fold their guarded
// branches; `flags` carries the build facts behind those literals, while the
// Plugin carries the build-wide usage bits discovered before this call.
func newBundleOptions(absRoot, entry, outdir string, pl *plugin.Plugin, flags bundleFlags) api.BuildOptions {
	buildOpts := api.BuildOptions{
		EntryPoints: []string{entry},
		Bundle:      true,
		Outdir:      outdir,
		Write:       true,
		Format:      api.FormatESModule, // index.html loads the bundle as <script type="module">
		Sourcemap:   api.SourceMapNone,
		// ES2022 lets esbuild emit private class fields natively instead of
		// lowering them to WeakMap helpers (~870 B gzip saved per bundle). Browser
		// floor: Chrome 84 / Safari 14.1 / Firefox 90 — all comfortably below our
		// SPA-only target.
		Target: api.ES2022,
		// Literal defines for state-preserving HMR (§27/D57) and usage-driven
		// runtime modules. Production MinifySyntax drops false-probed branches.
		Define:   bundleDefines(pl, flags),
		Plugins:  []api.Plugin{pl.ESBuild()},
		LogLevel: api.LogLevelSilent,
	}
	if flags.Dev {
		// Keep development builds byte-for-byte on their existing linked-map
		// behavior. Production enables linked maps only through build.sourceMap.
		buildOpts.Sourcemap = api.SourceMapLinked
	}

	configureRuntime(absRoot, &buildOpts, pl)
	return buildOpts
}

// bundleDefines builds the literal define map. __PUZZLE_HAS_FLIP__ is a SOURCE
// fact: plugin.ScanUsage reads the templates for the D85 `flip` attribute.
// __PUZZLE_DEV__ and __PUZZLE_TAKEOVER__ are BUILD facts carried by bundleFlags.
//
// __PUZZLE_TAKEOVER__ = false strips the router's three `data-puzzle-ssg`
// branches, which drops the last importer of ssg/preload.js so the module
// tree-shakes out of a plain SPA bundle entirely. The runtime probes it with the
// `typeof … === 'undefined' ||` idiom, so an absent define means ON — vitest and
// any third-party bundler keep the takeover path.
//
// There is deliberately no managed-head define. The browser never syncs og:/
// twitter:/canonical tags in ANY output mode (D111, amending D89): crawlers fetch
// each URL fresh from the server and never client-navigate, so the tags the SSG
// baked into that page's HTML are always the ones they read. The tab <title> is
// a separate, always-in concern handled by head.js syncTitle.
func bundleDefines(pl *plugin.Plugin, flags bundleFlags) map[string]string {
	f := pl.Features()
	return map[string]string{
		"__PUZZLE_DEV__":      strconv.FormatBool(flags.Dev),
		"__PUZZLE_HAS_FLIP__": strconv.FormatBool(f.Flip),
		"__PUZZLE_TAKEOVER__": strconv.FormatBool(flags.Takeover),
	}
}

// scanUsage refreshes pl's usage bits from a walk of absRoot. scanner may be nil
// for a one-shot walk; a long-lived builder passes its own so unchanged .pzl
// files are not re-parsed on every rebuild (plugin.UsageScanner).
func scanUsage(absRoot string, pl *plugin.Plugin, scanner *plugin.UsageScanner) (plugin.Usage, error) {
	usage, err := scanUsageWith(absRoot, scanner)
	if err != nil {
		return plugin.Usage{}, err
	}
	pl.SetUsage(usage)
	return usage, nil
}

// scanUsageWith runs the usage walk through scanner when one is supplied, else
// as a cold one-shot scan.
func scanUsageWith(absRoot string, scanner *plugin.UsageScanner) (plugin.Usage, error) {
	if scanner == nil {
		return scanUsageOnce(absRoot)
	}
	usage, err := scanner.Scan(absRoot)
	if err != nil {
		return plugin.Usage{}, fmt.Errorf("scanning project usage: %w", err)
	}
	return usage, nil
}

// scanUsageOnce performs the project-wide usage walk and returns its immutable
// result. Scan the whole project, not just app/, so a .pzl imported from a
// sibling directory still contributes its usage (the scan errs toward
// over-inclusion; see plugin.ScanUsage).
//
// A full static build runs THREE esbuild passes over the same sources (browser
// app.js, the node prerender bundle, the per-page browser bundles). The usage
// facts are a property of the source tree, not of the pass, so a one-shot
// build.Build scans once and hands the same Usage to all three (see
// passContext). Only the long-lived dev/watch builder re-scans, and only when a
// .pzl actually changed.
func scanUsageOnce(absRoot string) (plugin.Usage, error) {
	usage, err := plugin.ScanUsage(absRoot)
	if err != nil {
		return plugin.Usage{}, fmt.Errorf("scanning project usage: %w", err)
	}
	return usage, nil
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
		// The detachable fixtures/mock module (D98) resolves the same way — only
		// the `--fixtures` wrapper entry imports it, so esbuild errs only when the
		// flag is set and the file is genuinely missing. A PUBLISHED app needs no
		// alias at all: the generated wrapper lives under <appRoot>/.puzzle/, so
		// node_modules resolution walks up to the project root on its own.
		buildOpts.Alias["@magic-spells/puzzle/fixtures"] = filepath.Join(filepath.Dir(runtime), "fixtures", "index.js")
		pl.SetRuntimeDir(filepath.Dir(runtime))
		return
	}

	if runtime := FindInstalledRuntime(absRoot); runtime != "" {
		pl.SetRuntimeDir(filepath.Dir(runtime))
	}
}
