// True static-pages output for `puzzle build --static` (or `output: 'static'`
// in puzzle.config.js), decision D81. Unlike the hybrid mode (prerender.go),
// which prerenders per-route HTML that the full SPA runtime takes over, the
// static mode ships content-complete HTML pages plus a SMALL per-page ES-module
// bundle: no router, no SPA takeover, no history API. Navigation is plain <a>
// page loads; the per-page script upgrades each page to an interactive document.
//
// The Go pipeline runs the shared node prerender pass in mode 'static' (the JS
// side captures each page's store payload and returns an extended summary), then
// generates one `mountStatic` entry file per written page and runs a SECOND,
// browser-platform esbuild pass with Splitting over those entries into
// staging/_puzzle. staging/app.js is deleted (nothing references it in static
// mode). Like hybrid, it slots in before the staging→dist swap, so any failure
// discards staging and leaves the last good dist/ untouched.
package build

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
	"github.com/magic-spells/puzzle/compiler/internal/textutil"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// staticPagesDir is the per-page bundle output directory under the app root (and
// the URL prefix the JS shell surgery injects: /_puzzle/<slug>.js). It ships in
// dist/ alongside the prerendered pages.
const staticPagesDir = "_puzzle"

// staticSummary mirrors the JSON the SSG runtime's prerenderToDir prints after
// the sentinel in `mode: 'static'`. It extends the hybrid summary (prerender.go
// ssgSummary) with the per-page module/entry/route facts and the top-level
// mode/target/store/router wiring facts the per-page entry generation needs.
type staticSummary struct {
	Written  []staticPage    `json:"written"`
	Skipped  []staticSkipped `json:"skipped"`
	Warnings []string        `json:"warnings"`

	// Mode echoes the requested mode ("static") — a cheap contract check that the
	// JS side ran the intended path.
	Mode string `json:"mode"`
	// Target is the mount element id (e.g. "app"); the per-page entry mounts into
	// `#<target>`.
	Target string `json:"target"`
	// APIURL is the app's configured apiURL, embedded verbatim into each entry's
	// mountStatic call. Kept raw (string or null) so it round-trips exactly.
	APIURL json.RawMessage `json:"apiURL"`
	// RouterBase preserves the app config value for the browser-side static
	// context. A missing JSON field stays nil, so the generated mount call
	// preserves app.js's conditional passthrough. (`routerMode` is deliberately NOT
	// carried: static pages have no router, the kernel ignored it, and since D159 a
	// mode is an object that would serialize to a dead `{}` here anyway. Storage is
	// not carried for the same serialization reason — the JS side warns instead; a
	// direct mountStatic({storage}) caller still passes a real Storage object.)
	RouterBase json.RawMessage `json:"routerBase"`
	// HasModels/HasFormatters report config registrations. The build uses them
	// only for warnings when no conventional module can reproduce that wiring in
	// the per-page browser graph.
	HasModels bool `json:"hasModels"`
	// HasFormatters is true when the app config registered custom formatters; the
	// build warns when they exist but app/formatters.js does not (they would be
	// missing client-side in static mode).
	HasFormatters bool `json:"hasFormatters"`
	// HasAdapter carries the non-serializable app capability across the node→Go
	// summary boundary so each browser entry can import and pass the same value.
	HasAdapter bool `json:"hasAdapter"`
	// AdapterConfigured is true when config.adapter carries app-wide defaults
	// (adapter.defaults(...)) rather than being the bare capability. A configured
	// capability holds functions, so re-importing the bare one from the subpath
	// would install DIFFERENT behavior than the prerender ran.
	AdapterConfigured bool `json:"adapterConfigured"`
	// AdapterModuleMatches answers whether the conventional app/adapter module's
	// default export IS config.adapter. Nil when no such module was passed to the
	// prerender (there is none on disk), so an app with the file and a config that
	// ignores it is never mistaken for one that wired it up.
	AdapterModuleMatches *bool `json:"adapterModuleMatches"`
}

// staticSkipped is one route the prerender did not render. Modules carries its
// chain's view/layout stamps in static mode — a skipped route ships no page, but
// its views are still chain roots for the dev builder's render-wide walk (D155).
type staticSkipped struct {
	Path    string        `json:"path"`
	Reason  string        `json:"reason"`
	Modules staticModules `json:"modules"`
}

