package build

// watch_static.go — the incremental driver for `puzzle dev` against an
// `output: 'static'` project. It is the static-mode sibling of WatchBuilder
// (watch.go) and rhymes with it deliberately: persistent esbuild api.Contexts,
// one long-lived Plugin per context so the CSS collector survives rebuilds, and
// a Features comparison that replaces a context only when a frozen Define
// actually goes stale.
//
// What makes static mode different, and why this file exists at all:
//
//   - A static build is THREE esbuild passes, not one — the browser app.js pass
//     (which in this mode exists only to collect <style> and report compile
//     errors; its output is discarded, exactly as the one-shot build discards
//     staging/app.js), the node-platform prerender bundle, and the multi-entry
//     per-page pass whose entry set is not known until the prerender has run.
//   - The output cannot be patched in place. Pages, page bundles, and the
//     stylesheet must all appear together or not at all, so every rebuild
//     assembles a fresh staging tree and swaps it in (swapOutput), which is what
//     preserves the D148 guarantee that a failed compile or a failed prerender
//     leaves the last good site serving.
//
// Those two pull against each other: an api.Context freezes its Outdir, so it
// cannot write into a directory that is created fresh each rebuild. The
// resolution is a WARM output root, <root>/.puzzle/tmp/dev-static, that mirrors
// a staging tree's layout exactly — `_puzzle/` for the page bundles,
// `.puzzle-prerender/entries/` for the generated mountStatic entries. It is
// deliberately at the SAME depth as a staging-* dir, because esbuild bakes
// output-relative source paths into every .js.map: at any other depth the
// sourcemaps would differ from a one-shot build's byte-for-byte. The page pass
// then runs with Write:false and this file copies its OutputFiles into staging,
// which also prunes for free — a since-deleted page or a re-hashed chunk cannot
// linger, because staging only ever holds what THIS rebuild produced.
//
// The node prerender still runs as a fresh `node` subprocess per rebuild. A
// persistent render worker is a much larger change (module-graph invalidation
// inside a long-lived node process, app-level global state surviving between
// renders) and is deliberately not attempted here.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// devStaticWorkDir is the warm output root's name inside <root>/.puzzle/tmp. It
// deliberately does NOT start with a SweepWorkDirs prefix: a dev session that
// sits idle for longer than staleWorkAge must not have its warm tree deleted
// out from under its esbuild contexts.
const devStaticWorkDir = "dev-static"

// StaticWatchBuilder is the persistent static-output builder for one dev
// session. Not safe for concurrent Rebuilds; the dev loop calls it serially.
type StaticWatchBuilder struct {
	mu sync.Mutex

	root    string
	outdir  string // <root>/dist
	warm    string // <root>/.puzzle/tmp/dev-static
	workTmp string // <root>/.puzzle/tmp
	cfg     config.Config
	profile bool

	// tailwind returns the current Tailwind layer for the composed stylesheet.
	// The dev loop points it at the warm `tailwindcss --watch` child's latest
	// complete output (or at its one-shot fallback when that child is
	// unavailable). nil means the project declares no Tailwind pipeline.
	tailwind func() (string, error)

	// cache and scanner live for the whole session — the two memos that turn a
	// rebuild from "re-read and re-parse the project" into "re-read what changed".
	cache   *plugin.CompileCache
	scanner *plugin.UsageScanner

	appPl, prePl, pagesPl *plugin.Plugin
	appCtx, preCtx        api.BuildContext
	pagesCtx              api.BuildContext

	// pageEntries is the entry list frozen into pagesCtx, in the order the
	// prerender summary produced it. A rebuild regenerates the list and replaces
	// the context only when the set changed — a route added, removed, or renamed.
	pageEntries []string

	// usage is the most recent scan result; defined is the Features bit set baked
	// into all three contexts' Defines, which only a scan can invalidate.
	usage   plugin.Usage
	defined plugin.Features

	// graph is the reverse dependency graph captured after the last rebuild that
	// produced both metafiles AND landed in dist/ (route_deps.go). nil means
	// "render everything".
	graph *routeGraph

	// routeCount is how many pages the last render enumerated — the denominator
	// in the profile's partial-render row.
	routeCount int

	// nextGraph and nextRouteCount hold what the in-flight rebuild captured,
	// pending the staging swap. They are promoted (and pending cleared) only once
	// that swap has committed: a rebuild whose swap failed left dist/ on its
	// pre-edit pages, so adopting its graph would let the NEXT save render only
	// its own routes and hard-link those stale pages back in as "last-good".
	nextGraph      *routeGraph
	nextRouteCount int

	// lastPlan is the plan the most recent Rebuild actually EXECUTED — a partial
	// that fell back reads as full here. Diagnostics and the equivalence test
	// read it; nothing in the build path does.
	lastPlan renderPlan

	// pending accumulates every path handed to Rebuild since the last graph
	// capture that actually landed. A failed rebuild leaves the graph describing
	// pre-edit imports, so the edit that added an import must keep being
	// classified until a graph that knows about it exists — otherwise a later
	// save to the imported file would be attributed to too few routes.
	pending map[string]bool

	// CSS collected by appPl is working state: esbuild can successfully run some
	// plugin onLoad callbacks before another module fails the pass. Only promote
	// that state after the matching staging tree lands, so a later Tailwind poll
	// cannot publish CSS from a failed build over the last-good site.
	committedCSS     string
	haveCommittedCSS bool
	nextCSS          string
	haveNextCSS      bool
}

