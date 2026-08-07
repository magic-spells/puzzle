package dev

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/serve"
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
	srv := newServer(dist, serve.ModeSPA, ctx, nil)
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

func TestMissingIndexWithRetainedErrorServesBuildErrorShell(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer(t.TempDir(), serve.ModeSPA, ctx, nil)
	want := "app/views/Home.pzl:4:9: unexpected token\n  4 | {name\n    |      ^"
	srv.rememberBuildError(want)

	response := httptest.NewRecorder()
	srv.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://puzzle.test/", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing index with build error status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if got := response.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("build-error shell content-type = %q, want text/html", got)
	}
	body := response.Body.String()
	for _, marker := range []string{
		"Puzzle build error",
		want,
		`style="` + buildErrorStyle + `"`,
		"EventSource",
		"location.reload",
	} {
		if !strings.Contains(body, marker) {
			t.Fatalf("build-error shell missing %q; body=%q", marker, body)
		}
	}
}

func TestMissingIndexWithoutRetainedErrorKeepsExisting404(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer(t.TempDir(), serve.ModeSPA, ctx, nil)

	response := httptest.NewRecorder()
	srv.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://puzzle.test/", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("missing index without build error status = %d, want %d", response.Code, http.StatusNotFound)
	}
	const want = "puzzle dev: dist/index.html not found (build may have failed)\n"
	if got := response.Body.String(); got != want {
		t.Fatalf("missing-index 404 body changed:\ngot  %q\nwant %q", got, want)
	}
	if strings.Contains(response.Body.String(), "EventSource") {
		t.Fatalf("ordinary missing-index 404 unexpectedly received the reload client: %q", response.Body.String())
	}
}

func TestBuildErrorShellStopsAfterSuccessfulBuild(t *testing.T) {
	dist := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer(dist, serve.ModeSPA, ctx, nil)
	handler := srv.handler()

	srv.rememberBuildError("first build failed")
	failed := httptest.NewRecorder()
	handler.ServeHTTP(failed, httptest.NewRequest(http.MethodGet, "http://puzzle.test/", nil))
	if failed.Code != http.StatusServiceUnavailable {
		t.Fatalf("failed build status = %d, want %d", failed.Code, http.StatusServiceUnavailable)
	}

	index := `<!doctype html><html><body><main id="app">ready</main></body></html>`
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}
	srv.rememberBuildError("")
	srv.hub.broadcast(hubMessage{event: clearEvent})

	recovered := httptest.NewRecorder()
	handler.ServeHTTP(recovered, httptest.NewRequest(http.MethodGet, "http://puzzle.test/", nil))
	if recovered.Code != http.StatusOK {
		t.Fatalf("successful build status = %d, want %d", recovered.Code, http.StatusOK)
	}
	body := recovered.Body.String()
	if !strings.Contains(body, `id="app"`) || !strings.Contains(body, "EventSource") {
		t.Fatalf("successful build did not serve the real injected app shell: %q", body)
	}
	if strings.Contains(body, `<div id="__puzzle-build-error"`) {
		t.Fatalf("successful build still served the server-rendered error shell: %q", body)
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
	srv := newServer(dist, serve.ModeSPA, ctx, map[string]string{"/api": backendURL})
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

// TestProxyPrefixShapesDoNotPanic covers the two proxy maps that used to take
// `puzzle dev` down with a raw http.ServeMux panic — an empty pattern from a "/"
// prefix, and a repeated pattern from two prefixes that normalize to the same
// route. Nothing on the Serve path recovers a panic, so the handler must come up
// for both. config.LoadConfig now rejects these shapes outright; the guards here
// are the backstop for a map the loader never saw.
func TestProxyPrefixShapesDoNotPanic(t *testing.T) {
	// A closed httptest server leaves a real port nothing listens on: every proxied
	// request is refused and answered 502 by the proxy's ErrorHandler, which
	// separates "the proxy owns this path" from the static SPA fallback without
	// standing up a backend.
	closed := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	down := closed.URL
	closed.Close()

	dist := writeDist(t)
	tests := []struct {
		name           string
		proxies        map[string]string
		proxiedPath    string
		wantRootStatus int
	}{
		{
			name:           "single prefix",
			proxies:        map[string]string{"/api": down},
			proxiedPath:    "/api/todos",
			wantRootStatus: http.StatusOK, // the SPA shell still owns /
		},
		{
			name:           "duplicate after normalization",
			proxies:        map[string]string{"/api": down, "/api/": down},
			proxiedPath:    "/api/todos",
			wantRootStatus: http.StatusOK,
		},
		{
			name:           "root prefix",
			proxies:        map[string]string{"/": down},
			proxiedPath:    "/anything",
			wantRootStatus: http.StatusBadGateway, // the proxy owns everything
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			srv := newServer(dist, serve.ModeSPA, ctx, tt.proxies)
			srv.proxyLog = io.Discard
			handler := srv.handler() // must not panic

			proxied := httptest.NewRecorder()
			handler.ServeHTTP(proxied, httptest.NewRequest(http.MethodGet, "http://puzzle.test"+tt.proxiedPath, nil))
			if proxied.Code != http.StatusBadGateway {
				t.Fatalf("GET %s status = %d, want %d (proxied to a dead backend)", tt.proxiedPath, proxied.Code, http.StatusBadGateway)
			}

			root := httptest.NewRecorder()
			handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "http://puzzle.test/", nil))
			if root.Code != tt.wantRootStatus {
				t.Fatalf("GET / status = %d, want %d", root.Code, tt.wantRootStatus)
			}
			if tt.wantRootStatus == http.StatusOK && !strings.Contains(root.Body.String(), `id="app"`) {
				t.Fatalf("GET / no longer serves the SPA shell: %q", root.Body.String())
			}
		})
	}
}