// staticPage is one written page in the static summary.
type staticPage struct {
	Path string `json:"path"`
	File string `json:"file"`
	// false for a `prerender: false` route — an empty, unmarked target is written
	// and the per-page script populates it client-side.
	Prerender bool `json:"prerender"`
	// Entry is the per-page bundle URL path, "_puzzle/<slug>.js"; the slug is the
	// esbuild entry name and the on-disk staging entry basename.
	Entry   string        `json:"entry"`
	Modules staticModules `json:"modules"`
	// Route is the serialized route snapshot (plain JSON, no classes) embedded
	// verbatim into the mountStatic call. Kept raw so the Go side never models the
	// chain shape.
	Route json.RawMessage `json:"route"`
	// Reused is set by a D155 subset render: the page was enumerated, claimed its
	// output path and its slug, and was deliberately NOT rendered — File does not
	// exist and the caller must supply the previous render's copy. Always false in
	// a one-shot build, which never passes a route filter.
	Reused bool `json:"reused"`
}

// staticModules names the app-relative source paths (the codegen __pzlModule
// stamps) of a page's chain view classes and its layout, so the entry generator
// can import them by their real module path.
type staticModules struct {
	Views  []string `json:"views"`
	Layout *string  `json:"layout"`
}

// prerenderStaticPages runs the true static-pages build against the app rooted
// at absRoot, writing content-complete HTML pages (via the node prerender pass)
// plus one per-page ES-module bundle under staging/_puzzle. cfg + dev select the
// same minify/define/dropConsole policy as the main app.js pass. prof may be nil
// (profiling off); it splits this pass into its three expensive steps — the node
// prerender bundle, the render run, and the per-page browser bundles.
func prerenderStaticPages(absRoot, staging string, publicFiles map[string]bool, cfg config.Config, dev bool, prof *buildProfile, pc *passContext) error {
	// A public/ asset that already produced a staging/_puzzle would be clobbered
	// by the per-page bundles — reject it up front (extends the reserved-output
	// collision guard to the static tree). copyPublic has already run, so the
	// collision is observable here, before the splitting pass writes anything.
	if pagesOut := filepath.Join(staging, staticPagesDir); dirExists(pagesOut) || FileExists(pagesOut) {
		return fmt.Errorf(
			"public asset would overwrite compiler output dist/%s (a reserved output name in static mode); rename or remove it",
			staticPagesDir,
		)
	}
	// Same class of collision for the prerender scratch dir, which is overwritten
	// by the generated bundle and then deleted before the swap.
	if err := checkPrerenderScratchCollision(absRoot, staging, "--static"); err != nil {
		return err
	}

	// Whether the app ships a models registry, a formatters module, or a
	// conventional adapter module is a build-wide fact; resolve it once. The
	// adapter module is needed BEFORE the render — the prerender entry imports it
	// so the summary can report whether it is the value the config passed.
	modelsModule := findStaticModule(absRoot, "app/models/index.js", "app/models/index.ts")
	formattersModule := findStaticModule(absRoot, "app/formatters.js", "app/formatters.ts")
	adapterModule := findStaticModule(absRoot, "app/adapter.js", "app/adapter.ts")

	// 1. Node prerender pass in mode 'static': the JS side renders each static
	//    route, captures its store payload into the page's data island, strips the
	//    app.js tag, and returns the extended summary behind the sentinel.
	stdin, err := staticPrerenderStdin(absRoot, adapterModule)
	if err != nil {
		return err
	}

	outfile := filepath.Join(staging, prerenderDir, "prerender.mjs")
	endPrerenderBundle := prof.phase("prerender bundle")
	bundleErr := bundlePrerenderEntry(absRoot, stdin, outfile, "--static", pc)
	endPrerenderBundle()
	if bundleErr != nil {
		return bundleErr
	}

	endRender := prof.phase("prerender render")
	payload, err := runPrerender(outfile, staging, "--static")
	endRender()
	if err != nil {
		return err
	}
	var summary staticSummary
	if err := json.Unmarshal([]byte(payload), &summary); err != nil {
		return fmt.Errorf("puzzle build --static: prerender summary was not readable JSON: %w", err)
	}
	owners := publicOwnership(publicFiles)
	for _, page := range summary.Written {
		if err := checkPrerenderCollision(absRoot, staging, owners, page.Path, page.File); err != nil {
			return err
		}
	}

	// 2. Generate one mountStatic entry file per written page.
	entriesDir := filepath.Join(staging, prerenderDir, "entries")
	if err := os.MkdirAll(entriesDir, 0o755); err != nil {
		return fmt.Errorf("puzzle build --static: creating entry dir: %w", err)
	}
	var entryFiles []string
	for _, page := range summary.Written {
		slug, err := slugFromEntry(page.Entry)
		if err != nil {
			return err
		}
		src, err := staticEntrySource(absRoot, page, summary, modelsModule, formattersModule, adapterModule)
		if err != nil {
			return err
		}
		file := filepath.Join(entriesDir, slug+".js")
		if err := os.WriteFile(file, []byte(src), 0o644); err != nil {
			return fmt.Errorf("puzzle build --static: writing entry %s: %w", slug, err)
		}
		entryFiles = append(entryFiles, file)
	}

	// 3. Warn when app.js registered services that have no conventional module
	//    the per-page browser graph can import.
	out := ui.New(os.Stdout)
	if summary.HasModels && modelsModule == "" {
		fmt.Fprintf(os.Stdout, "  %s %s\n", out.Yellow("!"),
			"models registered in app.js will not exist client-side in static mode — export them from app/models/index.js or app/models/index.ts")
	}
	if summary.HasFormatters && formattersModule == "" {
		fmt.Fprintf(os.Stdout, "  %s %s\n", out.Yellow("!"),
			"custom formatters registered in app.js will not exist client-side in static mode — export them from app/formatters.js or app/formatters.ts")
	}
	if staticCaptured(summary, adapterModule) {
		fmt.Fprintf(os.Stdout, "  %s %s\n", out.Yellow("!"), staticCaptureNote)
	}

	// 4. Splitting esbuild pass over all entries → staging/_puzzle. Shared chunks
	//    land in _puzzle/chunks/ automatically. Skipped when there is nothing to
	//    render (no static routes).
	if len(entryFiles) > 0 {
		endPages := prof.phase("per-page bundles")
		pagesErr := bundleStaticPages(absRoot, entryFiles, filepath.Join(staging, staticPagesDir), cfg, dev, pc)
		endPages()
		if pagesErr != nil {
			return pagesErr
		}
	}

	// 5. Nothing references staging/app.js in static mode — drop it (and its map)
	//    plus the prerender scaffolding before the swap so neither ships in dist/.
	for _, name := range []string{"app.js", "app.js.map"} {
		if err := os.Remove(filepath.Join(staging, name)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("puzzle build --static: removing staging/%s: %w", name, err)
		}
	}
	if err := os.RemoveAll(filepath.Join(staging, prerenderDir)); err != nil {
		return fmt.Errorf("puzzle build --static: cleaning %s: %w", prerenderDir, err)
	}

	printStaticSummary(summary, len(entryFiles))
	return nil
}

