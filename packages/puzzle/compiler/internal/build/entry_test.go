package build

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeEntries creates root/app and the named entry files under it.
func writeEntries(t *testing.T, names ...string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(root, "app", name), []byte("export default 1;\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// TestResolveEntry pins the one entry rule every consumer shares (D54):
// app/app.ts when it exists, else app/app.js; both is an error naming both;
// neither is the long-standing "entry point not found".
func TestResolveEntry(t *testing.T) {
	t.Run("ts only", func(t *testing.T) {
		root := writeEntries(t, "app.ts")
		got, err := ResolveEntry(root)
		if err != nil {
			t.Fatalf("ResolveEntry: %v", err)
		}
		if want := filepath.Join(root, "app", "app.ts"); got != want {
			t.Errorf("entry = %q, want %q", got, want)
		}
	})
	t.Run("js only", func(t *testing.T) {
		root := writeEntries(t, "app.js")
		got, err := ResolveEntry(root)
		if err != nil {
			t.Fatalf("ResolveEntry: %v", err)
		}
		if want := filepath.Join(root, "app", "app.js"); got != want {
			t.Errorf("entry = %q, want %q", got, want)
		}
	})
	t.Run("both is an error naming both", func(t *testing.T) {
		root := writeEntries(t, "app.ts", "app.js")
		_, err := ResolveEntry(root)
		if err == nil {
			t.Fatal("ResolveEntry must refuse an app with both app/app.ts and app/app.js")
		}
		msg := err.Error()
		for _, want := range []string{
			filepath.Join(root, "app", "app.ts") + ":",
			filepath.Join(root, "app", "app.js"),
			"conflicting build entries",
		} {
			if !strings.Contains(msg, want) {
				t.Errorf("error missing %q:\n%s", want, msg)
			}
		}
	})
	t.Run("neither", func(t *testing.T) {
		root := writeEntries(t)
		_, err := ResolveEntry(root)
		if err == nil {
			t.Fatal("ResolveEntry must fail without an entry")
		}
		for _, want := range []string{"entry point not found", "app/app.ts or app/app.js"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("error missing %q:\n%s", want, err)
			}
		}
	})
}

// tsEntryFixture turns an SSG fixture's app/app.js into app/app.ts carrying
// real TypeScript syntax, so a build that bundled the wrong file — or did not
// strip types — fails loudly.
func tsEntryFixture(files ssgFixtureFiles) ssgFixtureFiles {
	body := files["app/app.js"]
	delete(files, "app/app.js")
	files["app/app.ts"] = "const entryKind: string = 'TS_ENTRY_MARKER';\nconsole.log(entryKind);\n" + body
	return files
}

// A TypeScript app builds from app/app.ts: the SPA bundle still lands at
// dist/app.js, carries the entry's code, and holds no TypeScript syntax.
func TestBuildTypeScriptEntry(t *testing.T) {
	requireSSGRuntime(t)
	root := writeSSGFixture(t, tsEntryFixture(baseSSGFixture()))
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	js := readFile(t, filepath.Join(root, "dist", "app.js"))
	if !strings.Contains(js, "TS_ENTRY_MARKER") {
		t.Error("dist/app.js does not carry app/app.ts's code")
	}
	if strings.Contains(js, "entryKind: string") {
		t.Error("dist/app.js still holds TypeScript syntax from app/app.ts")
	}
}

// Both entries fail the build with the naming error and leave the last good
// dist/ untouched — the build never guesses.
func TestBuildRefusesBothEntries(t *testing.T) {
	requireSSGRuntime(t)
	root := writeSSGFixture(t, baseSSGFixture())
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first Build: %v", err)
	}
	good := readFile(t, filepath.Join(root, "dist", "app.js"))

	if err := os.WriteFile(filepath.Join(root, "app", "app.ts"), []byte("export default 1;\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Build(root, Options{Development: true})
	if err == nil || !strings.Contains(err.Error(), "conflicting build entries") {
		t.Fatalf("Build with both entries: err = %v, want the conflicting-entries error", err)
	}
	if after := readFile(t, filepath.Join(root, "dist", "app.js")); after != good {
		t.Error("a refused build changed dist/app.js")
	}
}

// Both prerender passes import the app entry by path: hybrid's node bundle and
// static's node bundle must each reach app/app.ts.
func TestBuildHybridTypeScriptEntry(t *testing.T) {
	requireSSGRuntime(t)
	root := writeSSGFixture(t, tsEntryFixture(baseSSGFixture()))
	if err := Build(root, Options{Development: true, Output: "hybrid"}); err != nil {
		t.Fatalf("hybrid Build: %v", err)
	}
	if about := readFile(t, filepath.Join(root, "dist", "about", "index.html")); !strings.Contains(about, "About Page") {
		t.Errorf("hybrid build from app/app.ts did not prerender /about:\n%s", about)
	}
}

func TestBuildStaticTypeScriptEntry(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, tsEntryFixture(baseSSGFixture()))
	if err := Build(root, Options{Development: true, Output: "static"}); err != nil {
		t.Fatalf("static Build: %v", err)
	}
	if about := readFile(t, filepath.Join(root, "dist", "about", "index.html")); !strings.Contains(about, "About Page") {
		t.Errorf("static build from app/app.ts did not prerender /about:\n%s", about)
	}
}

// The static capture tier imports the app entry into every page bundle to
// reach an inline adapter; in a TypeScript app that import is app/app.ts.
func TestBuildStaticCaptureTierTypeScriptEntry(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, tsEntryFixture(inlineAdapterFixture("")))

	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	buildErr := Build(root, Options{Development: true, Output: "static"})
	w.Close()
	os.Stdout = oldStdout
	captured, _ := io.ReadAll(r)
	if buildErr != nil {
		t.Fatalf("static Build: %v", buildErr)
	}
	if !strings.Contains(string(captured), "each static page imports the entry") {
		t.Errorf("static build did not note the capture tier, got:\n%s", captured)
	}
	bundles := staticPageBundleSources(t, filepath.Join(root, "dist"))
	if !strings.Contains(bundles, "INLINE_ADAPTER_MARKER") || !strings.Contains(bundles, "TS_ENTRY_MARKER") {
		t.Error("the page bundles did not import app/app.ts to reach the inline adapter")
	}
}

