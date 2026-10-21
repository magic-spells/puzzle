package plugin

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/evanw/esbuild/pkg/api"
)

const peerManifest = `{"name":"@x/kit","version":"1.0.0","peerDependencies":{"@magic-spells/puzzle":">=0.9.0 <0.10.0"}}`

// kitMessage is a package component that needs the live-HTML runtime, the
// sanitizer, and a library function — the shape of a chat-message list.
const kitMessage = `<puzzle-view><div class="msg">{ raw(body) } <small>{ currency(cost) }</small></div></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Message extends PuzzleView {}
</script>
`

const plainHome = `<puzzle-view><h1>Home</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`

// A package that declares Puzzle contributes its .pzl usage — feature bits and
// functions alike — to the same Usage the app's own templates feed, whether
// it is scoped or not, and whichever dependency field declares it.
func TestScanUsageReadsDeclaringPackages(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl":                                  plainHome,
		"node_modules/@x/kit/package.json":                    peerManifest,
		"node_modules/@x/kit/src/Message.pzl":                 kitMessage,
		"node_modules/flipkit/package.json":                   `{"name":"flipkit","dependencies":{"@magic-spells/puzzle":"^0.9.0"}}`,
		"node_modules/flipkit/List.pzl":                       `<puzzle-view><ul>{#for r in rows}<li key={ r.id } flip>{ r.n }</li>{/for}</ul></puzzle-view>`,
		"node_modules/@x/kit/node_modules/inner/package.json": `{"name":"inner","peerDependencies":{"@magic-spells/puzzle":"*"}}`,
		"node_modules/@x/kit/node_modules/inner/Portal.pzl":   `<puzzle-view><Portal><p>away</p></Portal></puzzle-view>`,
	})
	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatalf("ScanUsage: %v", err)
	}
	if !usage.HasRawHTML || !usage.HasRawSanitize || !usage.Formatters["currency"] {
		t.Errorf("scoped peer-declaring package not read: %+v", usage)
	}
	if !usage.HasFlip {
		t.Error("unscoped package declaring Puzzle in dependencies not read (flip)")
	}
	if !usage.HasPortal {
		t.Error("nested node_modules inside a declaring package not read (Portal)")
	}
	real, _ := filepath.EvalSymlinks(root)
	if !usage.PZLFiles[filepath.Join(real, "node_modules", "@x", "kit", "src", "Message.pzl")] {
		t.Errorf("PZLFiles missing the package component: %v", usage.PZLFiles)
	}
}

// Everything that is not a declaring package's shipped .pzl stays out:
// undeclared and malformed packages, Puzzle itself, a package's scripts and the
// lazy() text match of its templates (the bit is an app route-table fact), its
// dot-directories, and the example/test folders at its root. Its dist/ is read:
// packages publish .pzl source there.
func TestScanUsageSkipsWhatPackagesMayNotContribute(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl":                             plainHome,
		"node_modules/plain/package.json":                `{"name":"plain","dependencies":{"left-pad":"1"}}`,
		"node_modules/plain/Thing.pzl":                   `<puzzle-view><Portal><p>x</p></Portal></puzzle-view>`,
		"node_modules/broken/package.json":               `{"name":"broken","peerDependencies":`,
		"node_modules/broken/Broken.pzl":                 `<puzzle-view>{ raw(x) }</puzzle-view>`,
		"node_modules/nomanifest/Bare.pzl":               `<puzzle-view>{ raw(x) }</puzzle-view>`,
		"node_modules/@magic-spells/puzzle/package.json": `{"name":"@magic-spells/puzzle","dependencies":{"@magic-spells/puzzle":"*"}}`,
		"node_modules/@magic-spells/puzzle/Fixture.pzl":  `<puzzle-view>{#raw}<b @x="y">r</b>{/raw}</puzzle-view>`,
		"node_modules/@x/kit/package.json":               peerManifest,
		"node_modules/@x/kit/router.js":                  "export const view = lazy(() => import('./V.pzl'));\n",
		"node_modules/@x/kit/.cache/Cached.pzl":          `<puzzle-view>{ currency(x) }</puzzle-view>`,
		"node_modules/@x/kit/Card.pzl":                   `<puzzle-view><p>{ capitalize(x) }</p></puzzle-view>`,
		"node_modules/@x/kit/Routes.pzl":                 "<puzzle-view><p>r</p></puzzle-view>\n<script>\nexport const v = lazy(() => import('./V.pzl'));\n</script>\n",
		"node_modules/@x/kit/example/Demo.pzl":           `<puzzle-view><div flip>demo</div></puzzle-view>`,
		"node_modules/@x/kit/tests/Spec.pzl":             `<puzzle-view><Portal><p>t</p></Portal></puzzle-view>`,
		"node_modules/@x/kit/dist/Ship.pzl":              `<puzzle-view><p>{ truncate(x, 3) }</p></puzzle-view>`,
	})
	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatalf("ScanUsage: %v", err)
	}
	if !usage.Formatters["capitalize"] || !usage.Formatters["truncate"] {
		t.Fatalf("the declaring package (root and dist/) was not read: %+v", usage)
	}
	if usage.HasPortal || usage.HasFlip || usage.HasRawHTML || usage.HasRawAt || usage.HasLazy || usage.Formatters["currency"] {
		t.Errorf("a package source that must not contribute did: %+v", usage)
	}
}