// staticPrerenderStdin builds the generated node entry for the static prerender
// pass: import the app's default export plus prerenderToDir, render into the
// outDir/shellPath passed on argv, and print the JSON summary behind the
// sentinel. The app entry path is JSON-encoded so a root with spaces or quotes
// stays a valid JS string literal. Shared with the dev builder, whose persistent
// prerender context compiles this exact source.
//
// adapterModule, when non-empty, is the app-relative conventional adapter module
// (app/adapter.js|ts). It is imported here purely so the render can answer
// whether that module's default export IS `config.adapter` — an identity the Go
// side cannot see and the summary cannot serialize. A NAMESPACE import is
// deliberate: this file may exist for unrelated reasons and export no default at
// all, which `import x from` would make a hard bundle error while a namespace
// read is merely undefined (a non-match, which is the truthful answer). Its
// presence is the only thing that changes these bytes, so the dev builder's
// persistent context is rebuilt only when the file appears or disappears.
//
// argv[4], when present, is a JSON array of route paths: the SUBSET to render
// (D155). It rides on argv rather than in this source because the dev builder
// holds one persistent esbuild context over these exact bytes — a per-rebuild
// source change would throw that context's cache away, which is the whole thing
// being bought. A one-shot build passes three arguments and renders everything,
// so this line is inert there.
func staticPrerenderStdin(absRoot, adapterModule string) (string, error) {
	entry, err := json.Marshal(appEntryPath(absRoot))
	if err != nil {
		return "", fmt.Errorf("encoding prerender entry path: %w", err)
	}
	adapterImport, adapterOption := "", ""
	if adapterModule != "" {
		spec, err := json.Marshal(absModuleImport(absRoot, adapterModule))
		if err != nil {
			return "", fmt.Errorf("encoding the app adapter module path: %w", err)
		}
		adapterImport = fmt.Sprintf("import * as __pzlAdapterModule from %s;\n", spec)
		adapterOption = ", adapterModule: __pzlAdapterModule.default"
	}
	return fmt.Sprintf(
		"import app from %s;\n"+
			"%s"+
			"import { prerenderToDir } from '@magic-spells/puzzle/ssg';\n"+
			"const only = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;\n"+
			"const summary = await prerenderToDir(app?.config ?? app, { outDir: process.argv[2], shellPath: process.argv[3], mode: 'static', only%s });\n"+
			"process.stdout.write('\\n%s' + JSON.stringify(summary));\n",
		string(entry), adapterImport, adapterOption, prerenderSentinel,
	), nil
}