// StaticWatchOptions configure the static dev builder.
type StaticWatchOptions struct {
	// Config is the already-loaded puzzle.config.js. `puzzle dev` loads it once
	// at startup and refuses to reload it mid-session, so the builder holds it
	// for its lifetime — same contract as build.Options.Config.
	Config config.Config

	// Tailwind returns the current Tailwind CSS layer. nil means no pipeline.
	Tailwind func() (string, error)

	// Profile enables per-phase rebuild tables. PUZZLE_PROFILE_BUILD is also
	// honored; the explicit option carries `puzzle dev --profile-build`.
	Profile bool
}

// NewStaticWatchBuilder prepares the warm output tree and the two esbuild
// contexts whose inputs are known up front (the browser app pass and the node
// prerender pass). The per-page context cannot exist yet: its entry set comes
// from the first prerender run.
func NewStaticWatchBuilder(root string, opts StaticWatchOptions) (*StaticWatchBuilder, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolving app root: %w", err)
	}
	if _, err := os.Stat(appEntryPath(absRoot)); err != nil {
		return nil, fmt.Errorf("entry point not found: %s (expected app/app.js under %s)", appEntryPath(absRoot), absRoot)
	}

	tmpDir, err := ensureWorkTmp(absRoot)
	if err != nil {
		return nil, fmt.Errorf("creating the build scratch dir under %s: %w", absRoot, err)
	}
	warm := filepath.Join(tmpDir, devStaticWorkDir)
	// Start from nothing: a warm tree left by a previous session may hold entries
	// for routes this app no longer has.
	if err := os.RemoveAll(warm); err != nil {
		return nil, fmt.Errorf("clearing the dev output dir %s: %w", warm, err)
	}
	if err := os.MkdirAll(filepath.Join(warm, prerenderDir, "entries"), 0o755); err != nil {
		return nil, fmt.Errorf("creating the dev output dir %s: %w", warm, err)
	}

	// Route `meta` on an SPA-only route is dead in static output — a one-shot
	// build warns about it once, and so does a dev session (once, at startup,
	// rather than on every save).
	warnDeadSPARouteMeta(absRoot, "static", os.Stderr)

	b := &StaticWatchBuilder{
		root:     absRoot,
		outdir:   filepath.Join(absRoot, "dist"),
		warm:     warm,
		workTmp:  tmpDir,
		cfg:      opts.Config,
		profile:  opts.Profile,
		tailwind: opts.Tailwind,
		cache:    plugin.NewCompileCache(),
		scanner:  plugin.NewUsageScanner(),
		pending:  map[string]bool{},
	}
	if err := b.buildContexts(); err != nil {
		return nil, err
	}
	return b, nil
}

// SetTailwind installs the accessor for the Tailwind layer of the composed
// stylesheet. It exists as a setter rather than a constructor field because the
// dev loop only knows where that layer comes from — the warm `tailwindcss
// --watch` child's private output file, or the one-shot fallback if that child
// never started or has died — after it has decided whether to start a builder
// at all. nil (the default) means the project declares no Tailwind pipeline.
func (b *StaticWatchBuilder) SetTailwind(fn func() (string, error)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.tailwind = fn
}