// TestConfigFallbackWarningNamesProxy pins the honesty of the dev warning: a
// puzzle.config.js that fails to load drops dev.proxy along with the Tailwind
// pipeline, and a message naming only styles leaves the developer chasing a JSON
// parse error in the browser.
func TestConfigFallbackWarningNamesProxy(t *testing.T) {
	msg := configFallbackWarning(errors.New("puzzle.config.js: unexpected token"))
	if !strings.Contains(msg, "puzzle.config.js: unexpected token") {
		t.Errorf("warning drops the underlying load error: %q", msg)
	}
	for _, want := range []string{"dev.proxy", "Tailwind", "SPA shell"} {
		if !strings.Contains(msg, want) {
			t.Errorf("warning should mention %q, got: %q", want, msg)
		}
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

	for _, marker := range []string{
		`addEventListener("builderror"`,
		"JSON.parse(event.data)",
		`document.getElementById("__puzzle-build-error")`,
		"Puzzle build error",
		"position:fixed",
		"z-index:2147483647",
		"overflow:auto",
		"white-space:pre-wrap",
		`event.key === "Escape"`,
		`addEventListener("clear"`,
	} {
		if !strings.Contains(body, marker) {
			t.Fatalf("injected reload client missing build-error overlay behavior %q; body=%q", marker, body)
		}
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

func TestHubBroadcastsTypedMessages(t *testing.T) {
	h := newHub()
	ch := h.add()
	defer h.remove(ch)

	messages := []hubMessage{
		{event: reloadEvent, payload: "1"},
		{event: buildErrorEvent, payload: "app/views/Home.pzl:4:9: unexpected token"},
	}
	for _, want := range messages {
		h.broadcast(want)
		if got := waitHubMessage(t, ch, "typed hub message"); got != want {
			t.Fatalf("hub message = %+v, want %+v", got, want)
		}
	}
}

func TestHubLastWriteWinsWhenClientBufferIsFull(t *testing.T) {
	h := newHub()
	ch := h.add()
	defer h.remove(ch)

	h.broadcast(hubMessage{event: reloadEvent, payload: "1"})
	want := hubMessage{event: buildErrorEvent, payload: "latest failure"}
	h.broadcast(want)

	if got := waitHubMessage(t, ch, "replacement hub message"); got != want {
		t.Fatalf("full-buffer message = %+v, want latest %+v", got, want)
	}
	select {
	case extra := <-ch:
		t.Fatalf("stale message remained buffered after replacement: %+v", extra)
	default:
	}
}

func TestBuildErrorBypassesReloadCoalescer(t *testing.T) {
	h := newHub()
	ch := h.add()
	defer h.remove(ch)

	const delay = 50 * time.Millisecond
	coalescer := newReloadCoalescer(delay, h.broadcast)
	coalescer.request()
	coalescer.request()

	wantError := hubMessage{event: buildErrorEvent, payload: "compile failed"}
	h.broadcast(wantError)
	if got := waitHubMessage(t, ch, "immediate build error"); got != wantError {
		t.Fatalf("first message = %+v, want immediate build error %+v", got, wantError)
	}

	wantReload := hubMessage{event: reloadEvent, payload: "1"}
	if got := waitHubMessage(t, ch, "coalesced reload"); got != wantReload {
		t.Fatalf("message after debounce = %+v, want reload %+v", got, wantReload)
	}

	select {
	case extra := <-ch:
		t.Fatalf("reload requests were not coalesced; extra message = %+v", extra)
	case <-time.After(2 * delay):
	}
}

func TestSSEBroadcast(t *testing.T) {
	dist := writeDist(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer(dist, serve.ModeSPA, ctx, nil)
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

	srv.hub.broadcast(hubMessage{event: reloadEvent, payload: "1"})

	select {
	case ev := <-events:
		if ev != "reload" {
			t.Fatalf("SSE event = %q, want reload", ev)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for reload event")
	}
}

func TestSSEMultilinePayloadIsJSONEncodedOnOneDataLine(t *testing.T) {
	dist := writeDist(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer(dist, serve.ModeSPA, ctx, nil)
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

	waitFor(t, 2*time.Second, func() bool { return srv.hub.clientCount() == 1 })

	frames := make(chan sseFrame, 1)
	readErrs := make(chan error, 1)
	go func() {
		frame, err := readSSEFrame(resp.Body)
		if err != nil {
			readErrs <- err
			return
		}
		frames <- frame
	}()

	want := "app/views/Home.pzl:4:9: unexpected token\n  4 | {name\n    |      ^\ntry closing the expression"
	srv.hub.broadcast(hubMessage{event: buildErrorEvent, payload: want})

	select {
	case err := <-readErrs:
		t.Fatalf("reading SSE frame: %v", err)
	case frame := <-frames:
		if frame.event != buildErrorEvent {
			t.Fatalf("SSE event = %q, want %q", frame.event, buildErrorEvent)
		}
		if len(frame.data) != 1 {
			t.Fatalf("SSE data fields = %d, want one JSON-encoded line: %q", len(frame.data), frame.data)
		}
		var got string
		if err := json.Unmarshal([]byte(frame.data[0]), &got); err != nil {
			t.Fatalf("SSE data is not valid JSON: %q: %v", frame.data[0], err)
		}
		if got != want {
			t.Fatalf("decoded SSE payload = %q, want %q", got, want)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for build-error SSE frame")
	}
}

func TestSSEReplaysRetainedBuildErrorOnConnect(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer("", serve.ModeSPA, ctx, nil)

	want := "initial build failed\napp/views/Home.pzl:4:9: unexpected token"
	srv.rememberBuildError(want)
	// The initial build runs before the listener exists, so this fan-out reaches
	// zero clients. Retained state must still reach the later connection (D92).
	srv.hub.broadcast(hubMessage{event: buildErrorEvent, payload: want})

	body := connectSSE(t, srv)
	frame, err := readSSEFrame(strings.NewReader(body))
	if err != nil {
		t.Fatalf("reading replayed SSE frame: %v", err)
	}
	if frame.event != buildErrorEvent {
		t.Fatalf("replayed SSE event = %q, want %q; body=%q", frame.event, buildErrorEvent, body)
	}
	if len(frame.data) != 1 {
		t.Fatalf("replayed SSE data fields = %d, want one JSON line: %q", len(frame.data), frame.data)
	}
	var got string
	if err := json.Unmarshal([]byte(frame.data[0]), &got); err != nil {
		t.Fatalf("replayed SSE data is not valid JSON: %q: %v", frame.data[0], err)
	}
	if got != want {
		t.Fatalf("replayed SSE payload = %q, want %q", got, want)
	}
}

func TestSSEDoesNotReplayClearedBuildError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer("", serve.ModeSPA, ctx, nil)

	srv.rememberBuildError("stale failure")
	srv.hub.broadcast(hubMessage{event: buildErrorEvent, payload: "stale failure"})
	// A subsequent successful build clears retained state before broadcasting
	// clear, matching the rebuild success ordering (D92).
	srv.rememberBuildError("")
	srv.hub.broadcast(hubMessage{event: clearEvent})

	body := connectSSE(t, srv)
	if strings.Contains(body, "event: "+buildErrorEvent) {
		t.Fatalf("new SSE client received a stale build error after success: %q", body)
	}
	if !strings.Contains(body, ": connected\n\n") {
		t.Fatalf("SSE connection preamble missing: %q", body)
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

type sseFrame struct {
	event string
	data  []string
}

func readSSEFrame(r io.Reader) (sseFrame, error) {
	var frame sseFrame
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
			if frame.event != "" {
				return frame, nil
			}
		case strings.HasPrefix(line, "event:"):
			frame.event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			frame.data = append(frame.data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	return frame, scanner.Err()
}

func connectSSE(t *testing.T, srv *server) string {
	t.Helper()
	reqCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "http://puzzle.test"+reloadPath, nil).WithContext(reqCtx)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		srv.serveSSE(response, req)
		close(done)
	}()

	waitFor(t, 2*time.Second, func() bool { return srv.hub.clientCount() == 1 })
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("SSE handler did not stop after client cancellation")
	}
	return response.Body.String()
}

func waitHubMessage(t *testing.T, ch <-chan hubMessage, what string) hubMessage {
	t.Helper()
	select {
	case msg := <-ch:
		return msg
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
	return hubMessage{}
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

// --- static output mode (D81) -------------------------------------------------

// writeStaticDist lays down a dist/ shaped like a `output: 'static'` build:
// prerendered per-route pages, per-page modules, no app.js.
func writeStaticDist(t *testing.T) string {
	t.Helper()
	dist := t.TempDir()
	files := map[string]string{
		"index.html":       `<!doctype html><html><body><div id="app" data-puzzle-static>HOME</div></body></html>`,
		"about/index.html": `<!doctype html><html><body><div id="app" data-puzzle-static>ABOUT</div></body></html>`,
		"404.html":         `<!doctype html><html><body>NOT_FOUND_PAGE</body></html>`,
		"_puzzle/index.js": "export default 1;",
	}
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

func newStaticTestServer(t *testing.T, dist string) *server {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return newServer(dist, serve.ModeStatic, ctx, nil)
}

// TestStaticModeServesCleanURLsWithReloadClient proves dev serves the REAL
// prerendered pages at their clean URLs and that every one of them carries the
// live-reload client — the only path by which a static page reaches the SSE
// channel that drives reload and the D92 error overlay.
func TestStaticModeServesCleanURLsWithReloadClient(t *testing.T) {
	srv := newStaticTestServer(t, writeStaticDist(t))
	handler := srv.handler()

	for path, marker := range map[string]string{
		"/":                 "HOME",
		"/index.html":       "HOME",
		"/about":            "ABOUT",
		"/about/":           "ABOUT",
		"/about/index.html": "ABOUT",
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://puzzle.test"+path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d, want 200", path, rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, marker) {
			t.Fatalf("GET %s served the wrong page: %q", path, body)
		}
		if strings.Count(body, "EventSource") != 1 {
			t.Fatalf("GET %s: want exactly one injected reload client, got %q", path, body)
		}
	}

	// dist/ on disk stays production-clean.
	onDisk, err := os.ReadFile(filepath.Join(srv.dist, "about", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(onDisk), "EventSource") {
		t.Fatal("a prerendered page on disk was mutated with the reload client")
	}
}

// TestStaticModeMissIsARealNotFound proves the dev server does NOT fall back to
// index.html in static mode: dev must show what ships, and what ships is a host
// serving 404.html.
func TestStaticModeMissIsARealNotFound(t *testing.T) {
	srv := newStaticTestServer(t, writeStaticDist(t))

	rec := httptest.NewRecorder()
	srv.handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://puzzle.test/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("static miss = %d, want 404", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "NOT_FOUND_PAGE") {
		t.Fatalf("static miss did not serve the built 404.html: %q", body)
	}
	if strings.Contains(body, "HOME") {
		t.Fatalf("static miss fell back to index.html: %q", body)
	}
	if !strings.Contains(body, "EventSource") {
		t.Fatalf("static 404 lost the reload client (it must self-heal once the route exists): %q", body)
	}
}

// TestStaticModeMissWithoutBuilt404 proves the dev-only 404 page still carries
// the reload client when the app has no catch-all route.
func TestStaticModeMissWithoutBuilt404(t *testing.T) {
	dist := t.TempDir()
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("<html><body>HOME</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := newStaticTestServer(t, dist)

	rec := httptest.NewRecorder()
	srv.handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://puzzle.test/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("static miss = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "EventSource") {
		t.Fatalf("dev 404 page lost the reload client: %q", rec.Body.String())
	}
}

// TestStaticModeFirstBuildFailureServesErrorShell proves D92's first-run shell
// reaches static output too: with nothing built and an error retained, any URL
// answers 503 with the diagnostic.
func TestStaticModeFirstBuildFailureServesErrorShell(t *testing.T) {
	srv := newStaticTestServer(t, t.TempDir())
	want := "app/views/About.pzl:3:1: unexpected token"
	srv.rememberBuildError(want)

	for _, path := range []string{"/", "/about"} {
		rec := httptest.NewRecorder()
		srv.handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://puzzle.test"+path, nil))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("GET %s with a retained error = %d, want 503", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("GET %s did not render the diagnostic: %q", path, rec.Body.String())
		}
	}
}

// TestStaticModeKeepsServingLastGoodPagesOnBuildFailure proves a broken rebuild
// does not blank the site: the previous pages still serve (the build's atomic
// swap left them alone) and the retained error reaches the open page through the
// injected client's SSE replay.
func TestStaticModeKeepsServingLastGoodPagesOnBuildFailure(t *testing.T) {
	srv := newStaticTestServer(t, writeStaticDist(t))
	srv.rememberBuildError("app/views/About.pzl:3:1: unexpected token")

	rec := httptest.NewRecorder()
	srv.handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://puzzle.test/about", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ABOUT") {
		t.Fatalf("broken build stopped serving the last good page: %d %q", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "EventSource") {
		t.Fatalf("last good page lost the reload client, so the error could never reach it")
	}
	// The SSE replay is what draws the overlay on that page.
	body := connectSSE(t, srv)
	if !strings.Contains(body, "event: "+buildErrorEvent) {
		t.Fatalf("SSE replay did not carry the build error: %q", body)
	}
}