// slugFromEntry extracts the page slug from an "_puzzle/<slug>.js" entry path
// (the on-disk staging entry basename and the esbuild EntryNames token). It is
// tolerant of a leading slash. A shape that does not match is a contract
// violation between the Go and JS sides, surfaced as a build error.
func slugFromEntry(entry string) (string, error) {
	e := strings.TrimPrefix(filepath.ToSlash(entry), "/")
	e = strings.TrimPrefix(e, staticPagesDir+"/")
	e = strings.TrimSuffix(e, ".js")
	if e == "" || strings.Contains(e, "/") {
		return "", fmt.Errorf("puzzle build --static: prerender returned a malformed entry path %q", entry)
	}
	return e, nil
}

// staticEntrySource builds the mountStatic entry module for one page. Import
// specifiers and embedded values are JSON-encoded (space/quote safe, forward
// slashes). The models/formatters imports (and their shorthand call properties)
// are emitted only when the source files exist — an absent binding must never be
// referenced. Route + service options are embedded verbatim from the summary;
// the adapter is resolved by staticAdapterImport.
func staticEntrySource(absRoot string, page staticPage, summary staticSummary, modelsModule, formattersModule, adapterModule string) (string, error) {
	var b strings.Builder
	b.WriteString("import { mountStatic } from '@magic-spells/puzzle/static';\n")
	// adapterBinding is emitted after every import, so the generated module reads
	// as an import block followed by statements.
	adapterBinding := ""
	if summary.HasAdapter {
		adapterImport, binding, err := staticAdapterImport(absRoot, summary, adapterModule)
		if err != nil {
			return "", err
		}
		b.WriteString(adapterImport)
		adapterBinding = binding
	}

	viewIdents := make([]string, len(page.Modules.Views))
	for i, mod := range page.Modules.Views {
		ident := fmt.Sprintf("V%d", i)
		viewIdents[i] = ident
		spec, err := json.Marshal(absModuleImport(absRoot, mod))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import %s from %s;\n", ident, spec)
	}

	layoutExpr := "null"
	if page.Modules.Layout != nil {
		spec, err := json.Marshal(absModuleImport(absRoot, *page.Modules.Layout))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import L0 from %s;\n", spec)
		layoutExpr = "L0"
	}

	if modelsModule != "" {
		spec, err := json.Marshal(absModuleImport(absRoot, modelsModule))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import models from %s;\n", spec)
	}
	if formattersModule != "" {
		spec, err := json.Marshal(absModuleImport(absRoot, formattersModule))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import formatters from %s;\n", spec)
	}

	targetJSON, err := json.Marshal("#" + summary.Target)
	if err != nil {
		return "", err
	}
	routeJSON := "null"
	if len(page.Route) > 0 {
		routeJSON = string(page.Route)
	}
	apiURLJSON := "null"
	if len(summary.APIURL) > 0 {
		apiURLJSON = string(summary.APIURL)
	}

	b.WriteString(adapterBinding)
	b.WriteString("mountStatic({\n")
	fmt.Fprintf(&b, "  target: %s,\n", targetJSON)
	fmt.Fprintf(&b, "  views: [%s],\n", strings.Join(viewIdents, ", "))
	fmt.Fprintf(&b, "  layout: %s,\n", layoutExpr)
	fmt.Fprintf(&b, "  route: %s,\n", routeJSON)
	if modelsModule != "" {
		b.WriteString("  models,\n")
	}
	if formattersModule != "" {
		b.WriteString("  formatters,\n")
	}
	if summary.HasAdapter {
		b.WriteString("  adapter,\n")
	}
	fmt.Fprintf(&b, "  apiURL: %s,\n", apiURLJSON)
	if len(summary.RouterBase) > 0 {
		fmt.Fprintf(&b, "  routerBase: %s,\n", summary.RouterBase)
	}
	// mountStatic is async, and nothing awaits it here — a missing target, a
	// throwing data() during rehydration, or a corrupt chain would otherwise
	// surface only as an unobserved rejection. The prerendered markup is still on
	// screen at that point (replaceChildren has not run), so the page LOOKS right
	// while nothing is interactive. Log it like every other entry point does, then
	// rethrow from a fresh task: production strips console.* (bundleStaticPages
	// sets Drop: api.DropConsole), which would leave an EMPTY handler that swallows
	// the failure outright. The async throw reaches window.onerror instead, so
	// production still reports it and dev keeps the readable log.
	b.WriteString("}).catch((err) => {\n")
	b.WriteString("  console.error('[puzzle] static page mount failed:', err);\n")
	b.WriteString("  setTimeout(() => { throw err; });\n")
	b.WriteString("});\n")
	return b.String(), nil
}