// RecomposeStyles rewrites the served dist/styles.css from the current Tailwind
// layer and the collected <style>, rendering nothing. It is what the dev loop
// calls when the warm `tailwindcss --watch` child rewrites its output: a utility
// class appearing or disappearing changes the stylesheet and nothing else, and
// styles.css is the one output no page's HTML embeds, so it can be swapped in on
// its own. Asking for a Rebuild instead re-renders the WHOLE site on every save,
// because a styles-only change carries no paths for the classifier to attribute.
//
// It reports whether the bytes on disk actually changed, so the caller can skip
// a reload that would hand the browser what it already has. Until the first
// rebuild has produced a dist/ there is nothing to update and this is a no-op.
func (b *StaticWatchBuilder) RecomposeStyles() (bool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if !b.haveCommittedCSS || !dirExists(b.outdir) {
		return false, nil
	}
	tailwindCSS := ""
	if b.tailwind != nil {
		var err error
		if tailwindCSS, err = b.tailwind(); err != nil {
			return false, err
		}
	}
	final := []byte(styles.Compose(tailwindCSS, b.committedCSS))

	// Compared against the file itself rather than a remembered hash: every
	// staging swap replaces this file behind our back, so what is on disk is the
	// only honest record of what is being served.
	target := filepath.Join(b.outdir, "styles.css")
	if prev, err := os.ReadFile(target); err == nil && bytes.Equal(prev, final) {
		return false, nil
	}
	// Atomic, because the dev server may be handing this exact file out right now.
	if err := fsutil.WriteFileAtomic(target, final, 0o644); err != nil {
		return false, err
	}
	return true, nil
}

// buildContexts (re)creates the app and prerender contexts from the current
// usage scan, disposing whatever was there. It is called at construction and
// whenever a Define frozen into a context goes stale.
func (b *StaticWatchBuilder) buildContexts() error {
	usage, err := scanUsageWith(b.root, b.scanner)
	if err != nil {
		return err
	}

	b.appPl = b.newPlugin(usage)
	b.prePl = b.newPlugin(usage)

	// The app pass: same options a one-shot static build uses (Takeover=false —
	// only hybrid output stamps the marker this bundle would adopt). Metafile is
	// on so a since-un-imported .pzl's <style> can be pruned from the collector
	// exactly as WatchBuilder.Rebuild does. Write is OFF: static output ships no
	// app.js (the one-shot build deletes staging/app.js before the swap), so this
	// pass exists purely to compile every view once — surfacing errors and
	// filling the CSS collector — and its bytes are dropped.
	appOpts := newBundleOptions(b.root, appEntryPath(b.root), filepath.Join(b.warm, "app"), b.appPl, bundleFlags{Dev: true, Takeover: false})
	appOpts.Write = false
	appOpts.Metafile = true
	appCtx, ctxErr := api.Context(appOpts)
	if ctxErr != nil {
		return fmt.Errorf("puzzle dev: creating esbuild context: %s", ctxErr.Error())
	}

	preStdin, err := staticPrerenderStdin(b.root)
	if err != nil {
		appCtx.Dispose()
		return err
	}
	preOpts := prerenderBundleOptions(
		b.root, preStdin, filepath.Join(b.warm, prerenderDir, "prerender.mjs"), b.prePl,
	)
	// The prerender bundle's module graph is what tells a change apart from a
	// render-wide one (route_deps.go): app.js, routes.js, the models registry and
	// the formatters module live here and nowhere else.
	preOpts.Metafile = true
	preCtx, ctxErr := api.Context(preOpts)
	if ctxErr != nil {
		appCtx.Dispose()
		return fmt.Errorf("puzzle dev: creating prerender esbuild context: %s", ctxErr.Error())
	}

	b.disposeContexts()
	b.appCtx, b.preCtx = appCtx, preCtx
	b.usage = usage
	b.defined = usage.Features()
	// The page context's Defines are frozen too, so it has to go with the others;
	// the next Rebuild recreates it from its (freshly generated) entry set.
	b.pageEntries = nil
	return nil
}

// newPlugin builds a per-context Plugin sharing the session's transform memo and
// the current usage facts — the long-lived analogue of passContext.plugin.
func (b *StaticWatchBuilder) newPlugin(usage plugin.Usage) *plugin.Plugin {
	pl := plugin.New(b.root)
	pl.SetUsage(usage)
	pl.SetCompileCache(b.cache)
	return pl
}

// Rebuild runs one incremental static build over the current sources and, on
// success, atomically swaps the result in for dist/. changed is the debounced
// watcher burst; it drives cache eviction only, never what gets rebuilt (esbuild
// owns that question).
//
// Every failure path leaves dist/ exactly as it was: staging is discarded and
// the error is returned for the caller to print and push down the D92 channel.
func (b *StaticWatchBuilder) Rebuild(changed []string) error {
	prof := NewPhaseProfile(ProfileEnabled(b.profile), "puzzle dev · rebuild")
	defer prof.Report(os.Stderr)
	return b.rebuild(changed, prof)
}

