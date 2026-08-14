package build

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The fixtures module is pulled in by IMPORT, not by a define (D98), so the
// evidence for both directions is the same set of string literals. All three
// survive minification — `zephyr` is a generator.js WORDS entry, and the other
// two are error/response message text — which is what makes the ABSENCE
// direction real evidence rather than a vacuous pass over mangled identifiers.
var fixturesMarkers = []string{
	"[puzzle] installFixtures(config) expects a plain object", // fixtures/index.js
	"[puzzle] mock: no record for",                            // fixtures/mock.js
	"zephyr",                                                  // fixtures/generator.js
}

// writeFixturesApp creates a throwaway app UNDER the repo root (so FindRuntime
// walks up to client-runtime/) that both seeds and mocks: app/fixtures.js
// default-exports a seed plus a setup that calls store.seed, and the model
// declares a `static adapter` with a mock block. withConfig=false omits
// app/fixtures.js so the missing-config path can be exercised on an otherwise
// identical app.
func writeFixturesApp(t *testing.T, withConfig bool) string {
	t.Helper()
	root, err := os.MkdirTemp(repoRoot(t), ".d98-fixtures-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	for _, dir := range []string{"app/views", "app/public"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	files := map[string]string{
		// A PLAIN .js model, which is where a real app declares its adapter.
		"app/models.js": `import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';
export class Item extends PuzzleModel {
  static schema = { id: Puzzle.string().primary(), label: Puzzle.string() };
  static adapter = { endpoint: '/api/items', mock: { data: [{ id: '1', label: 'one' }] } };
}
`,
		"app/app.js": `import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import { Item } from './models.js';
import Home from './views/Home.pzl';
const app = new PuzzleApp({
  target: '#app',
  models: { item: Item },
  adapter,
  routes: [{ path: '/', view: Home }],
});
app.mount();
export default app;
`,
		"app/views/Home.pzl": `<puzzle-view>
  <ul>{#for item in items}<li key={ item.id }>{ item.label }</li>{/for}</ul>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  data() { return { items: this.store.findMany('item') }; }
}
</script>
`,
		"app/public/index.html": `<!doctype html><html><head><title>Fixture</title></head>
<body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`,
	}
	if withConfig {
		files["app/fixtures.js"] = `export default {
  seed: 42,
  setup(app) {
    app.store.seed('item', 3);
  },
};
`
	}
	for rel, body := range files {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(rel)), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// A --fixtures build bundles the generated wrapper entry, which imports the
// fixtures module before the app module. The output must still land at
// dist/app.js (the wrapper's base name is what esbuild names the bundle after),
// and the scratch dir the build created for the wrapper must not survive it.
func TestBuildFixturesInstallsModule(t *testing.T) {
	root := writeFixturesApp(t, true)
	if err := Build(root, Options{Development: false, Fixtures: true}); err != nil {
		t.Fatalf("Build with Fixtures: %v", err)
	}

	js, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatalf("--fixtures must keep the bundle at dist/app.js: %v", err)
	}
	for _, marker := range fixturesMarkers {
		if !strings.Contains(string(js), marker) {
			t.Errorf("a --fixtures bundle must retain %q — without it installFixtures never reaches the browser", marker)
		}
	}

	// The wrapper is build scratch, not app source: a one-shot build takes it
	// away again, on success as well as on failure. .puzzle itself stays — every
	// build keeps its transient dirs in .puzzle/tmp (workdir.go).
	if _, err := os.Stat(filepath.Join(root, ".puzzle", "fixtures")); !os.IsNotExist(err) {
		t.Errorf("the generated wrapper survived a one-shot --fixtures build (stat err = %v)", err)
	}
}

// The inverse, and the whole point of D98: the SAME app — fixtures file on disk,
// model declaring a mock block — ships none of the module when the flag is off.
// Nothing is gated by a define; not importing the module IS the tree-shake.
func TestBuildWithoutFixturesOmitsModule(t *testing.T) {
	root := writeFixturesApp(t, true)
	if err := Build(root, Options{Development: false}); err != nil {
		t.Fatalf("Build without Fixtures: %v", err)
	}

	js, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range fixturesMarkers {
		if strings.Contains(string(js), marker) {
			t.Errorf("a bundle built WITHOUT --fixtures retained %q — app/fixtures.js must only be wired in by the flag", marker)
		}
	}
	// No wrapper is generated without the flag; .puzzle exists only as the
	// build's scratch root.
	if _, err := os.Stat(filepath.Join(root, ".puzzle", "fixtures")); !os.IsNotExist(err) {
		t.Errorf("a build without --fixtures must not generate a wrapper (stat err = %v)", err)
	}
}

