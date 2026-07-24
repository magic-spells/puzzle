package dev

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeDist lays down a minimal dist/ (index.html + app.js) in a temp dir and
// returns the dist path.
func writeDist(t *testing.T) string {
	t.Helper()
	dist := t.TempDir()
	index := "<!DOCTYPE html><html><head><title>t</title></head><body><div id=\"app\"></div></body></html>"
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "app.js"), []byte("console.log('hi');"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dist
}

func newTestServer(t *testing.T, dist string) *httptest.Server {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	srv := newServer(dist, ctx, nil)
	ts := httptest.NewServer(srv.handler())
	t.Cleanup(ts.Close)
	// The SSE test builds its own server so it can reach the hub directly.
	return ts
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestHistoryFallback(t *testing.T) {
	dist := writeDist(t)
	ts := newTestServer(t, dist)

	// An extension-less, unknown route must return the SPA shell (index.html).
	body, ct := get(t, ts.URL+"/some/nested/route")
	if !strings.Contains(body, "id=\"app\"") {
		t.Fatalf("history fallback did not serve index.html; body=%q", body)
	}
	if !strings.Contains(body, "EventSource") {
		t.Fatalf("history-fallback index.html missing injected reload client")
	}
	if !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("history fallback content-type = %q, want text/html", ct)
	}
}

func TestServeTimeInjection(t *testing.T) {
	dist := writeDist(t)
	ts := newTestServer(t, dist)

	// "/" and "/index.html" both get the injected client.
	for _, p := range []string{"/", "/index.html"} {
		body, _ := get(t, ts.URL+p)
		if strings.Count(body, "EventSource") != 1 {
			t.Fatalf("GET %s: expected exactly one injected EventSource, body=%q", p, body)
		}
	}

	// Real files are served verbatim (no injection).
	appjs, ct := get(t, ts.URL+"/app.js")
	if strings.Contains(appjs, "EventSource") {
		t.Fatalf("app.js was mutated: %q", appjs)
	}
	if ct == "" {
		t.Fatalf("app.js served with empty content-type")
	}

	// dist/index.html on disk stays clean (production-safe).
	onDisk, err := os.ReadFile(filepath.Join(dist, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(onDisk), "EventSource") {
		t.Fatalf("dist/index.html on disk was mutated with the reload client")
	}
}

func TestDevProxy(t *testing.T) {
	type backendRequest struct {
		method string
		path   string
		query  string
		header string
		body   string
	}
	requests := make(chan backendRequest, 2)
	backend := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body []byte
		if r.Body != nil {
			var err error
			body, err = io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
		requests <- backendRequest{
			method: r.Method,
			path:   r.URL.Path,
			query:  r.URL.RawQuery,
			header: r.Header.Get("X-Proxy-Test"),
			body:   string(body),
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("from backend"))
	})
	backendDown := false
	oldTransport := http.DefaultTransport
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if backendDown {
			return nil, errors.New("connection refused")
		}
		recorder := httptest.NewRecorder()
		backend.ServeHTTP(recorder, r)
		return recorder.Result(), nil
	})
	t.Cleanup(func() { http.DefaultTransport = oldTransport })

	dist := writeDist(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	backendURL := "http://backend.test"
	srv := newServer(dist, ctx, map[string]string{"/api": backendURL})
	var proxyLog bytes.Buffer
	srv.proxyLog = &proxyLog
	handler := srv.handler()

	req := httptest.NewRequest(http.MethodPost, "http://puzzle.test/api/x?mode=full", strings.NewReader("payload"))
	req.Header.Set("X-Proxy-Test", "preserved")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusAccepted || response.Body.String() != "from backend" {
		t.Fatalf("proxy response = %d %q, want %d %q", response.Code, response.Body.String(), http.StatusAccepted, "from backend")
	}
	got := <-requests
	if got.method != http.MethodPost || got.path != "/api/x" || got.query != "mode=full" || got.header != "preserved" || got.body != "payload" {
		t.Fatalf("forwarded request = %+v", got)
	}

	// The exact prefix is registered separately from its subtree form.
	exactResponse := httptest.NewRecorder()
	handler.ServeHTTP(exactResponse, httptest.NewRequest(http.MethodGet, "http://puzzle.test/api", nil))
	if exactResponse.Code != http.StatusAccepted {
		t.Fatalf("GET /api status = %d, want %d", exactResponse.Code, http.StatusAccepted)
	}
	if got := <-requests; got.path != "/api" {
		t.Fatalf("exact prefix forwarded path = %q, want /api", got.path)
	}

	rootResponse := httptest.NewRecorder()
	handler.ServeHTTP(rootResponse, httptest.NewRequest(http.MethodGet, "http://puzzle.test/", nil))
	if rootResponse.Code != http.StatusOK || !strings.Contains(rootResponse.Body.String(), `id="app"`) || !strings.Contains(rootResponse.Body.String(), "EventSource") {
		t.Fatalf("root no longer serves the injected SPA shell: %d %q", rootResponse.Code, rootResponse.Body.String())
	}
	fallbackResponse := httptest.NewRecorder()
	handler.ServeHTTP(fallbackResponse, httptest.NewRequest(http.MethodGet, "http://puzzle.test/client/route", nil))
	if fallbackResponse.Code != http.StatusOK || !strings.Contains(fallbackResponse.Body.String(), `id="app"`) || !strings.Contains(fallbackResponse.Body.String(), "EventSource") {
		t.Fatalf("history fallback no longer serves the injected SPA shell: %d %q", fallbackResponse.Code, fallbackResponse.Body.String())
	}

	backendDown = true
	downResponse := httptest.NewRecorder()
	handler.ServeHTTP(downResponse, httptest.NewRequest(http.MethodGet, "http://puzzle.test/api/down", nil))
	if downResponse.Code != http.StatusBadGateway {
		t.Fatalf("backend-down status = %d, want %d", downResponse.Code, http.StatusBadGateway)
	}
	if got := proxyLog.String(); !strings.Contains(got, "proxy /api → "+backendURL+" refused — is the backend running?") {
		t.Fatalf("backend-down log is not friendly: %q", got)
	}
}

