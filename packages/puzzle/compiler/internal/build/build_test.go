package build

import (
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
)

// fakeRunner is a styles.Runner that returns canned CSS instead of shelling out
// to the real Tailwind CLI, so build tests are deterministic and offline-safe.
type fakeRunner struct {
	css        string
	production bool // records the last opts.Production it saw
	called     bool
}

func (f *fakeRunner) Run(opts styles.RunOptions) (string, error) {
	f.called = true
	f.production = opts.Production
	return f.css, nil
}

// TestRunBrowserAndTailwindOverlapAndJoin pins the concurrency contract without
// relying on wall-clock timing: both lanes must reach their barriers before
// either is released, and the helper must not return while either lane remains
// blocked.
func TestRunBrowserAndTailwindOverlapAndJoin(t *testing.T) {
	browserStarted := make(chan struct{})
	tailwindStarted := make(chan struct{})
	releaseBrowser := make(chan struct{})
	releaseTailwind := make(chan struct{})

	type joinedResult struct {
		browser api.BuildResult
		css     string
		err     error
	}
	done := make(chan joinedResult, 1)
	go func() {
		browser, css, err := runBrowserAndTailwind(
			func() api.BuildResult {
				close(browserStarted)
				<-releaseBrowser
				return api.BuildResult{Metafile: "browser-result"}
			},
			func() (string, error) {
				close(tailwindStarted)
				<-releaseTailwind
				return "tailwind-result", nil
			},
		)
		done <- joinedResult{browser: browser, css: css, err: err}
	}()

	for name, started := range map[string]<-chan struct{}{
		"browser":  browserStarted,
		"tailwind": tailwindStarted,
	} {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			t.Fatalf("%s lane did not start while the other lane was blocked", name)
		}
	}

	close(releaseBrowser)
	select {
	case <-done:
		t.Fatal("helper returned before the Tailwind lane completed")
	default:
	}

	close(releaseTailwind)
	select {
	case got := <-done:
		if got.browser.Metafile != "browser-result" {
			t.Errorf("browser result was lost: %+v", got.browser)
		}
		if got.css != "tailwind-result" || got.err != nil {
			t.Errorf("Tailwind result = (%q, %v), want (%q, nil)", got.css, got.err, "tailwind-result")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("helper did not return after both lanes completed")
	}
}

// exampleRoot locates the in-repo examples/todos relative to this test file
// (compiler/internal/build → ../../../examples/todos).
func exampleRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(wd, "..", "..", "..", "examples/todos"))
	if _, err := os.Stat(filepath.Join(root, "app", "app.js")); err != nil {
		t.Fatalf("examples/todos not found at %s: %v", root, err)
	}
	return root
}

// TestBuildExample builds the real in-repo examples/todos in development mode.
// Building in place (rather than a temp copy) is deliberate: the
// '@magic-spells/puzzle' alias resolves by walking up to the repo's
// client-runtime, which only exists inside the checkout.
func TestBuildExample(t *testing.T) {
	root := exampleRoot(t)

	// The example declares the Tailwind pipeline (puzzle.config.js), which is
	// unavailable in most CI/offline environments. Inject a fake runner so the
	// test exercises composition, not the real toolchain, and can assert the
	// Tailwind layer lands ahead of the collected <style> blocks.
	fake := &fakeRunner{css: "/* TAILWIND-LAYER */\n.tw-marker{color:red}"}
	if err := Build(root, Options{Development: true, Runner: fake}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	if !fake.called {
		t.Error("expected the Tailwind runner to be invoked (puzzle.config.js declares it)")
	}

	dist := filepath.Join(root, "dist")
	for _, f := range []string{"app.js", "styles.css", "index.html"} {
		if _, err := os.Stat(filepath.Join(dist, f)); err != nil {
			t.Errorf("expected dist/%s: %v", f, err)
		}
	}

	appJS, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	// Development mode leaves identifiers intact, so the render assignment reads
	// literally.
	if !strings.Contains(string(appJS), "TodoHome.prototype.render") {
		t.Errorf("development bundle missing readable 'TodoHome.prototype.render'")
	}

	css, err := os.ReadFile(filepath.Join(dist, "styles.css"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(css), "TAILWIND-LAYER") {
		t.Errorf("styles.css missing the Tailwind layer:\n%s", css)
	}
}

// TestBuildDevDefineDCE proves the __PUZZLE_DEV__ build define drives the
// state-preserving HMR machinery end to end (constellation/doc/DOC-SPEC.md §27, D57): a
// development build (define = true) retains the runtime's HMR sessionStorage key
// (__puzzleHMR); a production build (define = false) lets MinifySyntax dead-code-
// eliminate every DEV-guarded branch, so the key — and the whole devstate module
// — vanish from the bundle. Builds the real examples/todos (which imports the
// runtime, so the guarded code is actually reachable) with a fake Tailwind runner.
func TestBuildDevDefineDCE(t *testing.T) {
	root := exampleRoot(t)
	distApp := filepath.Join(root, "dist", "app.js")
	var devMetafile string

	// Development: the guarded HMR code — and its sessionStorage key — survive.
	if err := Build(root, Options{
		Development: true,
		Runner:      &fakeRunner{css: "/* tw */"},
		Metafile:    &devMetafile,
	}); err != nil {
		t.Fatalf("dev Build failed: %v", err)
	}
	devJS, err := os.ReadFile(distApp)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(devJS), "__puzzleHMR") {
		t.Errorf("dev bundle should retain the HMR sessionStorage key (__PUZZLE_DEV__ define = true)")
	}
	if !strings.Contains(string(devJS), "__PUZZLE_APP__") {
		t.Errorf("dev bundle should publish window.__PUZZLE_APP__ (__PUZZLE_DEV__ define = true)")
	}
	if !strings.Contains(string(devJS), "__PUZZLE_DEVTOOLS_HOOK__") {
		t.Errorf("dev bundle should retain the DevTools bridge hook global (__PUZZLE_DEV__ define = true)")
	}
	if !strings.Contains(string(devJS), devperfSentinel) {
		t.Errorf("dev bundle should retain the dev performance sentinel (__PUZZLE_DEV__ define = true)")
	}
	if !strings.Contains(string(devJS), profileRequestSentinel) {
		t.Errorf("dev bundle should retain the profiler bridge request %q (__PUZZLE_DEV__ define = true)", profileRequestSentinel)
	}

	// Production: DCE strips every DEV-guarded branch — no __puzzleHMR reaches
	// the bundle (zero production cost).
	var prodMetafile string
	if err := Build(root, Options{
		Development: false,
		Runner:      &fakeRunner{css: "/* tw */"},
		Metafile:    &prodMetafile,
	}); err != nil {
		t.Fatalf("prod Build failed: %v", err)
	}
	prodJS, err := os.ReadFile(distApp)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(prodJS), "__puzzleHMR") {
		t.Errorf("production bundle must DCE the HMR machinery — found __puzzleHMR present")
	}
	// The window publish must fold away too — this specifically guards the
	// INLINE-probe idiom in app.js/PuzzleView.js: a shared `const DEV` does not
	// constant-propagate into class-method scopes and leaves dead `Z && …`
	// guards (with this string) in the bundle. Only the inert empty
	// __devSnapshot METHOD may remain (removing a method changes the class API).
	if strings.Contains(string(prodJS), "__PUZZLE_APP__") {
		t.Errorf("production bundle must DCE the window.__PUZZLE_APP__ publish — inline the __PUZZLE_DEV__ probe, do not hoist it into a const")
	}
	// The DevTools bridge (D100) must vanish the same way: its call sites in
	// app.js/store.js/router.js fold away, devtools.js loses its last importer,
	// and the whole module — hook global included — tree-shakes out.
	if strings.Contains(string(prodJS), "__PUZZLE_DEVTOOLS_HOOK__") {
		t.Errorf("production bundle must DCE the DevTools bridge — found the __PUZZLE_DEVTOOLS_HOOK__ global present")
	}
	if strings.Contains(string(prodJS), devperfSentinel) {
		t.Errorf("production bundle must DCE dev performance instrumentation — found %s present", devperfSentinel)
	}
	// The profiler seam leaves with the bridge (D121): the devperf sink
	// devtools.js installs must not turn devtools.js into a live importer that
	// drags devperf.js — or the profiler's own request strings — into production.
	if strings.Contains(string(prodJS), profileRequestSentinel) {
		t.Errorf("production bundle must DCE the profiler bridge — found the %q request present", profileRequestSentinel)
	}
	if bytes := metafileBytesInOutput(t, prodMetafile, "client-runtime/devperf.js"); bytes != 0 {
		t.Errorf("production devperf.js bytesInOutput = %d, want 0", bytes)
	}
	if bytes := metafileBytesInOutput(t, devMetafile, "client-runtime/devperf.js"); bytes == 0 {
		t.Errorf("development devperf.js bytesInOutput = 0, want a positive contribution")
	}
}

// devperfSentinel is a minification-proof literal unique to devperf.js.
const devperfSentinel = "__PUZZLE_PERF__"