// node resolution searches every ancestor's node_modules, so the walk does too:
// an app inside a monorepo whose packages are hoisted to the repo root.
func TestScanUsageFindsAncestorNodeModules(t *testing.T) {
	repo := writeApp(t, map[string]string{
		"node_modules/@x/kit/package.json": peerManifest,
		"node_modules/@x/kit/Message.pzl":  kitMessage,
		"apps/site/app/views/Home.pzl":     plainHome,
		"apps/site/node_modules/.keep":     "",
	})
	usage, err := ScanUsage(filepath.Join(repo, "apps", "site"))
	if err != nil {
		t.Fatalf("ScanUsage: %v", err)
	}
	if !usage.HasRawHTML || !usage.Formatters["currency"] {
		t.Errorf("hoisted package in an ancestor node_modules not read: %+v", usage)
	}
}

// A package reached through symlinks — a linked checkout under two names, and a
// store layout whose top-level entry points into a shared virtual store where
// the package's own dependencies sit beside it — is read by its real path,
// once.
func TestScanUsageReadsSymlinkedPackagesOnce(t *testing.T) {
	base := writeApp(t, map[string]string{
		"project/app/views/Home.pzl": plainHome,
		"linked/kit/package.json":    peerManifest,
		"linked/kit/Message.pzl":     kitMessage,
		"project/node_modules/.store/@y+widget@1.0.0/node_modules/@y/widget/package.json": `{"name":"@y/widget","peerDependencies":{"@magic-spells/puzzle":"*"}}`,
		"project/node_modules/.store/@y+widget@1.0.0/node_modules/@y/widget/W.pzl":        `<puzzle-view><Portal><p>w</p></Portal></puzzle-view>`,
		"project/node_modules/.store/@y+widget@1.0.0/node_modules/dep/package.json":       `{"name":"dep","peerDependencies":{"@magic-spells/puzzle":"*"}}`,
		"project/node_modules/.store/@y+widget@1.0.0/node_modules/dep/D.pzl":              `<puzzle-view><div flip>d</div></puzzle-view>`,
	})
	root := filepath.Join(base, "project")
	nm := filepath.Join(root, "node_modules")
	links := map[string]string{
		filepath.Join(nm, "@x", "kit"):    filepath.Join(base, "linked", "kit"),
		filepath.Join(nm, "kit-alias"):    filepath.Join(base, "linked", "kit"),
		filepath.Join(nm, "@y", "widget"): filepath.Join(nm, ".store", "@y+widget@1.0.0", "node_modules", "@y", "widget"),
	}
	for link, target := range links {
		if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(target, link); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
	}

	s := NewUsageScanner()
	usage, err := s.Scan(root)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if !usage.HasRawHTML || !usage.Formatters["currency"] {
		t.Errorf("linked package not read: %+v", usage)
	}
	if !usage.HasPortal {
		t.Error("store-layout package not read through its top-level link")
	}
	if !usage.HasFlip {
		t.Error("a store-layout package's own declaring dependency was not read")
	}
	realKit, _ := filepath.EvalSymlinks(filepath.Join(base, "linked", "kit", "Message.pzl"))
	n := 0
	for path := range s.entries {
		if filepath.Base(path) == "Message.pzl" {
			n++
			if path != realKit {
				t.Errorf("memo key %q, want the real path %q", path, realKit)
			}
		}
	}
	if n != 1 {
		t.Errorf("linked package's .pzl memoized %d times, want once: %v", n, s.entries)
	}
}

