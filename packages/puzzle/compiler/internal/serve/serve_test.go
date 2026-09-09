package serve

import (
	"os"
	"path/filepath"
	"testing"
)

// writeTree lays down a dist tree from a map of slash-separated relative paths.
func writeTree(t *testing.T, files map[string]string) string {
	t.Helper()
	dist := t.TempDir()
	for rel, body := range files {
		full := filepath.Join(dist, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dist
}

// TestResolveSPA pins the history-API fallback: only real files are served as
// themselves, everything else is the root shell.
func TestResolveSPA(t *testing.T) {
	dist := writeTree(t, map[string]string{
		"index.html":      "shell",
		"app.js":          "js",
		"docs/index.html": "nested",
	})

	for _, path := range []string{"/", "/index.html", "/todos/42", "/missing.png"} {
		res := Resolve(dist, ModeSPA, path)
		if !res.Shell || res.Status != 200 || res.File != filepath.Join(dist, "index.html") {
			t.Errorf("SPA %s = %+v, want the root shell", path, res)
		}
	}

	// A real nested file is itself, NOT the shell — the historical dev behavior.
	res := Resolve(dist, ModeSPA, "/docs/index.html")
	if res.Shell || !res.HTML || res.File != filepath.Join(dist, "docs", "index.html") {
		t.Errorf("SPA /docs/index.html = %+v, want the nested file", res)
	}
	// A DIRECTORY path stays the shell in SPA mode (no clean-URL resolution).
	if res := Resolve(dist, ModeSPA, "/docs"); !res.Shell {
		t.Errorf("SPA /docs = %+v, want the shell (no clean-URL resolution in SPA mode)", res)
	}
	if res := Resolve(dist, ModeSPA, "/app.js"); res.Shell || res.HTML {
		t.Errorf("SPA /app.js = %+v, want the asset", res)
	}
}

// TestResolveHybrid proves the prerendered page wins over the shell, and the
// shell still catches everything that was not prerendered.
func TestResolveHybrid(t *testing.T) {
	dist := writeTree(t, map[string]string{
		"index.html":      "shell",
		"app.js":          "js",
		"docs/index.html": "prerendered docs",
	})

	res := Resolve(dist, ModeHybrid, "/docs")
	if res.Shell || res.Status != 200 || res.File != filepath.Join(dist, "docs", "index.html") {
		t.Errorf("hybrid /docs = %+v, want the prerendered page", res)
	}
	if res := Resolve(dist, ModeHybrid, "/docs/"); res.File != filepath.Join(dist, "docs", "index.html") {
		t.Errorf("hybrid /docs/ = %+v, want the prerendered page", res)
	}
	// Not prerendered (a dynamic route): the router owns it, so the shell answers.
	if res := Resolve(dist, ModeHybrid, "/todos/42"); !res.Shell || res.Status != 200 {
		t.Errorf("hybrid /todos/42 = %+v, want the shell fallback", res)
	}
}

// TestResolveStaticCleanURLs proves clean-URL resolution and — the point of the
// mode — that a miss is a real 404 rather than the home page.
func TestResolveStaticCleanURLs(t *testing.T) {
	dist := writeTree(t, map[string]string{
		"index.html":       "home",
		"about/index.html": "about",
		"_puzzle/index.js": "js",
	})

	for _, path := range []string{"/about", "/about/", "/about/index.html"} {
		res := Resolve(dist, ModeStatic, path)
		if res.Status != 200 || !res.HTML || res.File != filepath.Join(dist, "about", "index.html") {
			t.Errorf("static %s = %+v, want about/index.html", path, res)
		}
	}
	if res := Resolve(dist, ModeStatic, "/"); res.Status != 200 || res.Shell || res.File != filepath.Join(dist, "index.html") {
		t.Errorf("static / = %+v, want index.html served as a page (never a shell)", res)
	}

	// The miss: 404, no file, and emphatically not index.html.
	res := Resolve(dist, ModeStatic, "/nope")
	if res.Status != 404 || res.File != "" {
		t.Fatalf("static /nope = %+v, want a bare 404", res)
	}
	if res := Resolve(dist, ModeStatic, "/nope/deeper"); res.Status != 404 {
		t.Errorf("static /nope/deeper = %+v, want 404", res)
	}
}

// TestResolveStaticUses404Page proves the catch-all route's built 404.html is
// what a miss serves — the file GitHub Pages / Netlify / Cloudflare serve.
func TestResolveStaticUses404Page(t *testing.T) {
	dist := writeTree(t, map[string]string{
		"index.html": "home",
		"404.html":   "not found page",
	})

	res := Resolve(dist, ModeStatic, "/nope")
	if res.Status != 404 || !res.HTML || res.File != filepath.Join(dist, "404.html") {
		t.Fatalf("static /nope = %+v, want dist/404.html at status 404", res)
	}
}

// TestResolveRejectsTraversal proves an escaping path never resolves to a file
// outside dist in any mode.
func TestResolveRejectsTraversal(t *testing.T) {
	dist := writeTree(t, map[string]string{"index.html": "home"})
	secret := filepath.Join(filepath.Dir(dist), "secret.txt")
	if err := os.WriteFile(secret, []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, mode := range []string{ModeSPA, ModeHybrid, ModeStatic} {
		res := Resolve(dist, mode, "/../secret.txt")
		if res.File == secret {
			t.Fatalf("mode %q served a file outside dist: %+v", mode, res)
		}
	}
}