// RebuildProfile folds this rebuild into a caller-owned profile, used for the
// initial dev startup table.
func (b *StaticWatchBuilder) RebuildProfile(changed []string, prof *PhaseProfile) error {
	return b.rebuild(changed, prof)
}

func (b *StaticWatchBuilder) rebuild(changed []string, prof *PhaseProfile) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Which routes this save can reach, decided BEFORE the compile memo is
	// evicted: the {#svg} edge classification depends on lives in that memo's
	// asset index, and eviction is exactly what drops it.
	endClassify := prof.phase("route classify")
	for _, p := range changed {
		b.pending[p] = true
	}
	batch := make([]string, 0, len(b.pending))
	for p := range b.pending {
		batch = append(batch, p)
	}
	sort.Strings(batch)
	plan := b.graph.classify(b.root, batch, b.cache.AssetConsumers)
	b.lastPlan = plan
	endClassify()

	// The transform memo is keyed by content hash, so a changed .pzl misses on
	// its own; this eviction is what invalidates a .pzl whose bytes did NOT
	// change but whose inlined {#svg} asset did (and it keeps the map from
	// growing per save).
	endEvict := prof.phase("cache evict")
	b.cache.Evict(changed)
	endEvict()

	// Feature defines are frozen into every context. A source edit that turns one
	// on or off invalidates all three, so rebuild them before doing any work —
	// still far cheaper than a cold build, and the pathological case (an edit
	// that flips `flip` usage) is rare.
	endScan := prof.phase("usage scan")
	usage, err := scanUsageWith(b.root, b.scanner)
	if err != nil {
		endScan()
		return err
	}
	if usage.Features() != b.defined {
		endScan()
		if err := b.buildContexts(); err != nil {
			return err
		}
	} else {
		// Same defines: refresh the formatter manifest's backing state in place.
		b.usage = usage
		b.appPl.SetUsage(usage)
		b.prePl.SetUsage(usage)
		if b.pagesPl != nil {
			b.pagesPl.SetUsage(usage)
		}
		endScan()
	}

	// One attempt at the plan the classifier chose, then — if anything about the
	// partial path itself went wrong — one unconditional full render. A compile
	// error, a failed prerender or a failed swap is NOT a fallback trigger: it is
	// the same error a full render would produce, and retrying it would only
	// double the time to the diagnostic.
	staging, err := b.attempt(plan, prof)
	if err != nil {
		var fb partialFallback
		if !errors.As(err, &fb) {
			return err
		}
		if prof != nil {
			fmt.Fprintf(os.Stderr, "  puzzle dev · partial render fell back to full: %v\n", fb.cause)
		}
		b.lastPlan = fullRender("partial render fell back")
		if staging, err = b.attempt(b.lastPlan, prof); err != nil {
			return err
		}
	}

	endSwap := prof.phase("staging swap")
	swapErr := swapOutputWith(staging, b.outdir, b.workTmp, true)
	endSwap()
	if swapErr != nil {
		os.RemoveAll(staging)
		return swapErr
	}
	// Only now does what this rebuild rendered describe what is being served, so
	// only now may its graph replace the old one and its changes stop being
	// pending.
	if b.haveNextCSS {
		b.committedCSS = b.nextCSS
		b.haveCommittedCSS = true
		b.nextCSS = ""
		b.haveNextCSS = false
	}
	b.commitGraph()
	return nil
}

// commitGraph adopts the graph the last successful rebuildInto captured and
// forgets the accumulated pending change set: the served tree now matches the
// imports that graph describes. A rebuild that could not build a graph (either
// metafile missing or unreadable) leaves the previous one in place and clears
// nothing, so the next save is classified conservatively.
func (b *StaticWatchBuilder) commitGraph() {
	if b.nextGraph == nil {
		return
	}
	b.graph = b.nextGraph
	b.routeCount = b.nextRouteCount
	b.pending = map[string]bool{}
	b.nextGraph = nil
	b.nextCSS = ""
	b.haveNextCSS = false
}

// attempt assembles one complete staging tree for plan and returns it ready to
// swap. Every failure path removes the tree it created, so the caller only ever
// holds a directory it is about to swap in.
func (b *StaticWatchBuilder) attempt(plan renderPlan, prof *buildProfile) (string, error) {
	staging, err := os.MkdirTemp(b.workTmp, stagingPrefix+"*")
	if err != nil {
		return "", fmt.Errorf("creating build staging dir under %s: %w", b.workTmp, err)
	}
	_ = os.Chmod(staging, 0o755)
	// Same reason as the one-shot path: this tree's writes land in
	// subdirectories, so only a heartbeat keeps it out of a sibling sweep.
	defer keepWorkDirFresh(staging)()
	if err := b.rebuildInto(staging, prof, plan); err != nil {
		os.RemoveAll(staging)
		return "", err
	}
	return staging, nil
}