// A long-lived scanner re-reads a package manifest when it changes, and a
// manifest that stops declaring Puzzle retires the package's usage.
func TestUsageScannerTracksPackageManifests(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl":               plainHome,
		"node_modules/@x/kit/package.json": `{"name":"@x/kit"}`,
		"node_modules/@x/kit/Message.pzl":  kitMessage,
	})
	manifest := filepath.Join(root, "node_modules", "@x", "kit", "package.json")
	s := NewUsageScanner()
	if u, _ := s.Scan(root); u.HasRawHTML {
		t.Fatalf("undeclared package was read: %+v", u)
	}
	if err := os.WriteFile(manifest, []byte(peerManifest), 0o644); err != nil {
		t.Fatal(err)
	}
	if u, _ := s.Scan(root); !u.HasRawHTML {
		t.Fatalf("a manifest that now declares Puzzle was not re-read: %+v", u)
	}
	if err := os.WriteFile(manifest, []byte(`{"name":"@x/kit","peerDependencies":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if u, _ := s.Scan(root); u.HasRawHTML {
		t.Fatalf("a package that stopped declaring Puzzle still contributes: %+v", u)
	}
}

// scannedBuild runs one esbuild pass the way the build does: scan first, hand
// the Usage to the plugin, then bundle.
func scannedBuild(t *testing.T, root string) api.BuildResult {
	t.Helper()
	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatalf("ScanUsage: %v", err)
	}
	pl := New(root)
	pl.SetUsage(usage)
	return api.Build(api.BuildOptions{
		EntryPoints: []string{filepath.Join(root, "app", "app.js")},
		Bundle:      true,
		Write:       false,
		Format:      api.FormatESModule,
		External:    []string{"@magic-spells/puzzle"},
		Plugins:     []api.Plugin{pl.ESBuild()},
		LogLevel:    api.LogLevelSilent,
	})
}

const kitAppJS = `import Home from './views/Home.pzl';
import Message from 'kit/Message.pzl';
export default [Home, Message];
`

// The safety net: an app that imports a .pzl the scan never read fails the
// build when that file needs a feature the build compiled out, naming the file,
// the feature, and the fix — instead of a production-only throw.
func TestUndeclaredPackageFailsTheBuild(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js":                    kitAppJS,
		"app/views/Home.pzl":            plainHome,
		"node_modules/kit/package.json": `{"name":"kit"}`,
		"node_modules/kit/Message.pzl":  kitMessage,
	})
	res := scannedBuild(t, root)
	if len(res.Errors) != 1 {
		t.Fatalf("want exactly one error, got %d: %+v", len(res.Errors), res.Errors)
	}
	msg := res.Errors[0]
	if msg.Location == nil || msg.Location.File != "node_modules/kit/Message.pzl" {
		t.Errorf("error does not name the file: %+v", msg.Location)
	}
	for _, want := range []string{"raw()", "currency()", "compiled out"} {
		if !strings.Contains(msg.Text, want) {
			t.Errorf("error text %q does not mention %q", msg.Text, want)
		}
	}
	notes := ""
	for _, n := range msg.Notes {
		notes += n.Text + "\n"
	}
	if !strings.Contains(notes, `add "@magic-spells/puzzle" to that package's peerDependencies`) || !strings.Contains(notes, "restart") {
		t.Errorf("notes lack the peerDependencies fix or the dev restart: %s", notes)
	}

	// Declaring Puzzle is the fix: the same app now builds.
	write := filepath.Join(root, "node_modules", "kit", "package.json")
	if err := os.WriteFile(write, []byte(`{"name":"kit","peerDependencies":{"@magic-spells/puzzle":"*"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if res := scannedBuild(t, root); len(res.Errors) != 0 {
		t.Errorf("declaring package still fails: %+v", res.Errors)
	}
}

// A file the scan did not read but whose features are already on (the app uses
// them too) is fine, and so is a build whose plugin never got a Usage — focused
// callers that compile without scanning.
func TestUnscannedFileWithFeaturesOnBuilds(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js": kitAppJS,
		"app/views/Home.pzl": `<puzzle-view><p>{ raw(intro) } { currency(total) }</p></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
		"node_modules/kit/Message.pzl": kitMessage,
	})
	if res := scannedBuild(t, root); len(res.Errors) != 0 {
		t.Errorf("features already on, yet the check failed: %+v", res.Errors)
	}
	if res, _ := buildApp(t, root); len(res.Errors) != 0 {
		t.Errorf("an unscanned plugin ran the check: %+v", res.Errors)
	}
}