func TestBuildFixturesRequiresConfigFile(t *testing.T) {
	root := writeFixturesApp(t, false)
	err := Build(root, Options{Development: false, Fixtures: true})
	if err == nil {
		t.Fatal("Build with Fixtures and no app/fixtures.js must fail")
	}
	if !strings.Contains(err.Error(), "app/fixtures.js") {
		t.Errorf("error must name the missing file, got: %v", err)
	}
	// Failing fast means failing before anything is built.
	if _, statErr := os.Stat(filepath.Join(root, "dist")); !os.IsNotExist(statErr) {
		t.Errorf("a rejected --fixtures build must not produce dist/ (stat err = %v)", statErr)
	}
}

// Prerendering runs the app in Node at build time, so fixtures would bake
// generated records into the emitted HTML. Both prerender modes are rejected,
// and the check runs on the RESOLVED mode so a puzzle.config.js `output` is
// caught exactly like the flag.
func TestBuildFixturesRejectsPrerenderModes(t *testing.T) {
	for _, mode := range []string{"static", "hybrid"} {
		t.Run(mode, func(t *testing.T) {
			root := writeFixturesApp(t, true)
			err := Build(root, Options{Development: false, Fixtures: true, Output: mode})
			if err == nil {
				t.Fatalf("Build with Fixtures and Output %q must fail", mode)
			}
			if !strings.Contains(err.Error(), "--fixtures") || !strings.Contains(err.Error(), mode) {
				t.Errorf("error must name both --fixtures and %q, got: %v", mode, err)
			}
			if _, statErr := os.Stat(filepath.Join(root, "dist")); !os.IsNotExist(statErr) {
				t.Errorf("a rejected --fixtures build must not produce dist/ (stat err = %v)", statErr)
			}
			if _, statErr := os.Stat(filepath.Join(root, ".puzzle")); !os.IsNotExist(statErr) {
				t.Errorf("a rejected --fixtures build must not leave .puzzle behind (stat err = %v)", statErr)
			}
		})
	}
}