// staticAdapterImport emits the lines that bind `adapter` in a page entry to the
// SAME capability value the prerender installed (D157/D158), as an import and a
// (usually empty) statement the caller places after the whole import block.
// Three tiers, in order of how cheap the resulting page is:
//
//  1. The config passed the BARE capability: re-import it from the subpath. Two
//     imports of one frozen export are one value, so identity holds for free.
//  2. The config passed a configured capability (adapter.defaults(...)) that IS
//     the conventional app/adapter module's default export: import that module.
//     This is the layout the docs recommend, and it keeps a page's graph to its
//     own chain.
//  3. Otherwise the capability was configured inline in app.js — or a module
//     exists but holds a DIFFERENT value — so the only place the exact value can
//     be reached is the app entry itself. Import it and read `app.config`;
//     `__PUZZLE_CAPTURE__` makes its top-level `app.mount()` inert so importing
//     the SPA entry cannot boot an SPA over the prerendered page.
//
// Tier 3 is a fallback, never an error: configuring the adapter inline is legal
// app code and must build. It costs page weight (the app entry pulls the route
// table and every view into the shared chunk), which staticCaptureNote reports.
func staticAdapterImport(absRoot string, summary staticSummary, adapterModule string) (string, string, error) {
	if !summary.AdapterConfigured {
		return "import { adapter } from '@magic-spells/puzzle/adapter';\n", "", nil
	}
	if adapterModule != "" && summary.AdapterModuleMatches != nil && *summary.AdapterModuleMatches {
		spec, err := json.Marshal(absModuleImport(absRoot, adapterModule))
		if err != nil {
			return "", "", err
		}
		return fmt.Sprintf("import adapter from %s;\n", spec), "", nil
	}
	spec, err := json.Marshal(absModuleImport(absRoot, appEntryPath(absRoot)))
	if err != nil {
		return "", "", err
	}
	return fmt.Sprintf("import __pzlApp from %s;\n", spec),
		"const adapter = (__pzlApp?.config ?? __pzlApp).adapter;\n",
		nil
}