// Across incremental rebuilds the record outlives a cached OnLoad, and leaves
// with the import: dropping the import clears the error on the next rebuild.
func TestUsageCheckFollowsTheModuleGraph(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js":                   kitAppJS,
		"app/views/Home.pzl":           plainHome,
		"node_modules/kit/Message.pzl": kitMessage,
	})
	pl := New(root)
	rescan := func() {
		usage, err := ScanUsage(root)
		if err != nil {
			t.Fatal(err)
		}
		pl.SetUsage(usage)
	}
	rescan()
	ctx, cerr := api.Context(api.BuildOptions{
		EntryPoints: []string{filepath.Join(root, "app", "app.js")},
		Bundle:      true,
		Write:       false,
		Metafile:    true,
		Format:      api.FormatESModule,
		External:    []string{"@magic-spells/puzzle"},
		Plugins:     []api.Plugin{pl.ESBuild()},
		LogLevel:    api.LogLevelSilent,
	})
	if cerr != nil {
		t.Fatalf("api.Context: %s", cerr.Error())
	}
	defer ctx.Dispose()

	if res := ctx.Rebuild(); len(res.Errors) != 1 {
		t.Fatalf("first rebuild: want the mismatch error, got %+v", res.Errors)
	}
	// Unchanged files: esbuild serves the cached OnLoad, the record still fails.
	if res := ctx.Rebuild(); len(res.Errors) != 1 {
		t.Fatalf("second rebuild lost the mismatch: %+v", res.Errors)
	}
	app := filepath.Join(root, "app", "app.js")
	if err := os.WriteFile(app, []byte("import Home from './views/Home.pzl';\nexport default Home;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rescan()
	if res := ctx.Rebuild(); len(res.Errors) != 0 {
		t.Errorf("dropping the import did not clear the error: %+v", res.Errors)
	}
}

// A Puzzle package can be the dependency of one that is not: its nested
// node_modules (npm) and the store directory beside a linked entry (pnpm) are
// listed whatever the parent's verdict, though the parent's own files are not
// read.
func TestScanUsageFindsPuzzlePackagesUnderPlainParents(t *testing.T) {
	base := `{"name":"@y/base","peerDependencies":{"@magic-spells/puzzle":"*"}}`
	t.Run("npm nested", func(t *testing.T) {
		root := writeApp(t, map[string]string{
			"app/views/Home.pzl":                                     plainHome,
			"node_modules/wrapper/package.json":                      `{"name":"wrapper"}`,
			"node_modules/wrapper/index.pzl":                         `<puzzle-view><Portal><p>w</p></Portal></puzzle-view>`,
			"node_modules/wrapper/node_modules/@y/base/package.json": base,
			"node_modules/wrapper/node_modules/@y/base/Msg.pzl":      kitMessage,
		})
		usage, err := ScanUsage(root)
		if err != nil {
			t.Fatal(err)
		}
		if !usage.HasRawHTML || !usage.Formatters["currency"] {
			t.Errorf("Puzzle package nested under a plain one not read: %+v", usage)
		}
		if usage.HasPortal {
			t.Error("the plain parent's own .pzl was read")
		}
	})
	t.Run("store layout", func(t *testing.T) {
		root := writeApp(t, map[string]string{
			"app/views/Home.pzl": plainHome,
			"node_modules/.pnpm/wrapper@1.0.0/node_modules/wrapper/package.json": `{"name":"wrapper"}`,
			"node_modules/.pnpm/wrapper@1.0.0/node_modules/wrapper/index.pzl":    `<puzzle-view><p>w</p></puzzle-view>`,
			"node_modules/.pnpm/@y+base@1.0.0/node_modules/@y/base/package.json": base,
			"node_modules/.pnpm/@y+base@1.0.0/node_modules/@y/base/Msg.pzl":      kitMessage,
		})
		nm := filepath.Join(root, "node_modules")
		symlink(t, filepath.Join(nm, ".pnpm", "wrapper@1.0.0", "node_modules", "wrapper"), filepath.Join(nm, "wrapper"))
		symlink(t, filepath.Join(nm, ".pnpm", "@y+base@1.0.0", "node_modules", "@y", "base"),
			filepath.Join(nm, ".pnpm", "wrapper@1.0.0", "node_modules", "@y", "base"))
		usage, err := ScanUsage(root)
		if err != nil {
			t.Fatal(err)
		}
		if !usage.HasRawHTML || !usage.Formatters["currency"] {
			t.Errorf("store-layout Puzzle dependency of a plain package not read: %+v", usage)
		}
	})
}

// An app is not a dependency: a workspace sibling app linked into the shared
// node_modules (it has a puzzle.config.js and lives outside node_modules)
// contributes nothing, and neither does it when a declaring workspace root
// linked into node_modules is walked — app folders inside a counted package's
// tree are skipped.
func TestScanUsageSkipsAppsLinkedAsPackages(t *testing.T) {
	ws := writeApp(t, map[string]string{
		"package.json":                      `{"name":"ws","dependencies":{"@magic-spells/puzzle":"*"}}`,
		"packages/app-a/package.json":       `{"name":"app-a","dependencies":{"@magic-spells/puzzle":"*"}}`,
		"packages/app-a/puzzle.config.js":   "export default {};\n",
		"packages/app-a/app/views/Home.pzl": plainHome,
		"packages/app-b/package.json":       `{"name":"app-b","dependencies":{"@magic-spells/puzzle":"*"}}`,
		"packages/app-b/puzzle.config.js":   "export default {};\n",
		"packages/app-b/app/views/Rich.pzl": kitMessage,
	})
	nm := filepath.Join(ws, "node_modules")
	symlink(t, filepath.Join(ws, "packages", "app-a"), filepath.Join(nm, "app-a"))
	symlink(t, filepath.Join(ws, "packages", "app-b"), filepath.Join(nm, "app-b"))
	symlink(t, ws, filepath.Join(nm, "ws"))
	usage, err := ScanUsage(filepath.Join(ws, "packages", "app-a"))
	if err != nil {
		t.Fatal(err)
	}
	if usage.HasRawHTML || usage.Formatters["currency"] || usage.HasFlip {
		t.Errorf("an app linked into node_modules was read as a package: %+v", usage)
	}
}

func symlink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
}