// partialFallback marks the failures that mean "this rebuild cannot be done
// partially" rather than "this project does not build". Only the route-level
// path produces it, and the only cure is a full render.
type partialFallback struct{ cause error }

func (e partialFallback) Error() string { return "partial render unavailable: " + e.cause.Error() }
func (e partialFallback) Unwrap() error { return e.cause }

// rebuildInto assembles one complete static site inside staging. It mirrors the
// one-shot pipeline's order and its guards; anything it returns discards
// staging.
func (b *StaticWatchBuilder) rebuildInto(staging string, prof *buildProfile, plan renderPlan) error {
	// Nothing this attempt captures is committed until its tree is swapped in, and
	// a previous attempt's capture must never be: drop it up front so an early
	// return here cannot leave one behind for commitGraph to adopt.
	b.nextGraph = nil

	// 1. The app pass — compile everything, collect <style>, report errors.
	endBundle := prof.phase("browser bundle")
	appResult := b.appCtx.Rebuild()
	endBundle()
	if len(appResult.Errors) > 0 {
		return formatBuildErrors("puzzle build failed", appResult.Errors)
	}
	if appResult.Metafile != "" {
		if keep, err := metafileInputs(appResult.Metafile); err == nil {
			b.appPl.PruneCSS(keep)
		}
	}
	candidateCSS := b.appPl.CSS()

	// 2. Public assets, into the private staging tree (plain writes, no atomic
	//    dance: nothing can observe staging until the swap).
	endPublic := prof.phase("public copy")
	publicFiles, err := copyPublic(b.root, staging, copyIntoStaging)
	endPublic()
	if err != nil {
		return fmt.Errorf("copying public assets: %w", err)
	}

	// 3. The stylesheet, composed into staging rather than written over the
	//    dist/styles.css the server is currently handing out.
	endStyles := prof.phase("styles compose")
	tailwindCSS := ""
	if b.tailwind != nil {
		tailwindCSS, err = b.tailwind()
		if err != nil {
			endStyles()
			return err
		}
	}
	writeErr := os.WriteFile(filepath.Join(staging, "styles.css"), []byte(styles.Compose(tailwindCSS, candidateCSS)), 0o644)
	endStyles()
	if writeErr != nil {
		return fmt.Errorf("writing styles.css: %w", writeErr)
	}

	// 4. The same reserved-name guards the one-shot build applies once public/
	//    has landed: a public asset sitting at _puzzle/ or .puzzle-prerender/
	//    would be silently consumed.
	if pagesOut := filepath.Join(staging, staticPagesDir); dirExists(pagesOut) || FileExists(pagesOut) {
		return fmt.Errorf(
			"public asset would overwrite compiler output dist/%s (a reserved output name in static mode); rename or remove it",
			staticPagesDir,
		)
	}
	if err := checkPrerenderScratchCollision(b.root, staging, "--static"); err != nil {
		return err
	}

	// 5. The node prerender bundle, then the render run itself. The bundle lands
	//    in the warm tree (a stable Outfile the context can own); the render
	//    writes its pages into staging.
	endPrerenderBundle := prof.phase("prerender bundle")
	preResult := b.preCtx.Rebuild()
	endPrerenderBundle()
	if len(preResult.Errors) > 0 {
		return formatBuildErrors("puzzle build --static: prerender bundle failed", preResult.Errors)
	}

	// The subset render (D155). The node process still starts, still runs
	// beforeMount, and still enumerates, skips, claims and slugs EVERY route —
	// only the render + serialize + write of the unaffected ones is skipped, and
	// their last-good HTML is copied in below. Nothing is passed for a full
	// render, which is byte-for-byte the pre-D155 call.
	var only []string
	if !plan.full {
		only = plan.routes
		if only == nil {
			only = []string{}
		}
	}
	renderArgs, argErr := prerenderOnlyArgs(only, plan.full)
	if argErr != nil {
		return partialFallback{argErr}
	}

	renderPhase := "prerender render"
	if !plan.full {
		renderPhase = fmt.Sprintf("partial render (%d/%d routes)", len(only), b.routeCount)
	}
	endRender := prof.phase(renderPhase)
	payload, err := runPrerender(filepath.Join(b.warm, prerenderDir, "prerender.mjs"), staging, "--static", renderArgs...)
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
		if err := checkPrerenderCollision(b.root, staging, owners, page.Path, page.File); err != nil {
			return err
		}
	}

	// 5b. Every page the render skipped gets its last-good HTML back, taken from
	//     the tree currently being served. A page that is missing there — a first
	//     rebuild, a hand-deleted dist/, a route the previous render skipped —
	//     means this staging tree would ship incomplete, so the whole rebuild
	//     restarts as a full render.
	if !plan.full {
		endReuse := prof.phase(fmt.Sprintf("page reuse (%d/%d)", countReused(summary), len(summary.Written)))
		reuseErr := b.reusePages(staging, summary)
		endReuse()
		if reuseErr != nil {
			return partialFallback{reuseErr}
		}
	}

	// 6. Per-page entries, and the page context that bundles them.
	endEntries := prof.phase("page entries")
	entryFiles, err := b.syncPageEntries(summary)
	endEntries()
	if err != nil {
		return err
	}

	pagesMetafile := ""
	if len(entryFiles) > 0 {
		endPages := prof.phase("per-page bundles")
		var pagesErr error
		pagesMetafile, pagesErr = b.bundlePages(staging, entryFiles)
		endPages()
		if pagesErr != nil {
			return pagesErr
		}
	}

	// 7. Refresh the reverse dependency graph from the two metafiles this rebuild
	//    just produced. Both are complete even after a subset render — the page
	//    pass always bundles every entry and the prerender bundle is never
	//    filtered — so a partial rebuild leaves the next one just as well
	//    informed. It is only STAGED here; commitGraph installs it once the swap
	//    has put the matching tree in dist/.
	endGraph := prof.phase("route graph")
	b.captureGraph(summary, pagesMetafile, preResult.Metafile)
	endGraph()
	b.nextCSS = candidateCSS
	b.haveNextCSS = true

	printStaticSummary(summary, len(entryFiles))
	return nil
}

