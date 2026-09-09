package preview

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/serve"
)

func writeDist(t *testing.T, files map[string]string) string {
	t.Helper()
	dist := filepath.Join(t.TempDir(), "dist")
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

func get(t *testing.T, dist, mode, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler(dist, mode).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://preview.test"+path, nil))
	return rec
}

// TestPreviewSPAFallback proves a deep link into an SPA build serves index.html
// — the history-API fallback a real host is configured with.
func TestPreviewSPAFallback(t *testing.T) {
	dist := writeDist(t, map[string]string{
		"index.html": `<html><body><div id="app"></div></body></html>`,
		"app.js":     "console.log(1)",
	})

	rec := get(t, dist, serve.ModeSPA, "/todos/42")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `id="app"`) {
		t.Fatalf("SPA deep link = %d %q, want the index.html shell", rec.Code, rec.Body.String())
	}
	// Nothing is injected: preview serves the artifact byte-for-byte.
	if strings.Contains(rec.Body.String(), "EventSource") {
		t.Fatalf("preview injected a live-reload client: %q", rec.Body.String())
	}
	if rec := get(t, dist, serve.ModeSPA, "/app.js"); rec.Code != http.StatusOK || rec.Body.String() != "console.log(1)" {
		t.Fatalf("SPA asset = %d %q", rec.Code, rec.Body.String())
	}
}

// TestPreviewHybridServesPrerenderedPageFirst proves the prerendered page beats
// the shell, while an unprerendered route still reaches the router's shell.
func TestPreviewHybridServesPrerenderedPageFirst(t *testing.T) {
	dist := writeDist(t, map[string]string{
		"index.html":      `<html><body>SHELL</body></html>`,
		"app.js":          "console.log(1)",
		"docs/index.html": `<html><body>PRERENDERED_DOCS</body></html>`,
	})

	rec := get(t, dist, serve.ModeHybrid, "/docs")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "PRERENDERED_DOCS") {
		t.Fatalf("hybrid /docs = %d %q, want the prerendered page", rec.Code, rec.Body.String())
	}
	rec = get(t, dist, serve.ModeHybrid, "/todos/42")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "SHELL") {
		t.Fatalf("hybrid dynamic route = %d %q, want the shell", rec.Code, rec.Body.String())
	}
}

// TestPreviewStaticCleanURLsAndRealNotFound is the behavior preview exists for:
// static output has no router, so a miss must be a 404, not the home page.
func TestPreviewStaticCleanURLsAndRealNotFound(t *testing.T) {
	dist := writeDist(t, map[string]string{
		"index.html":       `<html><body>HOME</body></html>`,
		"about/index.html": `<html><body>ABOUT</body></html>`,
	})

	rec := get(t, dist, serve.ModeStatic, "/about")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ABOUT") {
		t.Fatalf("static /about = %d %q, want the about page", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("static page content-type = %q", ct)
	}

	rec = get(t, dist, serve.ModeStatic, "/nope")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("static miss = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "HOME") {
		t.Fatalf("static miss fell back to index.html: %q", rec.Body.String())
	}
}

// TestPreviewStaticServes404Page proves the catch-all route's built 404.html is
// the body of a miss, at status 404 — what the static hosts do.
func TestPreviewStaticServes404Page(t *testing.T) {
	dist := writeDist(t, map[string]string{
		"index.html": `<html><body>HOME</body></html>`,
		"404.html":   `<html><body>CUSTOM_404</body></html>`,
	})

	rec := get(t, dist, serve.ModeStatic, "/nope")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "CUSTOM_404") {
		t.Fatalf("static miss = %d %q, want the built 404.html at 404", rec.Code, rec.Body.String())
	}
}

func TestCheckDistErrors(t *testing.T) {
	root := t.TempDir()
	missing := filepath.Join(root, "dist")
	err := checkDist(missing)
	if err == nil || !strings.Contains(err.Error(), "puzzle build") {
		t.Fatalf("missing dist error = %v, want a run-puzzle-build message", err)
	}

	if err := os.MkdirAll(missing, 0o755); err != nil {
		t.Fatal(err)
	}
	err = checkDist(missing)
	if err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("empty dist error = %v, want an empty-dir message", err)
	}

	if err := os.WriteFile(filepath.Join(missing, "index.html"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := checkDist(missing); err != nil {
		t.Fatalf("populated dist rejected: %v", err)
	}
}

// TestShapeWarning proves a dist/ whose shape disagrees with the configured mode
// is called out (and, per the command's contract, still served per the config).
func TestShapeWarning(t *testing.T) {
	spaShaped := writeDist(t, map[string]string{"index.html": "x", "app.js": "x"})
	staticShaped := writeDist(t, map[string]string{"index.html": "x", "_puzzle/index.js": "x"})

	if got := shapeWarning(spaShaped, serve.ModeStatic); !strings.Contains(got, "app.js") {
		t.Errorf("static config + SPA-shaped dist warning = %q", got)
	}
	if got := shapeWarning(staticShaped, serve.ModeSPA); !strings.Contains(got, "app.js") {
		t.Errorf("SPA config + static-shaped dist warning = %q", got)
	}
	if got := shapeWarning(staticShaped, serve.ModeHybrid); !strings.Contains(got, "hybrid") {
		t.Errorf("hybrid config + static-shaped dist warning = %q", got)
	}
	if got := shapeWarning(spaShaped, serve.ModeSPA); got != "" {
		t.Errorf("matching SPA shape warned: %q", got)
	}
	if got := shapeWarning(staticShaped, serve.ModeStatic); got != "" {
		t.Errorf("matching static shape warned: %q", got)
	}
}

// TestBuiltModeReadsTheMarker proves the artifact's own marker identifies the
// mode, so a dist/ built with the --hybrid/--static FLAG (no config key) previews
// with the right semantics.
func TestBuiltModeReadsTheMarker(t *testing.T) {
	static := writeDist(t, map[string]string{"index.html": `<div id="app" data-puzzle-static></div>`})
	hybrid := writeDist(t, map[string]string{"index.html": `<div id="app" data-puzzle-ssg></div>`})
	spa := writeDist(t, map[string]string{"index.html": `<div id="app"></div>`})

	if got := builtMode(static); got != serve.ModeStatic {
		t.Errorf("static marker → %q, want %q", got, serve.ModeStatic)
	}
	if got := builtMode(hybrid); got != serve.ModeHybrid {
		t.Errorf("hybrid marker → %q, want %q", got, serve.ModeHybrid)
	}
	if got := builtMode(spa); got != "" {
		t.Errorf("unmarked shell → %q, want no mode", got)
	}
	if got := builtMode(filepath.Join(t.TempDir(), "nope")); got != "" {
		t.Errorf("missing dist → %q, want no mode", got)
	}
}
