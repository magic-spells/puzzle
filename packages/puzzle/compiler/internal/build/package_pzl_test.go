package build

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// packageKitFixture is the base static app plus an installed component package,
// node_modules/@x/kit, whose Message.pzl renders markdown-style HTML through
// raw(). The home view imports it by package name; nothing in the app's own
// templates uses raw(), so the only way the live-HTML runtime and the sanitizer
// reach the bundle is the package walk. manifest is the package's package.json.
func packageKitFixture(manifest string) ssgFixtureFiles {
	files := baseSSGFixture()
	files["app/views/Home.pzl"] = `<puzzle-view>
  <h1>Home</h1>
  <Message body={ body } />
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Message from '@x/kit/Message.pzl';
export default class Home extends PuzzleView {
  data() { return { body: '<em>PACKAGE_RAW_MARKER</em><script>alert(1)</script>' }; }
}
</script>
`
	files["node_modules/@x/kit/package.json"] = manifest
	files["node_modules/@x/kit/Message.pzl"] = `<puzzle-view>
  <div class="message">{ raw(body) }</div>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Message extends PuzzleView {
  data(params, props) { return { body: props.body }; }
}
</script>
`
	return files
}

// A production static build of an app that renders a package component using
// raw(): the package declares Puzzle, so its usage keeps the live-HTML runtime
// and the sanitizer, and the prerender emits the sanitized markup instead of
// throwing "#html reached the DOM".
func TestBuildReadsDeclaringPackagePZL(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, packageKitFixture(`{"name":"@x/kit","version":"1.0.0","peerDependencies":{"@magic-spells/puzzle":">=0.9.0 <0.10.0"}}`))

	var buildErr error
	out := captureStderr(t, func() {
		buildErr = Build(root, Options{Development: false, Output: "static"})
	})
	if buildErr != nil {
		t.Fatalf("static Build failed: %v\n%s", buildErr, out)
	}
	html := readFile(t, filepath.Join(root, "dist", "index.html"))
	if !strings.Contains(html, "<em>PACKAGE_RAW_MARKER</em>") {
		t.Errorf("prerendered page lacks the package's raw() markup:\n%s", html)
	}
	if strings.Contains(html, "alert(1)") {
		t.Errorf("raw() markup was not sanitized:\n%s", html)
	}
	if strings.Contains(out, "reached the DOM") {
		t.Errorf("build output reports a compiled-out vnode:\n%s", out)
	}

	// The browser half carries the sanitizer too: some page module or shared
	// chunk under dist/ must hold it, or the page breaks once it takes over.
	found := false
	_ = filepath.WalkDir(filepath.Join(root, "dist"), func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(path, ".js") && strings.Contains(readFile(t, path), sanitizerMarker) {
			found = true
		}
		return nil
	})
	if !found {
		t.Error("no browser module under dist/ retained the sanitizer for the package's raw()")
	}
}

// The same app with a package that does not declare Puzzle fails the build
// before anything ships, naming the package file, the feature, and the fix.
func TestBuildFailsOnUndeclaredPackagePZL(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, packageKitFixture(`{"name":"@x/kit","version":"1.0.0"}`))

	var buildErr error
	out := captureStderr(t, func() {
		buildErr = Build(root, Options{Development: false, Output: "static"})
	})
	if buildErr == nil {
		t.Fatalf("static Build succeeded with an undeclared raw() package:\n%s", out)
	}
	msg := buildErr.Error() + out
	for _, want := range []string{"node_modules/@x/kit/Message.pzl", "raw()", "peerDependencies"} {
		if !strings.Contains(msg, want) {
			t.Errorf("build error lacks %q:\n%s", want, msg)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "dist")); err == nil {
		t.Error("a failed build left dist/ behind")
	}
}

// In `puzzle dev` the same check reports through the ordinary rebuild error
// (the browser overlay's source), and says a restart picks up a package fix.
func TestWatchBuilderReportsUndeclaredPackagePZL(t *testing.T) {
	root := scratchApp(t)
	files := packageKitFixture(`{"name":"@x/kit"}`)
	for _, rel := range []string{"app/views/Home.pzl", "node_modules/@x/kit/package.json", "node_modules/@x/kit/Message.pzl"} {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		write(t, path, files[rel])
	}
	write(t, filepath.Join(root, "app", "app.js"), "import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()
	_, err = b.Rebuild(nil)
	if err == nil {
		t.Fatal("dev rebuild succeeded with an undeclared raw() package")
	}
	for _, want := range []string{"node_modules/@x/kit/Message.pzl", "raw()", "peerDependencies", "restart"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("dev rebuild error lacks %q:\n%v", want, err)
		}
	}
}