// captureGraph rebuilds the module→routes graph from this rebuild's metafiles
// and parks it for commitGraph. Anything it cannot build simply leaves nothing
// staged.
func (b *StaticWatchBuilder) captureGraph(summary staticSummary, pagesMetafile, preMetafile string) {
	if pagesMetafile == "" || preMetafile == "" {
		return
	}
	cwd, err := os.Getwd()
	if err != nil {
		return
	}
	entriesDir := filepath.Join(b.warm, prerenderDir, "entries")
	entryRoutes := make(map[string]string, len(summary.Written))
	// The chain roots the render-wide walk cuts at: every view and layout the
	// summary named, in the same absolute, symlink-resolved spelling the
	// metafiles resolve to. The stamps are app-relative POSIX paths, except when
	// a .pzl resolved outside the app root — absModuleImport owns that
	// distinction, and going through it is what keeps a symlinked or monorepo
	// layout from silently producing zero chain roots (which would demote every
	// rebuild to a full render).
	chainRoots := make(map[string]bool, len(summary.Written)*2)
	addChainRoot := func(mod string) {
		chainRoots[resolvePath(filepath.FromSlash(absModuleImport(b.root, mod)))] = true
	}
	for _, page := range summary.Written {
		slug, err := slugFromEntry(page.Entry)
		if err != nil {
			return
		}
		entryRoutes[filepath.Join(entriesDir, slug+".js")] = page.Path
		for _, mod := range page.Modules.Views {
			addChainRoot(mod)
		}
		if page.Modules.Layout != nil {
			addChainRoot(*page.Modules.Layout)
		}
	}
	// The page pass anchors AbsWorkingDir to its output tree's parent (the warm
	// root); the prerender pass sets none, so esbuild resolved its metafile keys
	// against the process working directory.
	graph, err := buildRouteGraph(pagesMetafile, b.warm, preMetafile, cwd, entryRoutes, chainRoots)
	if err != nil {
		return
	}
	b.nextGraph = graph
	b.nextRouteCount = len(summary.Written)
}

// prerenderOnlyArgs renders the route filter as the generated prerender entry's
// argv[4]. A full render passes nothing at all, so the node command line is
// byte-identical to the pre-D155 one.
func prerenderOnlyArgs(only []string, full bool) ([]string, error) {
	if full {
		return nil, nil
	}
	encoded, err := json.Marshal(only)
	if err != nil {
		return nil, fmt.Errorf("encoding the route filter: %w", err)
	}
	return []string{string(encoded)}, nil
}

// countReused reports how many of a summary's pages were not rendered.
func countReused(summary staticSummary) int {
	n := 0
	for _, page := range summary.Written {
		if page.Reused {
			n++
		}
	}
	return n
}