// The error's advice follows the owning package's manifest: an undeclared
// package linked in from outside the project gets the peerDependencies fix,
// and a package that already declares Puzzle is told why the walk skipped the
// file instead of being told to declare it again.
func TestUsageMismatchAdviceReadsTheOwningManifest(t *testing.T) {
	base := writeApp(t, map[string]string{
		"project/app/app.js":                           "import Home from './views/Home.pzl';\nimport M from 'kit/Message.pzl';\nimport D from '@x/kit/example/Demo.pzl';\nexport default [Home, M, D];\n",
		"project/app/views/Home.pzl":                   plainHome,
		"linked/kit/package.json":                      `{"name":"kit"}`,
		"linked/kit/Message.pzl":                       kitMessage,
		"project/node_modules/@x/kit/package.json":     peerManifest,
		"project/node_modules/@x/kit/example/Demo.pzl": `<puzzle-view><div flip>d</div></puzzle-view>`,
	})
	root := filepath.Join(base, "project")
	symlink(t, filepath.Join(base, "linked", "kit"), filepath.Join(root, "node_modules", "kit"))
	res := scannedBuild(t, root)
	if len(res.Errors) != 2 {
		t.Fatalf("want two mismatch errors, got %+v", res.Errors)
	}
	notes := map[string]string{}
	for _, m := range res.Errors {
		notes[m.Location.File] = m.Notes[0].Text
	}
	var linked, declared string
	for file, note := range notes {
		switch {
		case strings.HasSuffix(file, "linked/kit/Message.pzl"):
			linked = note
		case strings.HasSuffix(file, "example/Demo.pzl"):
			declared = note
		}
	}
	if !strings.Contains(linked, "peerDependencies") || !strings.Contains(linked, "does not declare") {
		t.Errorf("linked undeclared package got %q", linked)
	}
	if !strings.Contains(declared, "declares Puzzle") || strings.Contains(declared, "add \"@magic-spells/puzzle\"") {
		t.Errorf("declared package got %q", declared)
	}
}