// profileRequestSentinel is a minification-proof literal unique to the profiler
// half of the DevTools bridge (devtools.js, D121) — a request type, so minifying
// cannot rename it away.
const profileRequestSentinel = "snapshot:profile"

// metafileBytesInOutput sums one source input's attributed bytes across every
// esbuild output. An input omitted from an output contributes zero.
func metafileBytesInOutput(t *testing.T, raw, sourceSuffix string) int {
	t.Helper()
	var meta struct {
		Outputs map[string]struct {
			Inputs map[string]struct {
				BytesInOutput int `json:"bytesInOutput"`
			} `json:"inputs"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		t.Fatalf("parsing esbuild metafile: %v", err)
	}
	total := 0
	for _, output := range meta.Outputs {
		for input, contribution := range output.Inputs {
			if strings.HasSuffix(filepath.ToSlash(input), sourceSuffix) {
				total += contribution.BytesInOutput
			}
		}
	}
	return total
}

// ssgTakeoverMarker is the attribute the prerender stamps on a hybrid page's
// mount target — the router's ONLY takeover signal, and a string literal, so it
// survives minification. Its ABSENCE from a bundle is real evidence the router's
// three takeover branches folded away rather than merely got renamed.
const ssgTakeoverMarker = "data-puzzle-ssg"

// preloadModuleLinked reports whether ssg/preload.js is linked into a bundle.
// `instance.__takeoverTree = expanded` (preload.js) is the only ASSIGNMENT to
// that property anywhere in the runtime — PuzzleView.js reads and deletes it,
// never writes it — and property names survive minification. So this one probe
// works on minified and readable output alike, including the static per-page
// bundles, for which no metafile is requested.
func preloadModuleLinked(js string) bool {
	return strings.Contains(js, "__takeoverTree =") || strings.Contains(js, "__takeoverTree=")
}

// TestBuildTakeoverDefineDCE proves the __PUZZLE_TAKEOVER__ build define keeps
// prerender-takeover code out of the bundles that can never run it, and leaves it
// in the ones that can. The gate is per-OUTPUT-MODE, not per-dev-mode: only
// `output: 'hybrid'` emits a data-puzzle-ssg container for the router to adopt.
//
// The runtime probes it as `typeof __PUZZLE_TAKEOVER__ === 'undefined' ||
// __PUZZLE_TAKEOVER__`, inline at each branch — hoisting it into a module const
// would leave the branches in the bundle (the same trap TestBuildDevDefineDCE
// documents for __PUZZLE_DEV__), so the SPA subtest below is what catches that.
func TestBuildTakeoverDefineDCE(t *testing.T) {
	// A plain SPA bundle can never take over: nothing ever stamps the marker, so
	// all three branches are unreachable. Folding them drops
	// preloadTakeoverComponents' last importer, and "sideEffects": false then lets
	// ssg/preload.js leave the bundle entirely (metafile: zero attributed bytes).
	//
	// The name sweep is the stronger claim, and it only became true once EVERY
	// takeover touchpoint was gated: the ViewNode constructor's two field stores,
	// viewManager's stripSlotAttr/expandNode copies, mountComponent's reads and its
	// mount-failure reset, and PuzzleView.mount's __takeoverTree probe+delete. Any
	// ONE of those left ungated puts its property name back in the bundle —
	// property names survive minification, so their absence is real evidence the
	// stores are gone, not merely renamed.
	t.Run("spa production build ships no takeover path", func(t *testing.T) {
		root := writeSSGFixture(t, baseSSGFixture())
		var meta string
		if err := Build(root, Options{Development: false, Metafile: &meta}); err != nil {
			t.Fatalf("SPA Build failed: %v", err)
		}
		js := readFile(t, filepath.Join(root, "dist", "app.js"))
		for _, name := range []string{
			ssgTakeoverMarker, // the router's only takeover signal
			"takeoverPreloaded",
			"takeoverFailed",
			"__takeoverTree",
		} {
			if strings.Contains(js, name) {
				t.Errorf("SPA bundle must DCE every takeover touchpoint — found %q present", name)
			}
		}
		if preloadModuleLinked(js) {
			t.Error("SPA bundle must tree-shake ssg/preload.js — found its __takeoverTree assignment")
		}
		if b := metafileBytesInOutput(t, meta, "client-runtime/ssg/preload.js"); b != 0 {
			t.Errorf("SPA ssg/preload.js bytesInOutput = %d, want 0", b)
		}
	})

	// Hybrid is the one browser bundle that adopts prerendered DOM. Asserting the
	// emitted HTML carries the marker too keeps this honest: the retained branches
	// are reachable, not just present.
	t.Run("hybrid keeps the takeover path and marks the container", func(t *testing.T) {
		requireSSGRuntime(t)
		root := writeSSGFixture(t, baseSSGFixture())
		var meta string
		if err := Build(root, Options{Development: false, Output: "hybrid", Metafile: &meta}); err != nil {
			t.Fatalf("hybrid Build failed: %v", err)
		}
		js := readFile(t, filepath.Join(root, "dist", "app.js"))
		if !strings.Contains(js, ssgTakeoverMarker) {
			t.Errorf("hybrid bundle must retain the router's takeover branches (%q)", ssgTakeoverMarker)
		}
		if !preloadModuleLinked(js) {
			t.Error("hybrid bundle must retain ssg/preload.js")
		}
		if b := metafileBytesInOutput(t, meta, "client-runtime/ssg/preload.js"); b == 0 {
			t.Error("hybrid ssg/preload.js bytesInOutput = 0, want a positive contribution")
		}
		home := readFile(t, filepath.Join(root, "dist", "index.html"))
		if !strings.Contains(home, ssgTakeoverMarker) {
			t.Errorf("prerendered dist/index.html must stamp %q for the router to adopt\n%s", ssgTakeoverMarker, home)
		}
	})

	// True static pages boot through mountStatic, not the router, so they never
	// carry data-puzzle-ssg (they stamp data-puzzle-static instead) — but they DO
	// adopt prerendered DOM, so their per-page bundles must keep ssg/preload.js.
	t.Run("static per-page bundles keep the takeover path", func(t *testing.T) {
		requireStaticRuntime(t)
		root := writeSSGFixture(t, baseSSGFixture())
		if err := Build(root, Options{Development: false, Output: "static"}); err != nil {
			t.Fatalf("static Build failed: %v", err)
		}
		pages := filepath.Join(root, "dist", staticPagesDir)
		bundles, linked := 0, false
		if err := filepath.WalkDir(pages, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || filepath.Ext(path) != ".js" {
				return nil
			}
			bundles++
			if preloadModuleLinked(readFile(t, path)) {
				linked = true
			}
			return nil
		}); err != nil {
			t.Fatalf("walking %s: %v", pages, err)
		}
		if bundles == 0 {
			t.Fatalf("no per-page bundles under %s", pages)
		}
		if !linked {
			t.Errorf("static per-page bundles (%d of them) must retain ssg/preload.js — mountStatic adopts the prerendered page", bundles)
		}
	})

	// `puzzle dev` resolves no output mode, so the watch builder defines the probe
	// TRUE unconditionally: a dev bundle must never be the build that silently
	// drops a code path the user is trying to exercise.
	t.Run("dev watch build retains the takeover path", func(t *testing.T) {
		root := writeSSGFixture(t, baseSSGFixture())
		b, err := NewWatchBuilder(root, WatchOptions{})
		if err != nil {
			t.Fatalf("NewWatchBuilder: %v", err)
		}
		defer b.Dispose()
		if _, err := b.Rebuild(nil); err != nil {
			t.Fatalf("Rebuild: %v", err)
		}
		js := readDistBundle(t, root)
		if !strings.Contains(js, ssgTakeoverMarker) {
			t.Errorf("dev/watch bundle must retain the router's takeover branches (%q)", ssgTakeoverMarker)
		}
		if !preloadModuleLinked(js) {
			t.Error("dev/watch bundle must retain ssg/preload.js")
		}
	})
}

// definesFixture parameterizes the throwaway one-route app the runtime-probe DCE
// tests build. The three feature fields add exact template usage; routeMeta is
// appended to the route object literal; extraFiles adds sibling modules.
type definesFixture struct {
	flipAttr   string
	portal     bool
	raw        bool
	routeMeta  string
	extraFiles map[string]string
}

// writeDefinesFixture materializes a minimal app that imports the runtime (so the
// guarded runtime code is genuinely reachable) INSIDE the repo, where the
// '@magic-spells/puzzle' alias's walk-up can find client-runtime. The shell has
// an #app target and the /app.js tag, so the same fixture also builds under the
// prerender modes.
func writeDefinesFixture(t *testing.T, fx definesFixture) string {
	t.Helper()
	root, err := os.MkdirTemp(repoRoot(t), ".usage-dce-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })

	imports := ""
	for rel := range fx.extraFiles {
		if strings.HasPrefix(rel, "app/") && strings.HasSuffix(rel, ".js") {
			imports += "import './" + strings.TrimPrefix(rel, "app/") + "';\n"
		}
	}
	appJS := `import { PuzzleApp } from '@magic-spells/puzzle';
import Home from './views/Home.pzl';
` + imports + `const app = new PuzzleApp({
  target: '#app',
  routes: [{ path: '/', view: Home` + fx.routeMeta + ` }],
});
app.mount();
export default app;
`
	featureMarkup := ""
	if fx.portal {
		featureMarkup += "  <Portal><div>remote</div></Portal>\n"
	}
	if fx.raw {
		featureMarkup += "  {#raw}<span @x=\"y\">literal</span>{/raw}\n"
	}
	view := `<puzzle-view>
  <ul>
    {#for item in items}
      <li key={ item.id }` + fx.flipAttr + `>{ item.label }</li>
    {/for}
  </ul>
` + featureMarkup + `
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  data() { return { items: [{ id: 1, label: 'one' }] }; }
}
</script>
`
	index := `<!doctype html><html><head><title>Fixture</title></head>
<body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`

	files := map[string]string{
		"app/app.js":            appJS,
		"app/views/Home.pzl":    view,
		"app/public/index.html": index,
	}
	for rel, body := range fx.extraFiles {
		files[rel] = body
	}
	for rel, body := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// flipEasing is flip.js's DEFAULT_EASING — a string literal unique to that
// module, so it survives minification and its ABSENCE is real evidence the module
// tree-shook away (an identifier like `beginFlip` mangles to a single letter in a
// production build, so asserting its absence would pass vacuously).
const flipEasing = "cubic-bezier(0.2, 0, 0, 1)"

const portalMarker = "data-puzzle-portal"

const rawAtEscape = "@@"

// headTagMarker is the `data-puzzle-head` attribute the SSG stamps on every
// managed tag — the same kind of minification-proof literal as flipEasing. It
// must appear in PRERENDERED HTML and never in a browser bundle.
const headTagMarker = "data-puzzle-head"

// TestBuildUsageDefinesDCE proves the project usage scan drives all D89-style
// runtime probes end to end. Assertions use literals that survive production
// minification; identifiers would mangle and make absence checks vacuous.
func TestBuildUsageDefinesDCE(t *testing.T) {
	without := writeDefinesFixture(t, definesFixture{})
	if err := Build(without, Options{Development: false}); err != nil {
		t.Fatalf("Build without feature usage failed: %v", err)
	}
	withoutJS, err := os.ReadFile(filepath.Join(without, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{flipEasing, portalMarker, rawAtEscape} {
		if strings.Contains(string(withoutJS), marker) {
			t.Errorf("bundle without feature usage retained %q", marker)
		}
	}

	with := writeDefinesFixture(t, definesFixture{flipAttr: " flip"})
	if err := Build(with, Options{Development: false}); err != nil {
		t.Fatalf("Build with feature usage failed: %v", err)
	}
	withJS, err := os.ReadFile(filepath.Join(with, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(withJS), flipEasing) {
		t.Errorf("bundle with a flip attribute should retain %q", flipEasing)
	}

	withPortal := writeDefinesFixture(t, definesFixture{portal: true})
	if err := Build(withPortal, Options{Development: false}); err != nil {
		t.Fatalf("Build with Portal usage failed: %v", err)
	}
	portalJS := readFile(t, filepath.Join(withPortal, "dist", "app.js"))
	if !strings.Contains(portalJS, portalMarker) {
		t.Errorf("bundle with <Portal> should retain %q", portalMarker)
	}

	withRaw := writeDefinesFixture(t, definesFixture{raw: true})
	if err := Build(withRaw, Options{Development: false}); err != nil {
		t.Fatalf("Build with raw usage failed: %v", err)
	}
	rawJS := readFile(t, filepath.Join(withRaw, "dist", "app.js"))
	if !strings.Contains(rawJS, rawAtEscape) {
		t.Errorf("bundle with {#raw} should retain the %q literal-attribute shim", rawAtEscape)
	}
}

// headTagBundleMarkers are literals unique to headTags.js that survive
// minification: the marker attribute the table stamps, and the one fixed content
// value in MANAGED_TAGS. Either one appearing in a BROWSER bundle means the
// table (and with it any runtime head-tag machinery) was linked in.
var headTagBundleMarkers = []string{headTagMarker, "summary_large_image"}

// headMetaSSGFixture is baseSSGFixture with the home route declaring ALL FOUR
// reserved head fields, so a prerender's injected og:/twitter:/description/
// canonical tags are observable in the emitted HTML. /about keeps its title-only
// meta, which is what makes the per-page assertions meaningful.
func headMetaSSGFixture() ssgFixtureFiles {
	files := baseSSGFixture()
	files["app/routes.js"] = strings.Replace(
		files["app/routes.js"],
		"meta: { title: 'Home Page' }",
		"meta: { title: 'Home Page', description: 'The home page', "+
			"canonical: 'https://example.com/', socialImage: 'https://example.com/og.png' }",
		1,
	)
	return files
}

// assertNoHeadTagMachinery fails if a browser bundle contains any headTags.js
// literal. Absence is asserted on PRODUCTION builds only: minification mangles
// identifiers, so only these string literals make an absence check real evidence.
func assertNoHeadTagMachinery(t *testing.T, label, js string) {
	t.Helper()
	for _, marker := range headTagBundleMarkers {
		if strings.Contains(js, marker) {
			t.Errorf("%s retained %q — headTags.js must never reach a browser bundle", label, marker)
		}
	}
	if strings.Contains(js, "__PUZZLE_HAS_HEAD_TAGS__") {
		t.Errorf("%s still references the deleted __PUZZLE_HAS_HEAD_TAGS__ define", label)
	}
}

// TestBuildNeverBundlesHeadTagMachinery pins D111 (amending D89): the managed
// og:/twitter:/description/canonical tags are a BUILD-TIME product only. No
// browser bundle, in ANY output mode, contains headTags.js — while the
// prerendered HTML carries each page's own tags, which is the only place they
// were ever load-bearing (crawlers fetch every URL fresh from the server and
// never client-navigate, so they read the served markup, never a DOM the router
// rewrote).
func TestBuildNeverBundlesHeadTagMachinery(t *testing.T) {
	// SPA: a route resolving every reserved field, plus the false positive the
	// deleted byte-scan produced — a MODEL field named `description`. Neither may
	// pull the table into app.js.
	t.Run("spa app.js", func(t *testing.T) {
		root := writeDefinesFixture(t, definesFixture{
			routeMeta: ", meta: { title: 'Home', description: 'Fixture page', " +
				"canonical: 'https://example.com/', socialImage: '/og.png' }",
			extraFiles: map[string]string{
				"app/models/post.js": `export const Post = {
  name: 'post',
  fields: { title: 'string', description: 'string', canonical: 'string' },
};
`,
			},
		})
		if err := Build(root, Options{Development: false}); err != nil {
			t.Fatalf("SPA Build failed: %v", err)
		}
		assertNoHeadTagMachinery(t, "SPA bundle", readFile(t, filepath.Join(root, "dist", "app.js")))
	})

	// Hybrid: the mode that both bakes tags AND ships a client router. The baked
	// tags must be correct PER PAGE; the router still must not carry the table.
	t.Run("hybrid bakes tags into HTML but not into app.js", func(t *testing.T) {
		requireSSGRuntime(t)
		root := writeSSGFixture(t, headMetaSSGFixture())
		if err := Build(root, Options{Development: false, Output: "hybrid"}); err != nil {
			t.Fatalf("hybrid Build failed: %v", err)
		}
		dist := filepath.Join(root, "dist")
		assertNoHeadTagMachinery(t, "hybrid bundle", readFile(t, filepath.Join(dist, "app.js")))

		home := readFile(t, filepath.Join(dist, "index.html"))
		for _, want := range []string{
			`<meta property="og:title" content="Home Page" data-puzzle-head="og:title">`,
			`<meta name="description" content="The home page" data-puzzle-head="description">`,
			`<link rel="canonical" href="https://example.com/" data-puzzle-head="canonical">`,
			`<meta property="og:image" content="https://example.com/og.png" data-puzzle-head="og:image">`,
		} {
			if !strings.Contains(home, want) {
				t.Errorf("prerendered dist/index.html missing %s\n%s", want, home)
			}
		}

		// /about resolves title only — its page must carry ITS title and none of
		// home's fields (per-page tags, not a shared shell).
		about := readFile(t, filepath.Join(dist, "about", "index.html"))
		if !strings.Contains(about, `<meta property="og:title" content="About Page" data-puzzle-head="og:title">`) {
			t.Errorf("prerendered dist/about/index.html missing its own og:title\n%s", about)
		}
		if strings.Contains(about, `data-puzzle-head="canonical"`) {
			t.Errorf("dist/about/index.html leaked home's canonical — tags must resolve per page\n%s", about)
		}
	})

	// Static: no app.js at all, and the per-page kernel bundles are equally clean.
	t.Run("static bakes tags into HTML but not into the page bundles", func(t *testing.T) {
		requireStaticRuntime(t)
		root := writeSSGFixture(t, headMetaSSGFixture())
		if err := Build(root, Options{Development: false, Output: "static"}); err != nil {
			t.Fatalf("static Build failed: %v", err)
		}
		dist := filepath.Join(root, "dist")
		if _, err := os.Stat(filepath.Join(dist, "app.js")); !os.IsNotExist(err) {
			t.Errorf("dist/app.js must be absent in static mode (err=%v)", err)
		}
		// The SPA pass's chunk directory is equally absent: static mode discards
		// that pass's output, so a chunk surviving it would be an orphan.
		if _, err := os.Stat(filepath.Join(dist, chunksDirName)); !os.IsNotExist(err) {
			t.Errorf("dist/%s must be absent in static mode (err=%v)", chunksDirName, err)
		}

		pages := filepath.Join(dist, staticPagesDir)
		bundles := 0
		if err := filepath.WalkDir(pages, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || filepath.Ext(path) != ".js" {
				return nil
			}
			bundles++
			assertNoHeadTagMachinery(t, "static page bundle "+d.Name(), readFile(t, path))
			return nil
		}); err != nil {
			t.Fatalf("walking dist/%s: %v", staticPagesDir, err)
		}
		if bundles == 0 {
			t.Fatalf("no per-page bundles found under dist/%s — nothing was asserted", staticPagesDir)
		}

		home := readFile(t, filepath.Join(dist, "index.html"))
		for _, want := range []string{
			`<meta property="og:title" content="Home Page" data-puzzle-head="og:title">`,
			`<meta name="description" content="The home page" data-puzzle-head="description">`,
			`<link rel="canonical" href="https://example.com/" data-puzzle-head="canonical">`,
		} {
			if !strings.Contains(home, want) {
				t.Errorf("static dist/index.html missing %s\n%s", want, home)
			}
		}
	})
}

// writeConsoleFixture writes a minimal throwaway app whose entry contains a
// distinctive top-level console.log, so a production build's console-strip
// behavior can be asserted from dist/app.js. No runtime import (so the
// '@magic-spells/puzzle' alias need not resolve) and no styles.use (so the
// Tailwind runner is never touched). Returns the app root.
func writeConsoleFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"),
		[]byte("console.log(\"KEEP_ME_MARKER\");\nexport default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"),
		[]byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func assertSourceMapArtifacts(t *testing.T, outdir string, want bool) {
	t.Helper()
	var maps, comments []string
	err := filepath.WalkDir(outdir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(outdir, path)
		if err != nil {
			return err
		}
		if strings.HasSuffix(entry.Name(), ".map") {
			maps = append(maps, rel)
		}
		if filepath.Ext(entry.Name()) == ".js" {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if strings.Contains(string(data), "//# sourceMappingURL=") {
				comments = append(comments, rel)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	if want {
		if len(maps) == 0 {
			t.Error("expected at least one linked source-map file")
		}
		if len(comments) == 0 {
			t.Error("expected at least one sourceMappingURL comment")
		}
		return
	}
	if len(maps) > 0 {
		t.Errorf("expected no source-map files, got %v", maps)
	}
	if len(comments) > 0 {
		t.Errorf("expected no sourceMappingURL comments, got %v", comments)
	}
}

func TestBuildDefaultOmitsSourceMap(t *testing.T) {
	root := writeConsoleFixture(t)
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	assertSourceMapArtifacts(t, filepath.Join(root, "dist"), false)
}

func TestBuildSourceMapTrueEmitsLinkedMap(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
	root := writeConsoleFixture(t)
	if err := os.WriteFile(filepath.Join(root, "puzzle.config.js"),
		[]byte("export default { build: { sourceMap: true } };\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	assertSourceMapArtifacts(t, filepath.Join(root, "dist"), true)
}

func TestBuildStaticSourceMapSetting(t *testing.T) {
	requireStaticRuntime(t)
	for _, tt := range []struct {
		name      string
		sourceMap bool
	}{
		{name: "default omits maps"},
		{name: "enabled emits linked maps", sourceMap: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			root := writeSSGFixture(t, baseSSGFixture())
			if tt.sourceMap {
				if err := os.WriteFile(filepath.Join(root, "puzzle.config.js"),
					[]byte("export default { build: { sourceMap: true } };\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if err := Build(root, Options{Development: false, Output: "static"}); err != nil {
				t.Fatalf("static Build failed: %v", err)
			}
			assertSourceMapArtifacts(t, filepath.Join(root, "dist", staticPagesDir), tt.sourceMap)
		})
	}
}

// TestBuildDefaultStripsConsole confirms the unchanged default: a production
// build with no puzzle.config.js drops console.* (api.DropConsole), so the
// distinctive marker vanishes from the bundle.
func TestBuildDefaultStripsConsole(t *testing.T) {
	root := writeConsoleFixture(t)
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	appJS, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(appJS), "KEEP_ME_MARKER") {
		t.Errorf("default production build must strip console.* — found the marker present")
	}
}

// TestBuildDropConsoleFalseKeepsConsole proves build.dropConsole: false opts a
// production build out of the console strip: the marker survives. Needs node to
// evaluate puzzle.config.js.
func TestBuildDropConsoleFalseKeepsConsole(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
	root := writeConsoleFixture(t)
	if err := os.WriteFile(filepath.Join(root, "puzzle.config.js"),
		[]byte("export default { build: { dropConsole: false } };\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	appJS, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(appJS), "KEEP_ME_MARKER") {
		t.Errorf("build.dropConsole: false must keep console.* — the marker was stripped")
	}
}

// errRunner is a styles.Runner that always fails, simulating a declared-but-
// unavailable Tailwind toolchain.
type errRunner struct{ called bool }

func (e *errRunner) Run(styles.RunOptions) (string, error) {
	e.called = true
	return "", errTailwindUnavailable
}

var errTailwindUnavailable = &tailwindError{}

type tailwindError struct{}

func (*tailwindError) Error() string { return "Tailwind CLI could not be run (test)" }

// TestBuildTailwindRunnerErrorFailsBuild proves a declared pipeline is never
// silently skipped: when the runner fails, the whole build fails.
func TestBuildTailwindRunnerErrorFailsBuild(t *testing.T) {
	root := exampleRoot(t)
	fake := &errRunner{}
	err := Build(root, Options{Development: true, Runner: fake})
	if err == nil {
		t.Fatal("expected Build to fail when the Tailwind runner errors")
	}
	if !fake.called {
		t.Error("expected the runner to have been invoked")
	}
	if !strings.Contains(err.Error(), "could not be run") {
		t.Errorf("expected the runner's error to propagate, got: %v", err)
	}
}

// TestBuildBrowserErrorWinsConcurrentTailwindError proves eagerly running the
// two cold phases does not make completion order decide the diagnostic. The
// browser error remains authoritative, the Tailwind lane is still joined, and
// the browser metafile result is still assigned before Build returns.
func TestBuildBrowserErrorWinsConcurrentTailwindError(t *testing.T) {
	root := writeConsoleFixture(t)
	if err := os.WriteFile(filepath.Join(root, "app", "app.js"),
		[]byte("export default ;\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{Styles: config.Styles{Use: []string{"tailwindcss"}}}
	fake := &errRunner{}
	metafile := "not-assigned"
	err := Build(root, Options{
		Development: true,
		Runner:      fake,
		Config:      &cfg,
		Metafile:    &metafile,
	})
	if err == nil {
		t.Fatal("expected the broken browser entry and Tailwind runner to fail")
	}
	if !strings.Contains(err.Error(), "puzzle build failed") {
		t.Fatalf("browser error must win over Tailwind error, got: %v", err)
	}
	if strings.Contains(err.Error(), errTailwindUnavailable.Error()) {
		t.Fatalf("browser error unexpectedly included the lower-priority Tailwind failure: %v", err)
	}
	if !fake.called {
		t.Error("Tailwind lane was not run and joined")
	}
	if metafile == "not-assigned" {
		t.Error("browser metafile result was not assigned on the error path")
	}
	if _, statErr := os.Stat(filepath.Join(root, "dist")); !os.IsNotExist(statErr) {
		t.Errorf("failed concurrent phases must not install dist/: %v", statErr)
	}
}

// TestBuildProductionRunsTailwindMinified checks the production flag reaches the
// runner (which maps it to --minify).
func TestBuildProductionRunsTailwindMinified(t *testing.T) {
	root := exampleRoot(t)
	fake := &fakeRunner{css: "/* tw */"}
	if err := Build(root, Options{Development: false, Runner: fake}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	if !fake.production {
		t.Error("expected production build to request minified Tailwind (opts.Production=true)")
	}
}

// TestBuildNoConfigSkipsRunner confirms an app with no puzzle.config.js never
// touches the runner (or node).
func TestBuildNoConfigSkipsRunner(t *testing.T) {
	// A minimal temp app inside the repo so the runtime alias still resolves:
	// copy the example's app/ shape is overkill — instead build the example
	// after asserting the runner is skipped requires no config. We use a fake
	// runner and assert it is NOT called only when there is no config, so build
	// a throwaway app with just an entry and public dir.
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeRunner{css: "SHOULD-NOT-APPEAR"}
	if err := Build(root, Options{Development: true, Runner: fake}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	if fake.called {
		t.Error("runner must not be invoked when there is no puzzle.config.js")
	}
	css, err := os.ReadFile(filepath.Join(root, "dist", "styles.css"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(css), "SHOULD-NOT-APPEAR") {
		t.Error("styles.css must not contain runner output when no config declares Tailwind")
	}
}

// TestBuildPrunesStaleDist proves a one-shot build starts from a clean dist: a
// file left by a previous build (e.g. a since-removed public asset) is gone
// after the next build, while the current outputs are present.
func TestBuildPrunesStaleDist(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// First build produces dist/.
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first Build failed: %v", err)
	}
	dist := filepath.Join(root, "dist")

	// Simulate an artifact left by a previous build (a removed public asset).
	stale := filepath.Join(dist, "stale-asset.txt")
	if err := os.WriteFile(stale, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}

	// The second build must wipe dist before writing.
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("second Build failed: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("stale file survived rebuild (err=%v)", err)
	}
	for _, f := range []string{"app.js", "styles.css", "index.html"} {
		if _, err := os.Stat(filepath.Join(dist, f)); err != nil {
			t.Errorf("expected dist/%s after rebuild: %v", f, err)
		}
	}
}

func TestSwapOutput(t *testing.T) {
	// The previous dist is held in <root>/.puzzle/tmp during the swap; nothing
	// may survive there afterwards.
	assertNoOldResidue := func(t *testing.T, root string) {
		t.Helper()
		entries, err := os.ReadDir(workTmp(root))
		if err != nil {
			if os.IsNotExist(err) {
				return
			}
			t.Fatal(err)
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), oldDistPrefix) {
				t.Errorf("leftover previous-dist directory: %s", entry.Name())
			}
		}
	}

	// newStaging creates a staging tree where a build would put it.
	newStaging := func(t *testing.T, root string) (string, string) {
		t.Helper()
		tmp, err := ensureWorkTmp(root)
		if err != nil {
			t.Fatal(err)
		}
		staging := filepath.Join(tmp, stagingPrefix+"test")
		if err := os.MkdirAll(staging, 0o755); err != nil {
			t.Fatal(err)
		}
		return staging, tmp
	}

	t.Run("replaces existing dist and removes old sibling", func(t *testing.T) {
		root := t.TempDir()
		dist := filepath.Join(root, "dist")
		staging, tmp := newStaging(t, root)
		if err := os.MkdirAll(dist, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dist, "old.txt"), []byte("old"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(staging, "new.txt"), []byte("new"), 0o644); err != nil {
			t.Fatal(err)
		}

		if err := swapOutput(staging, dist, tmp); err != nil {
			t.Fatalf("swapOutput: %v", err)
		}
		if got, err := os.ReadFile(filepath.Join(dist, "new.txt")); err != nil || string(got) != "new" {
			t.Errorf("dist/new.txt = %q, err=%v", got, err)
		}
		if _, err := os.Stat(filepath.Join(dist, "old.txt")); !os.IsNotExist(err) {
			t.Errorf("old dist contents survived the swap (err=%v)", err)
		}
		assertNoOldResidue(t, root)
	})

	t.Run("first build installs without an old sibling", func(t *testing.T) {
		root := t.TempDir()
		dist := filepath.Join(root, "dist")
		staging, tmp := newStaging(t, root)
		if err := os.WriteFile(filepath.Join(staging, "app.js"), []byte("first"), 0o644); err != nil {
			t.Fatal(err)
		}

		if err := swapOutput(staging, dist, tmp); err != nil {
			t.Fatalf("swapOutput: %v", err)
		}
		if got, err := os.ReadFile(filepath.Join(dist, "app.js")); err != nil || string(got) != "first" {
			t.Errorf("dist/app.js = %q, err=%v", got, err)
		}
		assertNoOldResidue(t, root)
	})

	t.Run("failed staging rename restores previous dist", func(t *testing.T) {
		root := t.TempDir()
		dist := filepath.Join(root, "dist")
		if err := os.MkdirAll(dist, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dist, "app.js"), []byte("last-good"), 0o644); err != nil {
			t.Fatal(err)
		}

		tmp, tmpErr := ensureWorkTmp(root)
		if tmpErr != nil {
			t.Fatal(tmpErr)
		}
		err := swapOutput(filepath.Join(root, "missing-staging"), dist, tmp)
		if err == nil {
			t.Fatal("expected the missing staging rename to fail")
		}
		if got, readErr := os.ReadFile(filepath.Join(dist, "app.js")); readErr != nil || string(got) != "last-good" {
			t.Errorf("previous dist was not restored: %q, err=%v", got, readErr)
		}
		assertNoOldResidue(t, root)
	})

	// The swap itself is what the build depends on; deleting the previous tree is
	// housekeeping AFTER it succeeded. A failure there used to be returned, so a
	// build with a correct, complete dist/ was reported as failed.
	t.Run("old-tree cleanup failure warns and the build still succeeds", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("directory permissions do not block removal on Windows")
		}
		if os.Geteuid() == 0 {
			t.Skip("running as root: directory permissions don't prevent removal")
		}
		root := t.TempDir()
		dist := filepath.Join(root, "dist")
		staging, tmp := newStaging(t, root)
		locked := filepath.Join(dist, "locked")
		if err := os.MkdirAll(locked, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(locked, "pinned.txt"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(staging, "app.js"), []byte("new"), 0o644); err != nil {
			t.Fatal(err)
		}
		// A read-only directory inside the PREVIOUS dist: renaming the tree aside
		// still works (its parent grants that), but the RemoveAll afterwards cannot
		// unlink the file it holds.
		if err := os.Chmod(locked, 0o555); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
				if err == nil && d.IsDir() {
					_ = os.Chmod(path, 0o755)
				}
				return nil
			})
		})

		var swapErr error
		stderr := captureStderr(t, func() { swapErr = swapOutput(staging, dist, tmp) })
		if swapErr != nil {
			t.Fatalf("swapOutput reported a failure for a build that succeeded: %v", swapErr)
		}
		if got, err := os.ReadFile(filepath.Join(dist, "app.js")); err != nil || string(got) != "new" {
			t.Errorf("dist/app.js = %q, err=%v — the new build must be in place", got, err)
		}
		if !strings.Contains(stderr, "previous dist") {
			t.Errorf("expected a warning naming the leftover dist, got: %q", stderr)
		}
		// The undeletable tree is left behind on purpose — it is named in the warning.
		entries, err := os.ReadDir(tmp)
		if err != nil {
			t.Fatal(err)
		}
		var leftovers int
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), oldDistPrefix) {
				leftovers++
			}
		}
		if leftovers != 1 {
			t.Errorf("expected the undeletable previous dist to remain, found %d", leftovers)
		}
	})
}

// captureStderr runs fn with os.Stderr redirected and returns what it wrote.
func captureStderr(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	orig := os.Stderr
	os.Stderr = w
	done := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(r)
		done <- string(b)
	}()
	fn()
	os.Stderr = orig
	_ = w.Close()
	out := <-done
	_ = r.Close()
	return out
}

// TestBuildFailedCompileLeavesDistIntact proves the staging-then-swap fix: a
// build that fails because a .pzl no longer compiles must leave the PREVIOUS
// good dist/ untouched (previously dist/ was wiped up front, so any compile error
// destroyed the last build and left an empty dist/). No runtime import is needed:
// the failing build fails at the broken .pzl's onLoad, before its generated
// `@magic-spells/puzzle` import is ever resolved.
func TestBuildFailedCompileLeavesDistIntact(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// First build: a runtime-free entry that compiles cleanly and carries a
	// distinctive marker into dist/app.js.
	if err := os.WriteFile(filepath.Join(appDir, "app.js"),
		[]byte("export default \"GOOD_BUILD_MARKER\";\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first Build failed: %v", err)
	}
	dist := filepath.Join(root, "dist")
	before, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("first build produced no dist/app.js: %v", err)
	}
	if !strings.Contains(string(before), "GOOD_BUILD_MARKER") {
		t.Fatalf("first build's dist/app.js missing the marker:\n%s", before)
	}

	// Introduce a .pzl that does not compile (mismatched closing tag) and import
	// it from the entry, then rebuild: the build must FAIL...
	if err := os.WriteFile(filepath.Join(appDir, "Broken.pzl"),
		[]byte("<puzzle-view><div></span></puzzle-view>\n<script></script>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"),
		[]byte("import Broken from './Broken.pzl';\nexport default Broken;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: true}); err == nil {
		t.Fatal("expected the rebuild to fail on the broken .pzl")
	}

	// ...and the previous good dist/app.js must be exactly as it was.
	after, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("dist/app.js was destroyed by the failed build: %v", err)
	}
	if string(after) != string(before) {
		t.Errorf("dist/app.js changed despite the build failing:\nbefore=%q\nafter=%q", before, after)
	}

	// The staging dir must be cleaned up on failure (nothing left in .puzzle/tmp).
	entries, err := os.ReadDir(workTmp(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), stagingPrefix) {
			t.Errorf("leftover staging dir after failed build: %s", e.Name())
		}
	}
}

// lazyMarker is a string literal unique to the lazily imported module, so it
// survives production minification and its ABSENCE from app.js is real evidence
// the module moved into a chunk.
const lazyMarker = "LAZY_MARKER_XYZ"

// writeSplitFixture materializes a minimal app whose entry reaches a sibling
// module ONLY through a dynamic import(), so the module is inlined into app.js
// when splitting is off and lands in its own chunk when it is on. The import is
// parked on globalThis so neither tree-shaking nor minification can drop it. No
// runtime import (the '@magic-spells/puzzle' alias need not resolve) and no
// styles.use, mirroring writeConsoleFixture. cfg, when non-empty, is written as
// puzzle.config.js.
func writeSplitFixture(t *testing.T, cfg string) string {
	t.Helper()
	root := t.TempDir()
	files := map[string]string{
		"app/app.js": `globalThis.__loadLazy = async () => {
  const mod = await import('./lib/lazy.js');
  return mod.marker;
};
export default 1;
`,
		"app/lib/lazy.js":       "export const marker = \"" + lazyMarker + "\";\n",
		"app/public/index.html": "<html><body></body></html>",
	}
	if cfg != "" {
		files["puzzle.config.js"] = cfg
	}
	for rel, body := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// globChunks collects every .js file under dir. A missing dir yields nothing —
// the callers that require chunks assert on the count themselves.
func globChunks(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) {
				return nil
			}
			return walkErr
		}
		if !d.IsDir() && filepath.Ext(path) == ".js" {
			out = append(out, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// TestSplittingEmitsLazyChunk proves build.splitting: true moves a dynamically
// imported module out of app.js and into a hashed chunk under dist/chunks/.
func TestSplittingEmitsLazyChunk(t *testing.T) {
	requireNodeBin(t)
	root := writeSplitFixture(t, "export default { build: { splitting: true } };\n")
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	appJS := readFile(t, filepath.Join(root, "dist", "app.js"))
	if strings.Contains(appJS, lazyMarker) {
		t.Fatal("lazy module was inlined into app.js despite build.splitting")
	}
	chunks := globChunks(t, filepath.Join(root, "dist", chunksDirName))
	if len(chunks) == 0 {
		t.Fatalf("no chunk emitted under dist/%s", chunksDirName)
	}
	found := false
	for _, c := range chunks {
		if strings.Contains(readFile(t, c), lazyMarker) {
			found = true
		}
	}
	if !found {
		t.Fatalf("no chunk under dist/%s contains the lazy module", chunksDirName)
	}
}

// TestSplittingOffByDefault pins the default: with the key absent the build is
// the single-file output it has always been — dynamic import inlined, no chunks
// directory at all.
func TestSplittingOffByDefault(t *testing.T) {
	for _, tt := range []struct {
		name string
		cfg  string
	}{
		{name: "no config file"},
		{name: "empty config", cfg: "export default {};\n"},
		{name: "explicit false", cfg: "export default { build: { splitting: false } };\n"},
		{name: "null means unset", cfg: "export default { build: { splitting: null } };\n"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if tt.cfg != "" {
				requireNodeBin(t)
			}
			root := writeSplitFixture(t, tt.cfg)
			if err := Build(root, Options{Development: false}); err != nil {
				t.Fatalf("Build failed: %v", err)
			}
			if _, err := os.Stat(filepath.Join(root, "dist", chunksDirName)); !os.IsNotExist(err) {
				t.Fatalf("dist/%s must not exist when splitting is off (err=%v)", chunksDirName, err)
			}
			if !strings.Contains(readFile(t, filepath.Join(root, "dist", "app.js")), lazyMarker) {
				t.Fatal("lazy module must be inlined into app.js when splitting is off")
			}
		})
	}
}

// TestLazyRouteBuildSplittingModes proves the public lazy() route spelling is a
// real esbuild split point when opted in, and remains functional as an inlined
// dynamic import when splitting is off.
func TestLazyRouteBuildSplittingModes(t *testing.T) {
	requireSSGRuntime(t)
	for _, tt := range []struct {
		name      string
		splitting bool
		config    string
	}{
		{
			name:      "splitting on emits the route view as a chunk",
			splitting: true,
			config:    "export default { build: { splitting: true } };\n",
		},
		{
			name:   "splitting off inlines the route view",
			config: "export default { build: { splitting: false } };\n",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			root := writeSSGFixture(t, lazyRouteFixture(tt.config))
			if err := Build(root, Options{Development: false}); err != nil {
				t.Fatalf("lazy-route SPA Build failed: %v", err)
			}

			appJS := readFile(t, filepath.Join(root, "dist", "app.js"))
			chunks := globChunks(t, filepath.Join(root, "dist", chunksDirName))
			if tt.splitting {
				if strings.Contains(appJS, lazyRouteViewMarker) {
					t.Fatal("lazy route view was inlined into app.js despite build.splitting")
				}
				found := false
				for _, chunk := range chunks {
					if strings.Contains(readFile(t, chunk), lazyRouteViewMarker) {
						found = true
					}
				}
				if !found {
					t.Fatalf("no dist/%s chunk contains the lazy route view", chunksDirName)
				}
				return
			}

			if len(chunks) != 0 {
				t.Fatalf("splitting-off lazy route emitted %d chunk(s), want none", len(chunks))
			}
			if !strings.Contains(appJS, lazyRouteViewMarker) {
				t.Fatal("splitting-off app.js does not contain the inlined lazy route view")
			}
		})
	}
}

// TestStaticModeLeavesNoOrphanChunks proves the static-mode force-off: the SPA
// pass's output is discarded in static mode (app.js is deleted before the swap),
// so splitting it would strand chunks nothing imports.
func TestStaticModeLeavesNoOrphanChunks(t *testing.T) {
	requireStaticRuntime(t)
	files := baseSSGFixture()
	files["puzzle.config.js"] = "export default { build: { splitting: true }, output: 'static' };\n"
	files["app/lib/lazy.js"] = "export const marker = \"" + lazyMarker + "\";\n"
	files["app/app.js"] = `import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
globalThis.__loadLazy = async () => {
  const mod = await import('./lib/lazy.js');
  return mod.marker;
};
const app = new PuzzleApp({ target: '#app', routes });
app.mount();
export default app;
`
	root := writeSSGFixture(t, files)
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("static Build failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "app.js")); !os.IsNotExist(err) {
		t.Errorf("static mode must not ship app.js (err=%v)", err)
	}
	if _, err := os.Stat(filepath.Join(root, "dist", chunksDirName)); !os.IsNotExist(err) {
		t.Errorf("static mode must not ship orphan SPA chunks (err=%v)", err)
	}
}

// TestPublicChunksDirRejectedWhenSplitting proves a public/chunks tree — which
// would be copied over the emitted chunk set — fails the build up front, the
// same guard the reserved root-level output names get.
func TestPublicChunksDirRejectedWhenSplitting(t *testing.T) {
	requireNodeBin(t)
	root := writeSplitFixture(t, "export default { build: { splitting: true } };\n")
	collision := filepath.Join(root, "app", "public", chunksDirName, "x.js")
	if err := os.MkdirAll(filepath.Dir(collision), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(collision, []byte("USER ASSET"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Build(root, Options{Development: false})
	if err == nil {
		t.Fatal("expected a reserved-directory error for public/chunks when splitting is on")
	}
	if !strings.Contains(err.Error(), chunksDirName) {
		t.Fatalf("error should name the reserved %s directory, got %v", chunksDirName, err)
	}
}

// TestPublicChunksDirAllowedWithoutSplitting is the other half of the guard: the
// reservation exists only while splitting can emit into that directory, so an
// app that never opts in keeps its public/chunks assets.
func TestPublicChunksDirAllowedWithoutSplitting(t *testing.T) {
	root := writeSplitFixture(t, "")
	asset := filepath.Join(root, "app", "public", chunksDirName, "x.js")
	if err := os.MkdirAll(filepath.Dir(asset), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asset, []byte("USER ASSET"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build failed: %v", err)
	}
	if got := readFile(t, filepath.Join(root, "dist", chunksDirName, "x.js")); got != "USER ASSET" {
		t.Fatalf("public/%s/x.js should have been copied verbatim, got %q", chunksDirName, got)
	}
}

// TestBuildRejectsReservedPublicNames proves a root-level public asset whose
// name collides with a compiler output (app.js / app.js.map / styles.css) fails
// the build — the copy would otherwise silently overwrite the bundle/stylesheet.
// Nested occurrences and other assets (index.html) stay allowed.
func TestBuildRejectsReservedPublicNames(t *testing.T) {
	for _, name := range []string{"app.js", "app.js.map", "styles.css"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			publicDir := filepath.Join(root, "app", "public")
			if err := os.MkdirAll(publicDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(publicDir, "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
				t.Fatal(err)
			}
			// The offending collision.
			collision := filepath.Join(publicDir, name)
			if err := os.WriteFile(collision, []byte("USER ASSET"), 0o644); err != nil {
				t.Fatal(err)
			}

			err := Build(root, Options{Development: true})
			if err == nil {
				t.Fatalf("expected Build to fail for reserved public asset %q", name)
			}
			// Error must name both the source path and the reserved output path.
			if !strings.Contains(err.Error(), collision) {
				t.Errorf("error should name the offending source %q; got: %v", collision, err)
			}
			if !strings.Contains(err.Error(), "dist/"+name) {
				t.Errorf("error should name the reserved output dist/%s; got: %v", name, err)
			}
		})
	}
}

// TestBuildAllowsNestedReservedNames proves a reserved name NESTED under public/
// (public/vendor/app.js) is fine — only the root level of the public tree is
// reserved — and index.html copies normally.
func TestBuildAllowsNestedReservedNames(t *testing.T) {
	root := t.TempDir()
	publicDir := filepath.Join(root, "app", "public")
	vendor := filepath.Join(publicDir, "vendor")
	if err := os.MkdirAll(vendor, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicDir, "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(vendor, "app.js"), []byte("nested vendor"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("nested reserved name should be allowed, got: %v", err)
	}
	dist := filepath.Join(root, "dist")
	// index.html copied, nested vendor/app.js copied verbatim, compiler app.js present.
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Errorf("index.html was not copied: %v", err)
	}
	nested, err := os.ReadFile(filepath.Join(dist, "vendor", "app.js"))
	if err != nil {
		t.Fatalf("nested vendor/app.js not copied: %v", err)
	}
	if string(nested) != "nested vendor" {
		t.Errorf("nested vendor/app.js corrupted: %q", nested)
	}
	if _, err := os.Stat(filepath.Join(dist, "app.js")); err != nil {
		t.Errorf("compiler dist/app.js missing: %v", err)
	}
}

func TestBuildHybridRejectsPrerenderPublicAssetCollision(t *testing.T) {
	requireSSGRuntime(t)
	files := baseSSGFixture()
	files["app/public/about/index.html"] = "PUBLIC ABOUT ASSET"
	root := writeSSGFixture(t, files)

	err := Build(root, Options{Development: true, Output: "hybrid"})
	want := "[puzzle] prerendered route \"/about\" would overwrite public asset app/public/about/index.html\n" +
		"at dist/about/index.html; rename the public asset or remove the route output"
	if err == nil {
		t.Fatal("expected the hybrid build to reject the route/public asset collision")
	}
	if err.Error() != want {
		t.Fatalf("collision error:\n%s\nwant:\n%s", err, want)
	}
}

func TestBuildStaticRejectsPrerenderPublicAssetCollision(t *testing.T) {
	requireStaticRuntime(t)
	files := baseSSGFixture()
	files["app/public/about/index.html"] = "PUBLIC ABOUT ASSET"
	root := writeSSGFixture(t, files)

	err := Build(root, Options{Development: true, Output: "static"})
	want := "[puzzle] prerendered route \"/about\" would overwrite public asset app/public/about/index.html\n" +
		"at dist/about/index.html; rename the public asset or remove the route output"
	if err == nil {
		t.Fatal("expected the static build to reject the route/public asset collision")
	}
	if err.Error() != want {
		t.Fatalf("collision error:\n%s\nwant:\n%s", err, want)
	}
}

// TestBuildRejectsPrerenderScratchDirCollision proves BOTH prerender modes
// reject a public/.puzzle-prerender subtree instead of silently eating it. That
// path is each mode's scratch dir: the generated bundle is written into it and
// the whole directory is RemoveAll'd before the staging→dist swap, so the copied
// asset used to disappear while the build reported success. ValidatePublic can't
// see it (root-level FILES only, directories skipped), so the guard reads the
// post-copyPublic staging state — which is also why it can't be dodged by using
// a flat public/ instead of app/public. No node run is involved: the guard fires
// before the prerender bundle is built.
func TestBuildRejectsPrerenderScratchDirCollision(t *testing.T) {
	for _, tc := range []struct {
		mode      string
		publicDir string
		asset     string
	}{
		{mode: "hybrid", publicDir: "app/public", asset: "app/public/.puzzle-prerender/keep.txt"},
		{mode: "static", publicDir: "app/public", asset: "app/public/.puzzle-prerender/keep.txt"},
		// A flat root-level public/ resolves to the same staging path.
		{mode: "hybrid", publicDir: "public", asset: "public/.puzzle-prerender/keep.txt"},
		// The collision is a plain FILE, not a directory.
		{mode: "static", publicDir: "app/public", asset: "app/public/.puzzle-prerender"},
	} {
		t.Run(tc.mode+"/"+tc.asset, func(t *testing.T) {
			files := baseSSGFixture()
			if tc.publicDir != "app/public" {
				files[tc.publicDir+"/index.html"] = files["app/public/index.html"]
				delete(files, "app/public/index.html")
			}
			files[tc.asset] = "KEEP ME"
			root := writeSSGFixture(t, files)

			err := Build(root, Options{Development: true, Output: tc.mode})
			if err == nil {
				t.Fatalf("expected the %s build to reject the .puzzle-prerender collision", tc.mode)
			}
			want := "public asset " + tc.publicDir + "/.puzzle-prerender would be consumed by the prerender step " +
				"(.puzzle-prerender is a reserved output name); rename or remove it"
			if !strings.Contains(err.Error(), want) {
				t.Fatalf("collision error:\n%s\nwant substring:\n%s", err, want)
			}
			if !strings.Contains(err.Error(), "puzzle build --"+tc.mode) {
				t.Errorf("error should name the mode; got: %v", err)
			}
			// The failure is atomic: staging is discarded, so no dist/ was written.
			if _, err := os.Stat(filepath.Join(root, "dist")); !os.IsNotExist(err) {
				t.Errorf("failed build should not have produced dist/: %v", err)
			}
		})
	}
}

func TestBuildHybridRejectsCatchAllPublicAssetCollision(t *testing.T) {
	requireSSGRuntime(t)
	files := baseSSGFixture()
	files["app/public/404.html"] = "PUBLIC 404 ASSET"
	root := writeSSGFixture(t, files)

	err := Build(root, Options{Development: true, Output: "hybrid"})
	want := "[puzzle] prerendered route \"*\" would overwrite public asset app/public/404.html\n" +
		"at dist/404.html; rename the public asset or remove the route output"
	if err == nil {
		t.Fatal("expected the hybrid build to reject the catch-all/public asset collision")
	}
	if err.Error() != want {
		t.Fatalf("collision error:\n%s\nwant:\n%s", err, want)
	}
}

// TestBuildHybridRejectsCatchAllPublicAssetCollisionCaseInsensitive proves the
// prerender ownership check folds case the way the reserved-output guard does:
// on the case-insensitive filesystems macOS/Windows default to, public/404.HTML
// and the catch-all's generated 404.html are ONE dist file, so the build must
// fail instead of emitting host-dependent output. The fold is in the lookup, not
// the filesystem, so this holds on case-sensitive CI too — and the message keeps
// the asset's actual spelling.
func TestBuildHybridRejectsCatchAllPublicAssetCollisionCaseInsensitive(t *testing.T) {
	requireSSGRuntime(t)
	files := baseSSGFixture()
	files["app/public/404.HTML"] = "PUBLIC 404 ASSET"
	root := writeSSGFixture(t, files)

	err := Build(root, Options{Development: true, Output: "hybrid"})
	want := "[puzzle] prerendered route \"*\" would overwrite public asset app/public/404.HTML\n" +
		"at dist/404.html; rename the public asset or remove the route output"
	if err == nil {
		t.Fatal("expected the hybrid build to reject the case-folded catch-all collision")
	}
	if err.Error() != want {
		t.Fatalf("collision error:\n%s\nwant:\n%s", err, want)
	}
}

func TestBuildHybridAllowsRootRouteToRewritePublicIndexShell(t *testing.T) {
	requireSSGRuntime(t)
	files := baseSSGFixture()
	files["app/routes.js"] = `import Home from './views/Home.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: Home, layout: DefaultLayout, prerender: false },
];
`
	root := writeSSGFixture(t, files)

	if err := Build(root, Options{Development: true, Output: "hybrid"}); err != nil {
		t.Fatalf("root route should be allowed to rewrite the public index shell: %v", err)
	}
	publicShell := readFile(t, filepath.Join(root, "app", "public", "index.html"))
	distShell := readFile(t, filepath.Join(root, "dist", "index.html"))
	if distShell != publicShell {
		t.Error("prerender:false root route should rewrite the public index shell byte-for-byte")
	}
}

// TestValidatePublicReservedNamesCaseInsensitive proves the reserved-name check
// folds case: on the case-insensitive filesystems macOS/Windows default to, a
// public/App.js or STYLES.CSS would still clobber the compiler's dist/app.js /
// dist/styles.css, so it must be rejected — while the message keeps the user's
// actual filename. ValidatePublic is exercised directly so the assertion holds on
// a case-sensitive CI filesystem too (the fold is in the lookup, not the FS).
func TestValidatePublicReservedNamesCaseInsensitive(t *testing.T) {
	for _, name := range []string{"App.js", "APP.JS", "Styles.css", "STYLES.CSS", "App.js.map"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			publicDir := filepath.Join(root, "app", "public")
			if err := os.MkdirAll(publicDir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(publicDir, name), []byte("USER ASSET"), 0o644); err != nil {
				t.Fatal(err)
			}
			err := ValidatePublic(root, false)
			if err == nil {
				t.Fatalf("expected %q to be rejected as a reserved output name", name)
			}
			// The message keeps the user's actual (original-case) filename.
			if !strings.Contains(err.Error(), name) {
				t.Errorf("error should name the user's file %q; got: %v", name, err)
			}
		})
	}
}

// TestBuildReservedCollisionLeavesDistIntact proves the validation runs BEFORE
// dist/ is pruned: a collision introduced after a good build must NOT destroy the
// last successful output.
func TestBuildReservedCollisionLeavesDistIntact(t *testing.T) {
	root := t.TempDir()
	publicDir := filepath.Join(root, "app", "public")
	if err := os.MkdirAll(publicDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(publicDir, "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	// First build succeeds and populates dist/.
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first Build failed: %v", err)
	}
	dist := filepath.Join(root, "dist")
	before, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("first build produced no dist/app.js: %v", err)
	}

	// Introduce a collision, then rebuild: it must fail WITHOUT wiping dist/.
	if err := os.WriteFile(filepath.Join(publicDir, "styles.css"), []byte(".user{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := Build(root, Options{Development: true}); err == nil {
		t.Fatal("expected the second Build to fail on the styles.css collision")
	}
	after, err := os.ReadFile(filepath.Join(dist, "app.js"))
	if err != nil {
		t.Fatalf("dist/app.js was destroyed by a failed build: %v", err)
	}
	if string(after) != string(before) {
		t.Errorf("dist/app.js changed despite the build failing:\nbefore=%q\nafter=%q", before, after)
	}
}

// TestPublicDir proves the exported resolver `puzzle dev` uses to decide which
// public tree to watch: app/public wins over a root-level public/, a root-level
// public/ is the fallback, and neither present yields "".
func TestPublicDir(t *testing.T) {
	// Both present: app/public wins.
	both := t.TempDir()
	if err := os.MkdirAll(filepath.Join(both, "app", "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(both, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, want := PublicDir(both), filepath.Join(both, "app", "public"); got != want {
		t.Errorf("both present: PublicDir = %q, want %q", got, want)
	}

	// Only a root-level public/: the fallback.
	rootOnly := t.TempDir()
	if err := os.MkdirAll(filepath.Join(rootOnly, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, want := PublicDir(rootOnly), filepath.Join(rootOnly, "public"); got != want {
		t.Errorf("root-level fallback: PublicDir = %q, want %q", got, want)
	}

	// Neither present: empty.
	if got := PublicDir(t.TempDir()); got != "" {
		t.Errorf("no public dir: PublicDir = %q, want \"\"", got)
	}
}

// TestBuildMissingEntry reports a clear error when app/app.js is absent.
func TestBuildMissingEntry(t *testing.T) {
	root := t.TempDir()
	if err := Build(root, Options{}); err == nil {
		t.Fatal("expected an error for a missing entry point")
	}
}

// TestCLIBuild is one exec-based smoke test of the actual command. Skipped when
// the go toolchain is not on PATH.
func TestCLIBuild(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go not on PATH")
	}
	// This goes through the real binary, hence the real Tailwind runner. The
	// example declares Tailwind, so without a working toolchain the build fails
	// by design ("never silently skip a declared pipeline"); skip rather than
	// flag that expected environment gap here.
	if _, err := (styles.NpxRunner{}).Run(styles.RunOptions{AppRoot: t.TempDir()}); err != nil {
		t.Skipf("Tailwind CLI not runnable in this environment: %v", err)
	}
	root := exampleRoot(t)

	// Module root is three levels up from compiler/internal/build.
	wd, _ := os.Getwd()
	moduleDir := filepath.Clean(filepath.Join(wd, "..", "..", ".."))

	cmd := exec.Command("go", "run", "./compiler/cmd/puzzle", "build", root, "--mode", "development")
	cmd.Dir = moduleDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("puzzle build exited non-zero: %v\n%s", err, out)
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "app.js")); err != nil {
		t.Errorf("CLI build produced no dist/app.js: %v", err)
	}
}

// TestBuildOptionsConfigSkipsLoad proves Options.Config is used INSTEAD of
// loading puzzle.config.js — not merged with it. The fixture's config file is
// deliberately unloadable (it throws), which fails any build that reads it, so a
// green build here is proof node was never spawned. The passed config's Tailwind
// declaration is honored, so the value really is the one in effect.
func TestBuildOptionsConfigSkipsLoad(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "app.js"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, "public", "index.html"), []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "puzzle.config.js"),
		[]byte("throw new Error('this config must never be loaded');\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Sanity: without Options.Config the same build fails on that config file.
	if err := Build(root, Options{Development: true, Runner: &fakeRunner{}}); err == nil {
		t.Fatal("expected a build with no Options.Config to fail on the throwing puzzle.config.js")
	}

	var cfg config.Config
	cfg.Styles.Use = []string{"tailwindcss"}
	fake := &fakeRunner{css: "/* threaded */"}
	if err := Build(root, Options{Development: true, Runner: fake, Config: &cfg}); err != nil {
		t.Fatalf("Build with Options.Config failed: %v", err)
	}
	if !fake.called {
		t.Error("the threaded config declared Tailwind, so the runner must have been invoked")
	}
	css, err := os.ReadFile(filepath.Join(root, "dist", "styles.css"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(css), "/* threaded */") {
		t.Error("styles.css must reflect the threaded config's Tailwind layer")
	}
}

// TestCopyPublicLiveDistSkipsUnchanged proves the dev in-place copier does no
// work when nothing under public/ changed: a second pass leaves the destination
// inode untouched (so it never rewrote the file), still reports the file as
// public-owned, and picks an edit up on the pass after that.
func TestCopyPublicLiveDistSkipsUnchanged(t *testing.T) {
	root := t.TempDir()
	pub := filepath.Join(root, "app", "public")
	if err := os.MkdirAll(pub, 0o755); err != nil {
		t.Fatal(err)
	}
	asset := filepath.Join(pub, "logo.svg")
	if err := os.WriteFile(asset, []byte("<svg/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	dist := filepath.Join(root, "dist")

	copied, err := copyPublic(root, dist, copyIntoLiveDist)
	if err != nil {
		t.Fatalf("first copy: %v", err)
	}
	if !copied["logo.svg"] {
		t.Fatal("first copy did not report logo.svg")
	}
	target := filepath.Join(dist, "logo.svg")
	before, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}

	// Mark the destination so a rewrite is detectable even if the timestamps
	// happen to land identically: WriteFileAtomic renames a fresh file into
	// place, which resets the mode we set here. Windows has no unix permission
	// bits to set, so the mtime check below carries the assertion there.
	modeSentinel := runtime.GOOS != "windows"
	if modeSentinel {
		if err := os.Chmod(target, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	copied, err = copyPublic(root, dist, copyIntoLiveDist)
	if err != nil {
		t.Fatalf("second copy: %v", err)
	}
	if !copied["logo.svg"] {
		t.Error("an up-to-date file must still be reported as public-owned")
	}
	after, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if modeSentinel && after.Mode().Perm() != 0o600 {
		t.Errorf("unchanged public file was rewritten (mode reset to %v)", after.Mode().Perm())
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Error("unchanged public file was rewritten (mtime moved)")
	}

	// An actual edit must still land. Write a different length so the check
	// cannot pass on size alone.
	if err := os.WriteFile(asset, []byte("<svg id=\"new\"/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := copyPublic(root, dist, copyIntoLiveDist); err != nil {
		t.Fatalf("third copy: %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "<svg id=\"new\"/>" {
		t.Errorf("edited public file did not reach dist: %q", got)
	}
}

// TestCopyPublicStagingWritesPlainCopies confirms the staging path produces
// real, independent copies — not hardlinks. The prerender pass edits staging's
// copy of the shell in place, so a shared inode would write back into the app's
// own public/ source.
func TestCopyPublicStagingWritesPlainCopies(t *testing.T) {
	root := t.TempDir()
	pub := filepath.Join(root, "app", "public")
	if err := os.MkdirAll(pub, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(pub, "index.html")
	if err := os.WriteFile(src, []byte("<html><body></body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(root, ".staging")

	if _, err := copyPublic(root, staging, copyIntoStaging); err != nil {
		t.Fatalf("staging copy: %v", err)
	}
	// Rewrite the staged copy the way a prerender pass does.
	staged := filepath.Join(staging, "index.html")
	if err := os.WriteFile(staged, []byte("<html><body>PRERENDERED</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(original), "PRERENDERED") {
		t.Fatal("editing the staged copy wrote through to the app's public/ source — staging must not share inodes with public/")
	}
}