// TestReloadClientSnapshotsBeforeReload proves the injected live-reload client
// calls the dev-published __devSnapshot() before reloading (the state-preserving
// HMR reload, constellation/doc/DOC-SPEC.md §27, D57). A production bundle has no
// __devSnapshot, so the try/catch + unconditional location.reload() must remain.
func TestReloadClientSnapshotsBeforeReload(t *testing.T) {
	dist := writeDist(t)
	ts := newTestServer(t, dist)

	body, _ := get(t, ts.URL+"/")
	if !strings.Contains(body, "__devSnapshot") {
		t.Fatalf("injected reload client missing the __devSnapshot snapshot call; body=%q", body)
	}
	if !strings.Contains(body, "__PUZZLE_APP__") {
		t.Fatalf("injected reload client missing the window.__PUZZLE_APP__ lookup; body=%q", body)
	}
	// The reload must always fire, even when snapshotting throws (prod bundle).
	iSnap := strings.Index(body, "__devSnapshot")
	iReload := strings.Index(body, "location.reload")
	if iReload < 0 || iReload < iSnap {
		t.Fatalf("location.reload must follow the snapshot attempt; body=%q", body)
	}
}

// TestNestedIndexServedVerbatim proves an EXISTING nested index.html
// (dist/docs/index.html) is served as its real file — not shadowed by the
// injected root SPA shell — while the root shell and the SPA history fallback
// both keep their injected client.
func TestNestedIndexServedVerbatim(t *testing.T) {
	dist := writeDist(t)
	docsDir := filepath.Join(dist, "docs")
	if err := os.MkdirAll(docsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	nested := "<!DOCTYPE html><html><head><title>docs</title></head><body><main id=\"docs-page\">DOCS_MARKER</main></body></html>"
	if err := os.WriteFile(filepath.Join(docsDir, "index.html"), []byte(nested), 0o644); err != nil {
		t.Fatal(err)
	}
	ts := newTestServer(t, dist)

	// The nested page is served verbatim: its marker is present, and neither the
	// injected reload client nor the root shell's markup leaks in.
	body, ct := get(t, ts.URL+"/docs/index.html")
	if !strings.Contains(body, "DOCS_MARKER") {
		t.Fatalf("nested index.html not served verbatim; body=%q", body)
	}
	if strings.Contains(body, "EventSource") {
		t.Fatalf("nested index.html must not get the injected reload client; body=%q", body)
	}
	if strings.Contains(body, "id=\"app\"") {
		t.Fatalf("nested index.html was shadowed by the root shell; body=%q", body)
	}
	if !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("nested index.html content-type = %q, want text/html", ct)
	}

	// The ROOT shell still injects (both "/" and "/index.html").
	for _, p := range []string{"/", "/index.html"} {
		rootBody, _ := get(t, ts.URL+p)
		if !strings.Contains(rootBody, "EventSource") || !strings.Contains(rootBody, "id=\"app\"") {
			t.Fatalf("GET %s: root shell lost its injected client: %q", p, rootBody)
		}
	}

	// SPA fallback: a NON-EXISTENT deep path still gets the injected shell.
	fbBody, _ := get(t, ts.URL+"/docs/deep/missing")
	if !strings.Contains(fbBody, "EventSource") || !strings.Contains(fbBody, "id=\"app\"") {
		t.Fatalf("SPA fallback broken for a non-existent nested path: %q", fbBody)
	}
}