// reusePages puts every page the subset render skipped back where the render
// would have written it, taken from the tree that is currently being served.
//
// The link is a HARDLINK where the filesystem allows one, with a byte copy as
// the fallback. D154 rejected hardlinking dist/ because esbuild rewrites its
// output files in place — but these are not esbuild outputs. A prerendered page
// is written once by the node pass and then only ever replaced wholesale by the
// next staging swap (which unlinks the old tree, leaving this link the sole
// owner of the inode), so the two trees can share bytes without either being
// able to mutate the other's view of them.
// It runs with the same bounded concurrency the SSG writer uses, and for the
// same reason: a page is independent of every other, and done one at a time the
// whole rebuild queues behind the filesystem.
func (b *StaticWatchBuilder) reusePages(staging string, summary staticSummary) error {
	type job struct{ src, dst, route string }
	jobs := make([]job, 0, len(summary.Written))
	dirs := map[string]bool{}
	for _, page := range summary.Written {
		if !page.Reused {
			continue
		}
		rel, err := filepath.Rel(staging, page.File)
		if err != nil || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("reused page %s resolved outside staging (%s)", page.Path, page.File)
		}
		jobs = append(jobs, job{src: filepath.Join(b.outdir, rel), dst: page.File, route: page.Path})
		dirs[filepath.Dir(page.File)] = true
	}
	// Directories first, on one goroutine: a static site's pages share parents
	// heavily, so this is far fewer mkdirs than one per page and it keeps the
	// workers doing nothing but linking.
	for dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	const workers = 16
	var wg sync.WaitGroup
	var next int64
	errs := make([]error, workers)
	for w := 0; w < workers && w < len(jobs); w++ {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			for {
				i := int(atomic.AddInt64(&next, 1)) - 1
				if i >= len(jobs) || errs[slot] != nil {
					return
				}
				j := jobs[i]
				if err := os.Link(j.src, j.dst); err == nil {
					continue
				}
				data, err := os.ReadFile(j.src)
				if err != nil {
					errs[slot] = fmt.Errorf("no last-good output for route %s: %w", j.route, err)
					return
				}
				if err := os.WriteFile(j.dst, data, 0o644); err != nil {
					errs[slot] = err
					return
				}
			}
		}(w)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

// syncPageEntries regenerates the generated mountStatic entry modules in the
// warm tree and returns the entry list for this rebuild, replacing the page
// esbuild context when the set changed.
//
// Entry files are rewritten only when their bytes differ: an untouched entry
// keeps its mtime, so esbuild's incremental pass treats it as a cache hit rather
// than re-reading and re-bundling every page on every save.
func (b *StaticWatchBuilder) syncPageEntries(summary staticSummary) ([]string, error) {
	modelsModule := findStaticModule(b.root, "app/models/index.js", "app/models/index.ts")
	formattersModule := findStaticModule(b.root, "app/formatters.js", "app/formatters.ts")
	adapterModule := findStaticModule(b.root, "app/adapter.js", "app/adapter.ts")

	entriesDir := filepath.Join(b.warm, prerenderDir, "entries")
	if err := os.MkdirAll(entriesDir, 0o755); err != nil {
		return nil, fmt.Errorf("puzzle build --static: creating entry dir: %w", err)
	}

	var entryFiles []string
	live := map[string]bool{}
	for _, page := range summary.Written {
		slug, err := slugFromEntry(page.Entry)
		if err != nil {
			return nil, err
		}
		src, err := staticEntrySource(b.root, page, summary, modelsModule, formattersModule, adapterModule)
		if err != nil {
			return nil, err
		}
		file := filepath.Join(entriesDir, slug+".js")
		if prev, err := os.ReadFile(file); err != nil || string(prev) != src {
			if err := os.WriteFile(file, []byte(src), 0o644); err != nil {
				return nil, fmt.Errorf("puzzle build --static: writing entry %s: %w", slug, err)
			}
		}
		entryFiles = append(entryFiles, file)
		live[file] = true
	}

	// Drop entries for routes that no longer exist, so the warm tree never grows
	// a page the app has deleted.
	if names, err := os.ReadDir(entriesDir); err == nil {
		for _, e := range names {
			p := filepath.Join(entriesDir, e.Name())
			if !e.IsDir() && !live[p] {
				_ = os.Remove(p)
			}
		}
	}

	if sameEntrySet(b.pageEntries, entryFiles) {
		return entryFiles, nil
	}
	// The entry list is frozen into the context, so a route added, removed, or
	// renamed means a new one. Everything the old context cached about UNCHANGED
	// entries is lost, which is why this is gated on the set actually differing
	// rather than done per rebuild.
	next, err := b.newPagesContext(entryFiles)
	if err != nil {
		return nil, err
	}
	if b.pagesCtx != nil {
		b.pagesCtx.Dispose()
	}
	b.pagesCtx = next
	b.pageEntries = entryFiles
	return entryFiles, nil
}