// The config-file half of the conflict check: no CLI --static/--hybrid at all,
// the mode comes from puzzle.config.js, and --fixtures still has to lose.
func TestBuildFixturesRejectsConfigOutputMode(t *testing.T) {
	root := writeFixturesApp(t, true)
	cfg := "export default { output: 'static' };\n"
	if err := os.WriteFile(filepath.Join(root, "puzzle.config.js"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Build(root, Options{Development: false, Fixtures: true})
	if err == nil {
		t.Fatal("Build with Fixtures and output: 'static' in puzzle.config.js must fail")
	}
	if !strings.Contains(err.Error(), "--fixtures") || !strings.Contains(err.Error(), "static") {
		t.Errorf("error must name both --fixtures and the config mode, got: %v", err)
	}
}

// The generated wrapper is two modules on purpose. Static imports HOIST, so a
// single file's `installFixtures(config)` call would run AFTER the app module's
// body — too late to patch anything. Only a dependency module's BODY is
// guaranteed to run first, so the wiring gets its own module that the entry
// imports ahead of the app.
func TestGenerateFixturesEntryShape(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "app", "fixtures.js")
	if err := os.WriteFile(configPath, []byte("export default {};\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := generateFixturesEntry(root, configPath)
	if err != nil {
		t.Fatalf("generateFixturesEntry: %v", err)
	}
	if !w.CreatedWorkDir {
		t.Error("CreatedWorkDir = false, but .puzzle did not exist before the call")
	}
	if got, want := filepath.Base(w.Entry), "app.js"; got != want {
		t.Errorf("entry base name = %q, want %q — esbuild names the bundle after it", got, want)
	}
	if got, want := w.Entry, filepath.Join(root, ".puzzle", "fixtures", "app.js"); got != want {
		t.Errorf("entry = %q, want %q", got, want)
	}

	wiring, err := os.ReadFile(filepath.Join(root, ".puzzle", "fixtures", "wiring.js"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"import { installFixtures } from '@magic-spells/puzzle/fixtures';",
		"installFixtures(config);",
		filepath.ToSlash(configPath),
	} {
		if !strings.Contains(string(wiring), want) {
			t.Errorf("wiring.js missing %q:\n%s", want, wiring)
		}
	}

	wrapper, err := os.ReadFile(w.Entry)
	if err != nil {
		t.Fatal(err)
	}
	wiringIdx := strings.Index(string(wrapper), filepath.ToSlash(filepath.Join(root, ".puzzle", "fixtures", "wiring.js")))
	appIdx := strings.Index(string(wrapper), filepath.ToSlash(filepath.Join(root, "app", "app.js")))
	if wiringIdx < 0 || appIdx < 0 {
		t.Fatalf("wrapper entry must import both the wiring module and the app entry:\n%s", wrapper)
	}
	if wiringIdx > appIdx {
		t.Error("the wiring import must come FIRST — its body has to run before the app module's")
	}

	// A second call is a no-op on the dir it did not create.
	if again, err := generateFixturesEntry(root, configPath); err != nil || again.CreatedWorkDir {
		t.Errorf("regenerating: CreatedWorkDir = %v, err = %v; want false, nil", again.CreatedWorkDir, err)
	}
}

// cleanupFixturesWorkDir is deliberately conservative: it may only remove a
// .puzzle this build created, and only while it holds nothing but the generated
// fixtures/ subdir.
func TestCleanupFixturesWorkDirNeverEatsUserContent(t *testing.T) {
	newWorkDir := func(t *testing.T) string {
		t.Helper()
		root := t.TempDir()
		if err := os.MkdirAll(filepath.Join(root, ".puzzle", "fixtures"), 0o755); err != nil {
			t.Fatal(err)
		}
		return root
	}

	// A pre-existing .puzzle is somebody else's — most concretely a running
	// `puzzle dev --fixtures`, whose wrapper is generated once and has to live for
	// the process lifetime. A one-shot build must not touch either.
	root := newWorkDir(t)
	cleanupFixturesWorkDir(root, false)
	if _, err := os.Stat(filepath.Join(root, ".puzzle")); err != nil {
		t.Errorf("a pre-existing .puzzle (created = false) must survive: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".puzzle", "fixtures")); err != nil {
		t.Errorf("a build that did not create .puzzle must leave the fixtures entry dir alone: %v", err)
	}

	root = newWorkDir(t)
	if err := os.WriteFile(filepath.Join(root, ".puzzle", "cache.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	cleanupFixturesWorkDir(root, true)
	if _, err := os.Stat(filepath.Join(root, ".puzzle", "cache.json")); err != nil {
		t.Errorf("unrelated content under .puzzle must survive cleanup: %v", err)
	}

	root = newWorkDir(t)
	cleanupFixturesWorkDir(root, true)
	if _, err := os.Stat(filepath.Join(root, ".puzzle")); !os.IsNotExist(err) {
		t.Errorf(".puzzle holding only the generated wrapper must be removed (stat err = %v)", err)
	}
}

// The dev builder generates its wrapper once, at construction, and LEAVES it in
// place for the process lifetime — the esbuild context resolves the entry on
// every rebuild. It also has to reject a missing config exactly like the
// one-shot build.
func TestWatchBuilderFixtures(t *testing.T) {
	root := writeFixturesApp(t, true)
	b, err := NewWatchBuilder(root, WatchOptions{Fixtures: true})
	if err != nil {
		t.Fatalf("NewWatchBuilder with Fixtures: %v", err)
	}
	defer b.Dispose()

	if got, want := b.entry, filepath.Join(root, ".puzzle", "fixtures", "app.js"); got != want {
		t.Errorf("watch entry = %q, want %q", got, want)
	}
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("Rebuild: %v", err)
	}
	js, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatalf("dev --fixtures must write dist/app.js: %v", err)
	}
	for _, marker := range fixturesMarkers {
		if !strings.Contains(string(js), marker) {
			t.Errorf("dev --fixtures bundle must retain %q", marker)
		}
	}
	if _, err := os.Stat(filepath.Join(root, ".puzzle", "fixtures", "app.js")); err != nil {
		t.Errorf("the dev wrapper must persist for the process lifetime: %v", err)
	}

	missing := writeFixturesApp(t, false)
	if _, err := NewWatchBuilder(missing, WatchOptions{Fixtures: true}); err == nil {
		t.Error("NewWatchBuilder with Fixtures and no app/fixtures.js must fail")
	} else if !strings.Contains(err.Error(), "app/fixtures.js") {
		t.Errorf("error must name the missing file, got: %v", err)
	}
}