// staticCaptured reports whether this build's entries take the capture tier.
func staticCaptured(summary staticSummary, adapterModule string) bool {
	if !summary.HasAdapter || !summary.AdapterConfigured {
		return false
	}
	return adapterModule == "" || summary.AdapterModuleMatches == nil || !*summary.AdapterModuleMatches
}

// staticCaptureNote is the advisory the capture tier prints: the build works,
// but every page now carries the whole app graph, and moving the capability into
// app/adapter.js is the one-line fix.
const staticCaptureNote = "config.adapter is configured in app.js, so each static page imports app/app.js to reach it — the route table and every view land in the shared page chunk; export the capability from app/adapter.js (or app/adapter.ts) and pass that value to keep pages lean"

// findStaticModule returns the first conventional app module that exists,
// preferring JavaScript when both JavaScript and TypeScript variants are present.
func findStaticModule(absRoot string, candidates ...string) string {
	for _, candidate := range candidates {
		if FileExists(filepath.Join(absRoot, filepath.FromSlash(candidate))) {
			return candidate
		}
	}
	return ""
}

// absModuleImport joins an app-relative POSIX module path (a __pzlModule stamp,
// or a conventional app/… path) onto absRoot and returns a forward-slashed
// absolute specifier for a generated import.
//
// An ALREADY-absolute path passes through untouched: plugin.relName falls back
// to the absolute path whenever a .pzl resolves outside the app root (symlinked
// node_modules, monorepo layouts), and that value reaches here as the module
// stamp. Joining it onto absRoot would yield <absRoot>/Users/… — a file that
// does not exist, failing the per-page esbuild pass with "Could not resolve"
// against a staging path the deferred cleanup has already removed.
func absModuleImport(absRoot, rel string) string {
	if filepath.IsAbs(filepath.FromSlash(rel)) {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(filepath.Join(absRoot, filepath.FromSlash(rel)))
}

// staticPagesSourcemap selects the per-page bundle pass's source-map mode from
// the SAME policy the main app.js pass uses (options.go newBundleOptions +
// build.Build): development keeps linked maps, production emits them only when
// puzzle.config.js opts in with `build.sourceMap`.
//
// The pass used to emit linked maps unconditionally and a post-pass then deleted
// every .js.map under staging/_puzzle and rewrote every .js to strip its
// sourceMappingURL comment — generating output solely to throw it away, and
// re-reading and re-writing the whole tree to do it. Deciding here instead makes
// the shipped bytes identical and the stripper unnecessary.
func staticPagesSourcemap(cfg config.Config, dev bool) api.SourceMap {
	if dev || cfg.Build.SourceMap {
		return api.SourceMapLinked
	}
	return api.SourceMapNone
}

// bundleStaticPages runs the browser-platform, Splitting esbuild pass over the
// generated per-page entries into outdir (staging/_puzzle). Target/minify/define
// and the dropConsole policy match the main app.js pass exactly; EntryNames is
// the bare slug so the emitted /_puzzle/<slug>.js matches the URLs the shell
// surgery injected, and shared code splits into _puzzle/chunks/. The CSS this
// fresh plugin collects is discarded — styles.css was composed by the main pass.
func bundleStaticPages(absRoot string, entryFiles []string, outdir string, cfg config.Config, dev bool, pc *passContext) error {
	result := api.Build(staticPagesBundleOptions(absRoot, entryFiles, outdir, cfg, dev, pc.plugin(absRoot)))
	if len(result.Errors) > 0 {
		lines := api.FormatMessages(result.Errors, api.FormatMessagesOptions{
			Kind:          api.ErrorMessage,
			Color:         ui.New(os.Stderr).Enabled(),
			TerminalWidth: 0,
		})
		return fmt.Errorf("puzzle build --static: per-page bundle failed:\n%s", strings.Join(lines, "\n"))
	}
	return nil
}

// staticPagesBundleOptions assembles the per-page pass's BuildOptions. Split out
// so the static dev builder can hold the identical pass open as a persistent
// api.Context — the shipped bytes must not depend on which driver ran the pass.
func staticPagesBundleOptions(absRoot string, entryFiles []string, outdir string, cfg config.Config, dev bool, pl *plugin.Plugin) api.BuildOptions {
	buildOpts := api.BuildOptions{
		EntryPoints: entryFiles,
		Bundle:      true,
		Splitting:   true,
		Format:      api.FormatESModule,
		Platform:    api.PlatformBrowser,
		Target:      api.ES2022,
		Outdir:      outdir,
		Write:       true,
		Sourcemap:   staticPagesSourcemap(cfg, dev),
		EntryNames:  "[name]",
		ChunkNames:  "chunks/[name]-[hash]",
		// Takeover: true — a static page's whole job is adopting the prerendered
		// markup it was emitted alongside (mountStatic rehydrates the data island
		// and mounts over it), so these bundles must keep the preload path.
		// Capture: true — a static page mounts through mountStatic, never through
		// PuzzleApp.mount(), so the app entry a capture-tier entry imports must not
		// boot. Unconditional rather than tier-dependent: the other tiers never pull
		// PuzzleApp into the graph, so the define is inert there, and this keeps the
		// dev builder's frozen page context from going stale on an adapter change.
		Define:   bundleDefines(pl, bundleFlags{Dev: dev, Takeover: true, Capture: true}),
		Plugins:  []api.Plugin{pl.ESBuild()},
		LogLevel: api.LogLevelSilent,
		// Anchor esbuild's input-path bookkeeping to the OUTPUT TREE rather than
		// to whatever directory the compiler was invoked from. Unminified output
		// (every dev build) carries a `// <input path>` comment per module, and
		// those paths are AbsWorkingDir-relative: left at the process cwd, the
		// generated entry modules were labelled with the staging dir's random
		// suffix, so two dev builds of identical sources produced different
		// _puzzle/*.js bytes and the same build run from a different directory
		// produced different bytes again. Anchored here, the labels are
		// `.puzzle-prerender/entries/<slug>.js` and `../../app/views/…` — stable
		// across runs, across working directories, and across the two drivers of
		// this pass (a one-shot staging tree and the dev builder's warm tree sit
		// at the same depth by construction). Production output is unaffected:
		// minification strips the comments entirely.
		AbsWorkingDir: filepath.Dir(outdir),
	}
	// Production (dev=false) matches the main bundle: minify everything and strip
	// console.* unless build.dropConsole: false opts out.
	if !dev {
		buildOpts.MinifyWhitespace = true
		buildOpts.MinifyIdentifiers = true
		buildOpts.MinifySyntax = true
		if cfg.DropConsole() {
			buildOpts.Drop = api.DropConsole
		}
	}
	configureRuntime(absRoot, &buildOpts, pl)
	return buildOpts
}

// printStaticSummary reports the static build result in the build-summary style:
// the header, the prerendered-page count (with any prerender:false pages noted
// as empty islands), the per-page bundle count, then advisory warnings and
// skipped routes.
func printStaticSummary(s staticSummary, bundleCount int) {
	prerendered := 0
	for _, w := range s.Written {
		if w.Prerender {
			prerendered++
		}
	}
	empties := len(s.Written) - prerendered

	out := ui.New(os.Stdout)
	detail := fmt.Sprintf("· %d page%s prerendered", prerendered, textutil.Plural(prerendered))
	if empties > 0 {
		// `prerender: false` pages get an empty, unmarked target the per-page
		// script fills client-side.
		detail += fmt.Sprintf(" (+%d empty island%s)", empties, textutil.Plural(empties))
	}
	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(os.Stdout, "  %s %s\n",
		out.Cyan(out.Bold("puzzle build · static")),
		out.Dim(detail),
	)
	fmt.Fprintf(os.Stdout, "  %s\n",
		out.Dim(fmt.Sprintf("· %d page bundle%s", bundleCount, textutil.Plural(bundleCount))),
	)
	for _, w := range s.Warnings {
		fmt.Fprintf(os.Stdout, "  %s %s\n", out.Yellow("!"), w)
	}
	for _, sk := range s.Skipped {
		fmt.Fprintf(os.Stdout, "  %s %s %s\n",
			out.Yellow("!"),
			out.Dim("skipped"),
			fmt.Sprintf("%s (%s)", sk.Path, sk.Reason),
		)
	}
}