// newPagesContext creates the multi-entry, code-splitting browser context for
// the current page set. Its Outdir is the warm `_puzzle` — which is never
// written, since the pass runs with Write:false — chosen so the output-relative
// paths esbuild bakes into each .js.map match a one-shot build's exactly.
func (b *StaticWatchBuilder) newPagesContext(entryFiles []string) (api.BuildContext, error) {
	if len(entryFiles) == 0 {
		return nil, nil
	}
	b.pagesPl = b.newPlugin(b.usage)
	opts := staticPagesBundleOptions(b.root, entryFiles, filepath.Join(b.warm, staticPagesDir), b.cfg, true, b.pagesPl)
	opts.Write = false
	// One graph per route, rooted at that route's generated entry: the half of
	// the reverse dependency graph that makes an edit attributable (route_deps.go).
	opts.Metafile = true
	ctx, err := api.Context(opts)
	if err != nil {
		return nil, fmt.Errorf("puzzle dev: creating per-page esbuild context: %s", err.Error())
	}
	return ctx, nil
}

// bundlePages runs the page context and materializes its outputs under
// staging/_puzzle. Writing the OutputFiles ourselves (rather than letting
// esbuild write into a warm directory we then copy) is what prunes the tree: a
// deleted page's bundle and a re-hashed shared chunk simply never appear,
// because staging holds only what this rebuild produced.
// It also hands back the pass's metafile, the per-route half of the reverse
// dependency graph (route_deps.go).
func (b *StaticWatchBuilder) bundlePages(staging string, entryFiles []string) (string, error) {
	if b.pagesCtx == nil {
		return "", fmt.Errorf("puzzle dev: per-page esbuild context missing for %d entries", len(entryFiles))
	}
	result := b.pagesCtx.Rebuild()
	if len(result.Errors) > 0 {
		return "", formatBuildErrors("puzzle build --static: per-page bundle failed", result.Errors)
	}
	warmPages := filepath.Join(b.warm, staticPagesDir)
	stagingPages := filepath.Join(staging, staticPagesDir)
	for _, out := range result.OutputFiles {
		rel, err := filepath.Rel(warmPages, out.Path)
		if err != nil || strings.HasPrefix(rel, "..") {
			return "", fmt.Errorf("puzzle dev: unexpected per-page output path %s", out.Path)
		}
		target := filepath.Join(stagingPages, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(target, out.Contents, 0o644); err != nil {
			return "", fmt.Errorf("puzzle dev: writing page bundle %s: %w", rel, err)
		}
	}
	return result.Metafile, nil
}

// Dispose releases every esbuild context. After Dispose the builder must not be
// used. The warm tree is left in place: it lives under the self-ignoring
// .puzzle/ scratch root, and the next session clears it at construction.
func (b *StaticWatchBuilder) Dispose() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.disposeContexts()
	if b.pagesCtx != nil {
		b.pagesCtx.Dispose()
		b.pagesCtx = nil
	}
}

func (b *StaticWatchBuilder) disposeContexts() {
	if b.appCtx != nil {
		b.appCtx.Dispose()
		b.appCtx = nil
	}
	if b.preCtx != nil {
		b.preCtx.Dispose()
		b.preCtx = nil
	}
	if b.pagesCtx != nil {
		b.pagesCtx.Dispose()
		b.pagesCtx = nil
	}
}

// sameEntrySet compares two entry lists as SETS: the prerender summary decides
// the order, and a reordering with identical members does not need a new
// context (esbuild derives every output name from the entry basename, and
// chunk names are content-hashed).
func sameEntrySet(a, b []string) bool {
	if len(a) != len(b) || len(a) == 0 {
		return len(a) == len(b) && len(a) > 0
	}
	x := append([]string(nil), a...)
	y := append([]string(nil), b...)
	sort.Strings(x)
	sort.Strings(y)
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}

// formatBuildErrors renders esbuild diagnostics the way every other build path
// does, so a dev failure reads identically to a `puzzle build` failure.
func formatBuildErrors(prefix string, errs []api.Message) error {
	lines := api.FormatMessages(errs, api.FormatMessagesOptions{
		Kind:          api.ErrorMessage,
		Color:         ui.New(os.Stderr).Enabled(),
		TerminalWidth: 0,
	})
	return fmt.Errorf("%s:\n%s", prefix, strings.Join(lines, "\n"))
}
