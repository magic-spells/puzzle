package plugin

import (
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

// Everything that is not a declaring package's .pzl stays out: undeclared and
// malformed packages, Puzzle itself, a package's scripts (the lazy() text match
// would trip on runtime-like JavaScript), its dot-directories, and the nested
// dependencies of a package that is not read at all.
func TestScanUsageSkipsWhatPackagesMayNotContribute(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl":                                plainHome,
		"node_modules/plain/package.json":                   `{"name":"plain","dependencies":{"left-pad":"1"}}`,
		"node_modules/plain/Thing.pzl":                      `<puzzle-view><Portal><p>x</p></Portal></puzzle-view>`,
		"node_modules/plain/node_modules/deep/package.json": peerManifest,
		"node_modules/plain/node_modules/deep/Deep.pzl":     `<puzzle-view><div flip>x</div></puzzle-view>`,
		"node_modules/broken/package.json":                  `{"name":"broken","peerDependencies":`,
		"node_modules/broken/Broken.pzl":                    `<puzzle-view>{ raw(x) }</puzzle-view>`,
		"node_modules/nomanifest/Bare.pzl":                  `<puzzle-view>{ raw(x) }</puzzle-view>`,
		"node_modules/@magic-spells/puzzle/package.json":    `{"name":"@magic-spells/puzzle","dependencies":{"@magic-spells/puzzle":"*"}}`,
		"node_modules/@magic-spells/puzzle/Fixture.pzl":     `<puzzle-view>{#raw}<b @x="y">r</b>{/raw}</puzzle-view>`,
		"node_modules/@x/kit/package.json":                  peerManifest,
		"node_modules/@x/kit/router.js":                     "export const view = lazy(() => import('./V.pzl'));\n",
		"node_modules/@x/kit/.cache/Cached.pzl":             `<puzzle-view>{ currency(x) }</puzzle-view>`,
		"node_modules/@x/kit/Card.pzl":                      `<puzzle-view><p>{ capitalize(x) }</p></puzzle-view>`,
	})
	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatalf("ScanUsage: %v", err)
	}
	if !usage.Formatters["capitalize"] {
		t.Fatalf("the declaring package itself was not read: %+v", usage)
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
