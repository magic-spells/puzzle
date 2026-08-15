package build

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
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
	// Splitting enables esbuild code splitting for the browser bundle: a dynamic
	// import() emits a lazy chunk under chunks/ instead of being inlined into
	// app.js. Opt-in per app (build.splitting in puzzle.config.js).
	//
	// It rides on the flags, never on the shared options, because it is
	// incompatible with two of the passes that share them: esbuild rejects
	// Splitting alongside Outfile, which is how the node-platform prerender pass
	// writes (prerender.go), and the static-mode SPA pass's output is deleted
	// before the swap, so splitting it would strand chunks nothing imports.
	Splitting bool
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
	if flags.Splitting {
		// The entry keeps its stable app.js name (EntryNames is left alone), so the
		// shell HTML is unchanged; everything a dynamic import() pulls in lands in
		// the reserved chunks/ directory beside it, imported with native ESM. There
		// is no chunk-loader runtime to pay for.
		//
		// AbsWorkingDir is deliberately NOT anchored here, unlike the static-pages
		// pass: this pass's metafile input keys are resolved against the PROCESS
		// working directory by metafileAllInputs (watch.go), which drives dev CSS
		// pruning and the public-only rebuild shortcut. Anchoring the pass would
		// silently break both whenever the app root is not the cwd. Unminified dev
		// chunks therefore carry cwd-relative input-path comments — exactly what
		// app.js has always carried — and production minifies them away.
		buildOpts.Splitting = true
		buildOpts.ChunkNames = chunksDirName + "/[name]-[hash]"
	}

	configureRuntime(absRoot, &buildOpts, pl)
	return buildOpts
}

// bundleDefines builds the literal define map. The __PUZZLE_HAS_* values are
// SOURCE facts: plugin.ScanUsage reads templates for flip, Portal, and raw-block
// usage.
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
		"__PUZZLE_DEV__":        strconv.FormatBool(flags.Dev),
		"__PUZZLE_HAS_FLIP__":   strconv.FormatBool(f.Flip),
		"__PUZZLE_HAS_PORTAL__": strconv.FormatBool(f.Portal),
		"__PUZZLE_HAS_RAW_AT__": strconv.FormatBool(f.RawAt),
		"__PUZZLE_TAKEOVER__":   strconv.FormatBool(flags.Takeover),
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
	// Three sources, most explicit first:
	//
	//  1. PUZZLE_RUNTIME — an explicit checkout to build against, for testing a
	//     working-tree runtime in an app that lives outside this repo.
	//  2. The in-repo walk — when the app lives inside this repo (examples/todos)
	//     the runtime is NOT installed in node_modules, so normal node resolution
	//     fails. Walk up from the app root for the package.json whose "name" is
	//     "@magic-spells/puzzle" and alias the bare specifier to it.
	//  3. Nothing — the package IS installed (a real, published app), so leave
	//     resolution to esbuild's node_modules walk.
	if runtime := envRuntime(); runtime != "" {
		aliasRuntime(buildOpts, pl, runtime)
		return
	}

	if runtime := FindRuntime(absRoot); runtime != "" {
		aliasRuntime(buildOpts, pl, runtime)
		return
	}

	if runtime := FindInstalledRuntime(absRoot); runtime != "" {
		pl.SetRuntimeDir(filepath.Dir(runtime))
	}
}

// RuntimeEnvVar names a Puzzle checkout to resolve '@magic-spells/puzzle'
// against, overriding both the in-repo walk and node_modules.
//
// It exists for the `puzzle-dev`-style workflow: building a working-tree
// COMPILER against a working-tree RUNTIME in some other project. Without it the
// compiler can only ever swap itself — the runtime is whatever that project's
// node_modules holds — so a dev CLI silently pairs new compiler with published
// runtime, and nothing says so.
//
// The value is the package ROOT (the directory holding client-runtime/), not
// the index.js inside it, so it reads the same as a repo path:
//
//	PUZZLE_RUNTIME=~/Code/@magic-spells/puzzle puzzle dev
const RuntimeEnvVar = "PUZZLE_RUNTIME"

// envRuntime resolves RuntimeEnvVar to a client-runtime/index.js path, or ""
// when unset.
//
// A set-but-wrong value is a hard stop rather than a fall-through: the whole
// point of setting it is to NOT build against node_modules, so silently doing
// exactly that would produce a green build of the wrong runtime — the failure
// this variable exists to prevent.
func envRuntime() string {
	root := strings.TrimSpace(os.Getenv(RuntimeEnvVar))
	if root == "" {
		return ""
	}

	abs, err := filepath.Abs(root)
	if err != nil {
		fmt.Fprintf(os.Stderr, "puzzle: %s=%q is not a usable path: %v\n", RuntimeEnvVar, root, err)
		os.Exit(1)
	}

	idx := filepath.Join(abs, "client-runtime", "index.js")
	if !fsutil.FileExists(idx) {
		fmt.Fprintf(os.Stderr, "puzzle: %s=%q has no client-runtime/index.js\n", RuntimeEnvVar, root)
		fmt.Fprintf(os.Stderr, "puzzle: point it at a Puzzle checkout (the directory holding client-runtime/)\n")
		os.Exit(1)
	}
	if !PkgIsPuzzle(filepath.Join(abs, "package.json")) {
		fmt.Fprintf(os.Stderr, "puzzle: %s=%q is not @magic-spells/puzzle\n", RuntimeEnvVar, root)
		os.Exit(1)
	}
	return idx
}

// aliasRuntime points the bare specifier and every subpath export at one
// resolved client-runtime/index.js.
//
// Subpath exports need their own entries — the bare alias points at a FILE, so
// prefix substitution would produce index.js/morph. Longest key wins, so the
// bare specifier stays untouched (v1.23, D55).
//
// Several targets may not exist in an older checkout. That is deliberate: an
// alias is only consulted when something imports it, so a missing /ssg errs
// under `puzzle build --hybrid` and nowhere else.
func aliasRuntime(buildOpts *api.BuildOptions, pl *plugin.Plugin, runtime string) {
	dir := filepath.Dir(runtime)
	buildOpts.Alias["@magic-spells/puzzle"] = runtime
	buildOpts.Alias["@magic-spells/puzzle/adapter"] = filepath.Join(dir, "datastore", "adapter.js")
	buildOpts.Alias["@magic-spells/puzzle/morph"] = filepath.Join(dir, "morph.js")
	// The opt-in router modes (D159): hashRouter()/memoryRouter() live in their
	// own module so a history-mode app never pulls them into the graph.
	buildOpts.Alias["@magic-spells/puzzle/router-modes"] = filepath.Join(dir, "router", "modes.js")
	// The SSG runtime (prerenderToDir) — the hybrid build's prerender bundle
	// imports it.
	buildOpts.Alias["@magic-spells/puzzle/ssg"] = filepath.Join(dir, "ssg", "index.js")
	// The static-pages kernel (mountStatic, D81) — each generated per-page entry
	// imports it.
	buildOpts.Alias["@magic-spells/puzzle/static"] = filepath.Join(dir, "static", "index.js")
	// The detachable fixtures/mock module (D98) — only the `--fixtures` wrapper
	// entry imports it. A PUBLISHED app needs no alias at all: the generated
	// wrapper lives under <appRoot>/.puzzle/, so node_modules resolution walks up
	// to the project root on its own.
	buildOpts.Alias["@magic-spells/puzzle/fixtures"] = filepath.Join(dir, "fixtures", "index.js")
	pl.SetRuntimeDir(dir)
}