// A large flat install: only link entries resolve symlinks. The benchmark
// tracks the warm rescan cost the dev loop pays on every scan-input save.
func BenchmarkPackageWalkFlat(b *testing.B) {
	root := b.TempDir()
	for i := 0; i < 3000; i++ {
		dir := filepath.Join(root, "node_modules", fmt.Sprintf("pkg%04d", i))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"p"}`), 0o644); err != nil {
			b.Fatal(err)
		}
	}
	s := NewUsageScanner()
	if _, err := s.Scan(root); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.Scan(root); err != nil {
			b.Fatal(err)
		}
	}
}

// A package repo whose example app depends on it with "file:.." links the
// package back as an ancestor of the scan root. It is a package, not the app:
// its source is read, and the example app (the scan root) is not walked twice.
func TestScanUsageReadsAPackageRepoFromItsExampleApp(t *testing.T) {
	kit := writeApp(t, map[string]string{
		"package.json":               peerManifest,
		"src/Msg.pzl":                kitMessage,
		"example/package.json":       `{"name":"example","dependencies":{"kit":"file:..","@magic-spells/puzzle":"*"}}`,
		"example/puzzle.config.js":   "export default {};\n",
		"example/app/views/Home.pzl": plainHome,
	})
	symlink(t, "../..", filepath.Join(kit, "example", "node_modules", "kit"))
	usage, err := ScanUsage(filepath.Join(kit, "example"))
	if err != nil {
		t.Fatal(err)
	}
	if !usage.HasRawHTML || !usage.Formatters["currency"] {
		t.Errorf("the package repo linked back as an ancestor was skipped: %+v", usage)
	}
}

// An installed package that ships a puzzle.config.js (for its own demo) is
// still a package: the app marker only counts outside node_modules.
func TestScanUsageReadsInstalledPackageWithAConfig(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl":                plainHome,
		"node_modules/kit/package.json":     peerManifest,
		"node_modules/kit/puzzle.config.js": "export default {};\n",
		"node_modules/kit/Msg.pzl":          kitMessage,
	})
	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatal(err)
	}
	if !usage.HasRawHTML || !usage.Formatters["currency"] {
		t.Errorf("an installed package with a puzzle.config.js was skipped: %+v", usage)
	}
}