func TestSSEBroadcast(t *testing.T) {
	dist := writeDist(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer(dist, ctx, nil)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()

	reqCtx, reqCancel := context.WithCancel(context.Background())
	defer reqCancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, ts.URL+reloadPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// Wait for the handler to register with the hub before broadcasting.
	waitFor(t, 2*time.Second, func() bool { return srv.hub.clientCount() == 1 })

	events := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "event:") {
				events <- strings.TrimSpace(strings.TrimPrefix(line, "event:"))
				return
			}
		}
	}()

	srv.hub.broadcast()

	select {
	case ev := <-events:
		if ev != "reload" {
			t.Fatalf("SSE event = %q, want reload", ev)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for reload event")
	}
}

func TestWatchRebuildOnChange(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	viewsDir := filepath.Join(appDir, "views")
	if err := os.MkdirAll(viewsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	seed := filepath.Join(viewsDir, "Home.pzl")
	if err := os.WriteFile(seed, []byte("<puzzle-view></puzzle-view>"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rebuilds := make(chan []string, 16)
	go func() {
		_ = runWatcher(ctx, []string{appDir}, "", 80*time.Millisecond, func(changed []string) { rebuilds <- changed })
	}()

	// Let fsnotify finish registering the initial tree (unavoidable setup wait).
	time.Sleep(300 * time.Millisecond)

	// 1. Modify an existing watched file → one rebuild.
	if err := os.WriteFile(seed, []byte("<puzzle-view>changed</puzzle-view>"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed := waitRebuild(t, rebuilds, "modify existing file")
	if !containsPath(changed, seed) {
		t.Fatalf("modify existing file changed paths = %v, want %s", changed, seed)
	}

	// 2. Create a NEW subdirectory → the dir Create both triggers a rebuild and
	//    (the regression fix) adds the dir to the watch.
	newDir := filepath.Join(appDir, "components")
	if err := os.Mkdir(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	waitRebuild(t, rebuilds, "create subdirectory")

	// 3. Create a file INSIDE the new subdirectory → only fires if the new dir
	//    is actually watched (proves recursive re-add).
	button := filepath.Join(newDir, "Button.pzl")
	if err := os.WriteFile(button, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed = waitRebuild(t, rebuilds, "create file in new subdirectory")
	if !containsPath(changed, button) {
		t.Fatalf("create file in new subdirectory changed paths = %v, want %s", changed, button)
	}
}

// TestPartitionChanges proves a config-file change is split out of the rebuild
// set (it must not trigger a rebuild — the config is read once at startup) while
// app/public changes stay in it.
func TestPartitionChanges(t *testing.T) {
	cfg := filepath.Join("proj", "puzzle.config.js")
	app := filepath.Join("proj", "app", "views", "Home.pzl")
	pub := filepath.Join("proj", "public", "logo.txt")

	rebuildPaths, configChanged := partitionChanges([]string{app, cfg, pub}, cfg)
	if !configChanged {
		t.Fatal("configChanged should be true when the config file is in the burst")
	}
	if len(rebuildPaths) != 2 {
		t.Fatalf("want 2 rebuild paths (app + public), got %v", rebuildPaths)
	}
	for _, p := range rebuildPaths {
		if p == cfg {
			t.Fatalf("config path leaked into the rebuild set: %v", rebuildPaths)
		}
	}

	// A config-only burst rebuilds nothing.
	rp, cc := partitionChanges([]string{cfg}, cfg)
	if !cc || len(rp) != 0 {
		t.Fatalf("config-only burst: want configChanged + no rebuild paths, got paths=%v changed=%v", rp, cc)
	}

	// No config path configured: everything is a rebuild path.
	rp, cc = partitionChanges([]string{app, pub}, "")
	if cc || len(rp) != 2 {
		t.Fatalf("no config watch: want 2 rebuild paths + no config change, got paths=%v changed=%v", rp, cc)
	}
}

// TestWatcherRootPublicAndConfig proves (a) a change in a root-level public/ tree
// watched alongside app/ surfaces as a rebuild, (c) a puzzle.config.js edit
// surfaces (routed to the advisory, not a rebuild, by partitionChanges), and
// that an unrelated root-level sibling (package.json) is ignored.
func TestWatcherRootPublicAndConfig(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(filepath.Join(appDir, "views"), 0o755); err != nil {
		t.Fatal(err)
	}
	pubDir := filepath.Join(root, "public")
	if err := os.MkdirAll(pubDir, 0o755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, "puzzle.config.js")
	if err := os.WriteFile(configPath, []byte("export default {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rebuilds := make(chan []string, 16)
	go func() {
		_ = runWatcher(ctx, []string{appDir, pubDir}, configPath, 80*time.Millisecond,
			func(changed []string) { rebuilds <- changed })
	}()

	// Let fsnotify finish registering the initial trees (unavoidable setup wait).
	time.Sleep(300 * time.Millisecond)

	// 1. A change in the root-level public/ tree (outside app/) surfaces.
	pubAsset := filepath.Join(pubDir, "logo.txt")
	if err := os.WriteFile(pubAsset, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed := waitRebuild(t, rebuilds, "root-level public change")
	if !containsPath(changed, pubAsset) {
		t.Fatalf("root public change not surfaced; changed=%v want %s", changed, pubAsset)
	}

	// 2. A puzzle.config.js edit surfaces (partitionChanges routes it away from a
	//    rebuild — see TestPartitionChanges).
	if err := os.WriteFile(configPath, []byte("export default { x: 1 }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	changed = waitRebuild(t, rebuilds, "config change")
	if !containsPath(changed, configPath) {
		t.Fatalf("config change not surfaced; changed=%v want %s", changed, configPath)
	}

	// 3. An unrelated root-level sibling (package.json) must be ignored — it is
	//    neither inside a recursive root nor the config file. Late duplicate
	//    events from steps 1–2 are tolerated; only package.json surfacing fails.
	pkg := filepath.Join(root, "package.json")
	if err := os.WriteFile(pkg, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(600 * time.Millisecond)
	for {
		select {
		case c := <-rebuilds:
			if containsPath(c, pkg) {
				t.Fatalf("root-level package.json must not surface as a change: %v", c)
			}
		case <-deadline:
			return
		}
	}
}

// TestWithinDir locks in the lexical path-traversal guard: in-root paths are
// allowed; anything that resolves outside the root is rejected. (URL decoding and
// path.Clean run upstream in serveStatic; withinDir is the lexical backstop that
// must reject a candidate that still resolves outside dist.)
func TestWithinDir(t *testing.T) {
	root := filepath.Clean(t.TempDir())
	parent := filepath.Dir(root)
	cases := []struct {
		name   string
		target string
		want   bool
	}{
		{"in-root file", filepath.Join(root, "app.js"), true},
		{"in-root nested", filepath.Join(root, "assets", "img", "logo.png"), true},
		{"root itself", root, true},
		{"dotdot traversal", filepath.Join(root, "..", "etc", "passwd"), false},
		{"escapes to parent", filepath.Join(parent, "secret.txt"), false},
		{"prefix-only sibling", root + "-evil", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := withinDir(root, tc.target); got != tc.want {
				t.Fatalf("withinDir(%q, %q) = %v, want %v", root, tc.target, got, tc.want)
			}
		})
	}
}

// TestWithinDirResolvedSymlinkEscape proves the symlink-aware backstop rejects a
// symlink that is lexically inside the root but resolves outside it, while still
// allowing a genuine in-root file (also exercising a symlinked root prefix such
// as macOS /tmp → /private/tmp).
func TestWithinDirResolvedSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("top secret"), 0o644); err != nil {
		t.Fatal(err)
	}

	link := filepath.Join(root, "escape")
	if err := os.Symlink(secret, link); err != nil {
		t.Skipf("symlinks unsupported on this platform: %v", err)
	}

	// Lexically the link lives inside root, so the plain guard is fooled...
	if !withinDir(root, link) {
		t.Fatalf("precondition: link should be lexically within root")
	}
	// ...but resolving symlinks reveals the escape, so it must be rejected.
	if withinDirResolved(root, link) {
		t.Fatalf("symlink escape not caught: %s -> %s", link, secret)
	}

	// A real in-root file resolves fine and stays allowed.
	real := filepath.Join(root, "app.js")
	if err := os.WriteFile(real, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !withinDirResolved(root, real) {
		t.Fatalf("legitimate in-root file wrongly rejected: %s", real)
	}
}

func get(t *testing.T, url string) (body, contentType string) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b), resp.Header.Get("Content-Type")
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not met within timeout")
}

func waitRebuild(t *testing.T, ch <-chan []string, what string) []string {
	t.Helper()
	select {
	case changed := <-ch:
		return changed
	case <-time.After(4 * time.Second):
		t.Fatalf("no rebuild after %s", what)
	}
	return nil
}

func containsPath(paths []string, want string) bool {
	for _, p := range paths {
		if p == want {
			return true
		}
	}
	return false
}

// --- port scanning -----------------------------------------------------------

// occupy binds a loopback port and returns it plus a closer, so a test can make
// a specific port genuinely busy rather than mocking the bind.
func occupy(t *testing.T) (int, net.Listener) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupying a port: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	return ln.Addr().(*net.TCPAddr).Port, ln
}

func TestListenDevUsesRequestedPortWhenFree(t *testing.T) {
	// Take a port, release it: the number is known-good and almost certainly
	// still free, without racing a hardcoded constant against the machine.
	want, held := occupy(t)
	held.Close()

	ln, err := listenDev(want, false)
	if err != nil {
		t.Fatalf("listenDev: %v", err)
	}
	defer ln.Close()

	if got := boundPort(ln, 0); got != want {
		t.Errorf("bound port = %d, want the requested %d", got, want)
	}
}

func TestListenDevScansPastBusyPort(t *testing.T) {
	busy, _ := occupy(t)

	ln, err := listenDev(busy, false)
	if err != nil {
		t.Fatalf("listenDev should have scanned past a busy port: %v", err)
	}
	defer ln.Close()

	got := boundPort(ln, 0)
	if got == busy {
		t.Fatalf("bound the busy port %d", busy)
	}
	if got <= busy || got >= busy+portScanLimit {
		t.Errorf("bound port = %d, want one in (%d, %d)", got, busy, busy+portScanLimit)
	}
}

func TestListenDevStrictPortFailsOnBusyPort(t *testing.T) {
	busy, _ := occupy(t)

	ln, err := listenDev(busy, true)
	if err == nil {
		ln.Close()
		t.Fatalf("strict mode bound port %d, want an error", boundPort(ln, 0))
	}
	if !strings.Contains(err.Error(), "address already in use") {
		t.Errorf("error should name the bind failure, got: %v", err)
	}
}

func TestListenDevExhaustedScanReportsRequestedPort(t *testing.T) {
	// Fill the whole scan window so the range is genuinely exhausted, then check
	// the surfaced error names the port the user asked for — not the last one
	// tried, which the user never mentioned.
	first, _ := occupy(t)
	var held []net.Listener
	for offset := 1; offset < portScanLimit; offset++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", first+offset))
		if err != nil {
			// Something else already owns it — equally "busy" for our purposes.
			continue
		}
		held = append(held, ln)
	}
	defer func() {
		for _, ln := range held {
			ln.Close()
		}
	}()

	ln, err := listenDev(first, false)
	if err == nil {
		ln.Close()
		t.Fatalf("exhausted scan bound port %d, want an error", boundPort(ln, 0))
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%d", first)) {
		t.Errorf("error should name the requested port %d, got: %v", first, err)
	}
}

func TestListenDevPortZeroTakesAnyFreePort(t *testing.T) {
	ln, err := listenDev(0, false)
	if err != nil {
		t.Fatalf("listenDev(0): %v", err)
	}
	defer ln.Close()

	if got := boundPort(ln, 0); got == 0 {
		t.Error("port 0 should resolve to a kernel-assigned port")
	}
}