// The SPA dev builder starts from app/app.ts, and refuses to rebuild once a
// second entry appears — its esbuild context is frozen over the first one.
func TestWatchBuilderTypeScriptEntry(t *testing.T) {
	root := scratchApp(t)
	write(t, filepath.Join(root, "app", "views", "Home.pzl"), strings.ReplaceAll(viewTmpl, "%MARKER%", "TS_HOME"))
	appTS := filepath.Join(root, "app", "app.ts")
	write(t, appTS, "import Home from './views/Home.pzl';\nconst view: unknown = Home;\nconsole.log(view);\n")

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	if bundle := readDistBundle(t, root); !strings.Contains(bundle, "TS_HOME") {
		t.Fatalf("bundle from app/app.ts missing its view:\n%s", bundle)
	}

	// Editing the entry rebuilds it.
	write(t, appTS, "import Home from './views/Home.pzl';\nconst view: unknown = Home;\nconsole.log('TS_EDITED', view);\n")
	if _, err := b.Rebuild([]string{appTS}); err != nil {
		t.Fatalf("Rebuild after editing app/app.ts: %v", err)
	}
	if bundle := readDistBundle(t, root); !strings.Contains(bundle, "TS_EDITED") {
		t.Error("an app/app.ts edit did not reach the bundle")
	}

	appJS := filepath.Join(root, "app", "app.js")
	write(t, appJS, "export default 1;\n")
	if _, err := b.Rebuild([]string{appJS}); err == nil || !strings.Contains(err.Error(), "conflicting build entries") {
		t.Errorf("Rebuild with both entries: err = %v, want the conflicting-entries error", err)
	}

	// Renaming the entry out from under the session asks for a restart rather
	// than rebuilding the stale path.
	if err := os.Remove(appTS); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Rebuild([]string{appTS}); err == nil || !strings.Contains(err.Error(), "restart puzzle dev") {
		t.Errorf("Rebuild after the entry moved: err = %v, want the restart error", err)
	}
}

func TestNewWatchBuilderRefusesBothEntries(t *testing.T) {
	root := scratchApp(t)
	write(t, filepath.Join(root, "app", "app.ts"), "export default 1;\n")
	write(t, filepath.Join(root, "app", "app.js"), "export default 1;\n")
	if _, err := NewWatchBuilder(root, WatchOptions{}); err == nil || !strings.Contains(err.Error(), "conflicting build entries") {
		t.Errorf("NewWatchBuilder with both entries: err = %v", err)
	}
	if _, err := NewStaticWatchBuilder(root, StaticWatchOptions{}); err == nil || !strings.Contains(err.Error(), "conflicting build entries") {
		t.Errorf("NewStaticWatchBuilder with both entries: err = %v", err)
	}
}

// The static dev builder renders from app/app.ts too.
func TestStaticWatchBuilderTypeScriptEntry(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, tsEntryFixture(baseSSGFixture()))
	builder, err := NewStaticWatchBuilder(root, StaticWatchOptions{})
	if err != nil {
		t.Fatalf("NewStaticWatchBuilder: %v", err)
	}
	defer builder.Dispose()
	if err := builder.Rebuild(nil); err != nil {
		t.Fatalf("Rebuild: %v", err)
	}
	if about := readFile(t, filepath.Join(root, "dist", "about", "index.html")); !strings.Contains(about, "About Page") {
		t.Errorf("static dev build from app/app.ts did not render /about:\n%s", about)
	}
}

// --fixtures wraps whatever the entry is: a TypeScript app's bundle carries both
// the fixtures install and app/app.ts's code.
func TestBuildFixturesTypeScriptEntry(t *testing.T) {
	root := writeFixturesApp(t, true)
	appJS := filepath.Join(root, "app", "app.js")
	body, err := os.ReadFile(appJS)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(appJS); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "app", "app.ts"), "const entryKind: string = 'TS_ENTRY_MARKER';\nconsole.log(entryKind);\n"+string(body))
	if err := Build(root, Options{Development: true, Fixtures: true}); err != nil {
		t.Fatalf("Build with Fixtures: %v", err)
	}
	js := readFile(t, filepath.Join(root, "dist", "app.js"))
	if !strings.Contains(js, "TS_ENTRY_MARKER") {
		t.Error("the --fixtures bundle did not import app/app.ts")
	}
	for _, marker := range fixturesMarkers {
		if !strings.Contains(js, marker) {
			t.Errorf("the --fixtures bundle is missing %q", marker)
		}
	}
}
