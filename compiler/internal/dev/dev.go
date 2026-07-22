// Package dev implements `puzzle dev`: an initial development build, a
// recursive fsnotify watch of the app's source tree, a debounced rebuild loop,
// a static file server for dist/ with history-API fallback, and SSE-based live
// reload. It reworks the Phase 1 prototype watcher (compiler/internal/watcher,
// deleted) per constellation/doc/DOC-BUILD-PLAN.md Phase 3, fixing every sin cataloged
// in constellation/doc/DOC-CODE-REVIEW.md §1.4:
//
//   - notifyReload() was an empty placeholder and the SSE endpoint only pinged;
//     here every successful rebuild broadcasts a real `reload` event.
//   - nothing injected an EventSource client; here index.html gets the client
//     injected at serve time (dist/index.html on disk stays clean for prod).
//   - new subdirectories were never watched; here Create events on directories
//     re-add them to the watcher recursively.
//   - log.Fatal in the server goroutine and select{} for lifetime; here the
//     server error returns through a channel and shutdown is graceful
//     (SIGINT/SIGTERM → http.Server.Shutdown, SSE handlers released via context).
//
// Styles/rebuild speed (D27, amending D26): dev drives an incremental esbuild
// api.Context (build.WatchBuilder) and a single long-lived `tailwindcss --watch`
// child (styles.TailwindWatcher) instead of a cold full build + one-shot Tailwind
// per change. dist/styles.css is recomposed whenever either the watcher rewrites
// its private output or an esbuild rebuild changes the collected <styles>; the
// two reloads a single edit produces are coalesced. Production `puzzle build`
// keeps D26's one-shot path.
package dev

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// debounceInterval coalesces editor save-bursts (rename+write, multi-file
// formatters) into a single rebuild. 150ms sits in the plan's 100–200ms window.
const debounceInterval = 150 * time.Millisecond

// reloadScript is injected into served index.html (never onto disk). It opens
// an EventSource to the SSE endpoint and full-page reloads on a `reload` event.
//
// Before reloading it asks the running app to snapshot its state to
// sessionStorage (constellation/doc/DOC-SPEC.md §27, D57): the dev-published
// window.__PUZZLE_APP__.__devSnapshot() writes a one-shot blob the freshly
// booted app restores at the end of mount(), so an edit mid-flow keeps store
// contents, view state, and route. The snapshot is best-effort — the reload
// ALWAYS happens even if it throws (a production bundle has no __devSnapshot).
const reloadScript = `<script>
(function () {
  var es = new EventSource("/__puzzle/reload");
  es.addEventListener("reload", function () {
    try {
      var a = window.__PUZZLE_APP__;
      if (a && a.__devSnapshot) a.__devSnapshot();
    } catch (e) {}
    location.reload();
  });
})();
</script>`

// reloadPath is the SSE endpoint the injected client subscribes to.
const reloadPath = "/__puzzle/reload"

// Options configure Serve.
type Options struct {
	// Port is the TCP port the static/SSE server listens on.
	Port int
	// Open, when true, best-effort opens the app in the default browser once
	// the server is listening.
	Open bool
	// OnReady, when set, runs after the server's ready banner is printed.
	OnReady func()

	// onRebuild, when set, is called after every rebuild (initial and each
	// watch-triggered one) with the build error (nil on success). Test hook;
	// unexported so it is not part of the public API.
	onRebuild func(error)
}

// Serve runs the dev loop for the app rooted at root (the directory holding
// app/app.js). It performs an initial development build, serves root/dist,
// watches root/app, and blocks until SIGINT/SIGTERM or a fatal server error.
//
// A failing build — at startup or on any change — is printed (with esbuild's
// positioned diagnostics) but never terminates the process: whatever dist/
// already holds keeps being served and the next change retries.
func Serve(root string, opts Options) error {
	serveStart := time.Now()
	stdout := ui.New(os.Stdout)
	stderr := ui.New(os.Stderr)

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolving app root: %w", err)
	}
	dist := filepath.Join(absRoot, "dist")
	appDir := filepath.Join(absRoot, "app")

	// Recursive watch roots: app/ always, plus a root-level public/ fallback when
	// it resolves OUTSIDE app/ (app/public is already inside appDir, so it never
	// needs a second watcher). Using build.PublicDir keeps the watched dir in
	// lockstep with the dir the copier actually reads.
	watchDirs := []string{appDir}
	if pub := build.PublicDir(absRoot); pub != "" && !withinDir(appDir, pub) {
		watchDirs = append(watchDirs, pub)
	}
	// puzzle.config.js is watched too, but NOT to rebuild: the config is loaded
	// once at startup, so a mid-session edit only prints a "restart to apply"
	// advisory (see partitionChanges + the onChange handler below).
	configPath := filepath.Join(absRoot, "puzzle.config.js")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := newServer(dist, ctx)

	// Reload broadcasts are coalesced (D27): one .pzl edit triggers BOTH an
	// esbuild rebuild AND a Tailwind rescan — two recompositions of styles.css.
	// Debouncing the broadcast within reloadCoalesceDelay collapses those into a
	// single browser reload.
	coalescer := newReloadCoalescer(reloadCoalesceDelay, srv.hub.broadcast)

	// Styles / Tailwind (D27, amending D26). In dev we no longer re-spawn the
	// Tailwind CLI per rebuild. Instead:
	//   - an incremental esbuild api.Context (build.WatchBuilder) rebuilds the JS
	//     bundle reusing caches, and exposes the collected <styles>;
	//   - a single `tailwindcss --watch` child (styles.TailwindWatcher) runs for
	//     the whole session, continuously rewriting a PRIVATE output file;
	//   - dist/styles.css is (re)composed from that file + the collected <styles>
	//     whenever EITHER side changes.
	// Production `puzzle build` keeps D26's one-shot path. Every fast-path failure
	// degrades gracefully — we never leave dev without CSS updates.
	pl := &pipeline{dist: dist}
	stylesStatus := ""

	cfg, cfgErr := config.LoadConfig(absRoot)
	if cfgErr != nil {
		logWarning(stderr, "%v (styles: continuing without the Tailwind pipeline)", cfgErr)
	}
	tailwindEnabled := cfgErr == nil && cfg.TailwindEnabled()

	builder, builderErr := build.NewWatchBuilder(absRoot)
	if builderErr != nil {
		// No incremental context: degrade fully to the non-incremental one-shot
		// build.Build per change (slower, but correct — including its own Tailwind).
		logWarning(stderr, "%v (falling back to non-incremental rebuilds)", builderErr)
		if tailwindEnabled {
			stylesStatus = tailwindStatus(resolveTailwindName(absRoot), false)
		}
	} else {
		defer builder.Dispose()
		pl.collectedCSS = builder.CSS
	}

	// The warm Tailwind watcher's child process must be reaped on EVERY exit
	// path. StartWatch's ctx-cancel goroutine handles the graceful shutdown, but
	// on a fatal server error Serve returns and main os.Exit(1)s before that async
	// goroutine can run — orphaning the child. A synchronous defer here guarantees
	// the kill (Stop is sync.Once-guarded, so the goroutine also firing is a no-op).
	var tw *styles.TailwindWatcher
	defer func() {
		if tw != nil {
			tw.Stop()
		}
	}()

	// Warm Tailwind watcher — only alongside the incremental builder. (In the
	// full-fallback path build.Build already runs Tailwind one-shot, so a warm
	// child would double-compose.)
	if tailwindEnabled && builder != nil {
		tmp, err := os.CreateTemp("", "puzzle-tailwind-dev-*.css")
		if err != nil {
			logWarning(stderr, "could not create Tailwind output file: %v (styles: one-shot per rebuild)", err)
			stylesStatus = tailwindStatus(resolveTailwindName(absRoot), false)
			pl.enableOneShot(absRoot)
		} else {
			twOutput := tmp.Name()
			tmp.Close()
			defer os.Remove(twOutput) // private file: cleaned up on shutdown, never served
			tailwindErr := newTailwindStderr(stderr)

			w, werr := styles.StartWatch(ctx, styles.WatchOptions{
				AppRoot: absRoot,
				Input:   styles.DefaultInput(absRoot),
				Output:  twOutput,
				Stderr:  tailwindErr,
			})
			if werr != nil {
				tailwindErr.Close()
				logWarning(stderr, "%v (styles: one-shot Tailwind per rebuild)", werr)
				os.Remove(twOutput)
				stylesStatus = tailwindStatus(resolveTailwindName(absRoot), false)
				pl.enableOneShot(absRoot)
			} else {
				tw = w // reachable at Serve scope so the deferred Stop can reap it
				pl.twOutputPath = twOutput
				stylesStatus = tailwindStatus(w.Name, true)

				// (a) Recompose whenever the child rewrites its output file.
				go pollFile(ctx, twOutput, tailwindPollInterval, func() {
					if err := pl.recompose(); err != nil {
						logWarning(stderr, "recompose styles: %v", err)
						return
					}
					coalescer.request()
				})

				// If the child dies unexpectedly, fall back to one-shot so CSS keeps
				// updating rather than silently freezing.
				go func() {
					<-w.Done()
					tailwindErr.Close()
					select {
					case <-ctx.Done():
						return // dying because we're shutting down: expected.
					default:
					}
					logWarning(stderr, "tailwind --watch exited (%v); falling back to one-shot rebuilds", w.Err())
					pl.enableOneShot(absRoot)
					if err := pl.recompose(); err == nil {
						coalescer.request()
					}
				}()
			}
		}
	}

	// rebuild runs a development build and, on success, tells every connected
	// browser to reload. It swallows the error (after printing) so neither the
	// initial build nor a later one can kill the loop. The rebuild duration
	// reflects the esbuild pass + styles composition only — Tailwind runs in its
	// own warm child, off this path (D27).
	rebuild := func(changed []string, logSuccess bool) {
		start := time.Now()
		// Revalidate the public tree every rebuild: adding a file that collides
		// with a reserved output (app.js/app.js.map/styles.css) while the server
		// runs must surface as a visible build error, not a silent clobber.
		if err := build.ValidatePublic(absRoot); err != nil {
			logBuildFailure(stderr, err)
			if opts.onRebuild != nil {
				opts.onRebuild(err)
			}
			return
		}
		var err error
		if builder != nil {
			if err = builder.ScanFormatters(); err == nil {
				err = builder.Rebuild()
			}
			if err == nil {
				err = pl.recompose()
			}
		} else {
			err = build.Build(absRoot, build.Options{Development: true})
		}
		if err != nil {
			logBuildFailure(stderr, err)
			if opts.onRebuild != nil {
				opts.onRebuild(err)
			}
			return
		}
		if logSuccess {
			logRebuild(stdout, absRoot, changed, time.Since(start))
		}
		coalescer.request()
		if opts.onRebuild != nil {
			opts.onRebuild(nil)
		}
	}

	// Initial build: keep serving even if it fails (retry on next change).
	rebuild(nil, false)

	// Bind loopback only: the dev server (and its live-reload SSE endpoint) is a
	// local convenience, not a LAN service. The banner prints localhost, so the
	// bind must match. No host config option in v1.
	addr := fmt.Sprintf("127.0.0.1:%d", opts.Port)
	httpSrv := &http.Server{
		Addr:    addr,
		Handler: srv.handler(),
	}

	// Bind synchronously BEFORE the ready banner: a failed bind (port already in
	// use) must surface as a clean error, with no false "ready" line printed and
	// no browser opened on a dead port.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("dev server: %w", err)
	}

	serverErr := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	watchErr := make(chan error, 1)
	go func() {
		watchErr <- runWatcher(ctx, watchDirs, configPath, debounceInterval, func(changed []string) {
			rebuildPaths, configChanged := partitionChanges(changed, configPath)
			if len(rebuildPaths) > 0 {
				rebuild(rebuildPaths, true)
			}
			if configChanged {
				// The config is read once at startup; a live edit needs a restart.
				logWarning(stderr, "puzzle.config.js changed — restart 'puzzle dev' to apply")
			}
		})
	}()

	// "press q to quit": put stdin into cbreak so a single 'q' keypress can end
	// the loop, but only when stdin is a real TTY (skipped on pipes/CI/Windows).
	// This must run BEFORE printReady so the banner only advertises the hint when
	// the listener is actually active. The deferred restore runs after
	// httpSrv.Shutdown (defers unwind at Serve's return).
	var quitCh <-chan struct{}
	if restore, ok := stdinCbreak(); ok {
		defer restore()
		quitCh = listenKeys(ctx, os.Stdin)
	}

	url := fmt.Sprintf("http://localhost:%d/", opts.Port)
	printReady(stdout, url, watchLabel(absRoot, appDir), stylesStatus, time.Since(serveStart), quitCh != nil)
	if opts.OnReady != nil {
		opts.OnReady()
	}
	if opts.Open {
		openBrowser(url)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	// A nil quitCh blocks forever in select, so `case <-quitCh:` is safe even
	// when the key listener never started.
	select {
	case <-sigCh:
		// Leading "\n" moves past the terminal's echoed "^C".
		logShutdown(stdout, true)
	case <-quitCh:
		// ECHO is off in cbreak mode, so the typed 'q' printed nothing — no
		// leading newline needed here.
		logShutdown(stdout, false)
	case err := <-serverErr:
		return fmt.Errorf("dev server: %w", err)
	case err := <-watchErr:
		if err != nil {
			return fmt.Errorf("watcher: %w", err)
		}
	}

	// Cancel first so SSE handlers return and the watcher goroutine exits, then
	// let http.Server.Shutdown drain the (now idle) connections without hanging.
	cancel()
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	return httpSrv.Shutdown(shutdownCtx)
}

// server holds the static-server + SSE state. It is constructed by newServer so
// its handler can be driven directly by httptest without a real listener,
// watcher, or build.
type server struct {
	dist string
	hub  *hub
	// ctx is cancelled on shutdown; SSE handlers watch it so http.Server.Shutdown
	// does not hang on their long-lived streams (constellation/doc/DOC-BUILD-PLAN.md Phase 3
	// risk: "SSE + http.Server.Shutdown").
	ctx context.Context
}

func newServer(dist string, ctx context.Context) *server {
	return &server{dist: dist, hub: newHub(), ctx: ctx}
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(reloadPath, s.serveSSE)
	mux.HandleFunc("/", s.serveStatic)
	return mux
}

// serveStatic serves an existing regular file under dist verbatim; any other
// path (unknown route, extension-less path, missing file) falls back to a
// freshly-injected index.html so the SPA router owns client-side routes.
func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) {
	clean := path.Clean(r.URL.Path)
	if clean == "/" || clean == "." {
		s.serveIndex(w, r)
		return
	}

	candidate := filepath.Join(s.dist, filepath.FromSlash(strings.TrimPrefix(clean, "/")))
	if !withinDir(s.dist, candidate) {
		s.serveIndex(w, r)
		return
	}
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		// Defense in depth: withinDir above is lexical, so a symlink under dist
		// pointing outside it still passes that check and http.ServeFile would
		// follow it. Resolve the real path and re-check before serving.
		if !withinDirResolved(s.dist, candidate) {
			s.serveIndex(w, r)
			return
		}
		// The ROOT index.html is the SPA shell: read dist/index.html and inject the
		// live-reload client. Requesting it directly ("/index.html") is equivalent
		// to "/". A NESTED index.html (dist/docs/index.html) is a real page and is
		// NOT the shell — serving the injected root shell there would shadow it.
		if candidate == filepath.Join(s.dist, "index.html") {
			s.serveIndex(w, r)
			return
		}
		// Serve a nested index.html verbatim (no injection). http.ServeFile can't
		// be used: it 301-redirects any ".../index.html" request to ".../" (its
		// documented index-page special case), which then resolves to a directory
		// and falls through to the root shell — the exact shadowing we are fixing.
		if filepath.Base(candidate) == "index.html" {
			s.serveRawHTML(w, candidate)
			return
		}
		http.ServeFile(w, r, candidate)
		return
	}

	// History-API fallback: non-file paths render the SPA shell.
	s.serveIndex(w, r)
}

// serveIndex reads dist/index.html, injects the live-reload client, and writes
// the result. The on-disk file is never modified (keeps dist/ production-clean).
func (s *server) serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(filepath.Join(s.dist, "index.html"))
	if err != nil {
		http.Error(w, "puzzle dev: dist/index.html not found (build may have failed)", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(injectReload(data))
}

// serveRawHTML writes an on-disk .html file verbatim, with NO live-reload
// injection. It exists for NESTED index.html files: http.ServeFile would
// 301-redirect any ".../index.html" request to ".../" (its "/index.html" → "./"
// special case), which resolves to a directory and falls through to the root SPA
// shell — so those files must be written out directly instead.
func (s *server) serveRawHTML(w http.ResponseWriter, path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "puzzle dev: file not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// serveSSE streams reload events. It registers a client with the hub and blocks
// until either the client disconnects (r.Context) or the server shuts down
// (s.ctx), so shutdown never hangs on the open stream.
func (s *server) serveSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	// Flush headers so the EventSource opens immediately.
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ch := s.hub.add()
	defer s.hub.remove(ch)

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-r.Context().Done():
			return
		case <-ch:
			fmt.Fprint(w, "event: reload\ndata: 1\n\n")
			flusher.Flush()
		}
	}
}

// hub is the reload broadcaster: a registry of connected SSE clients. Each
// client owns a buffered (size 1) channel; broadcast does a non-blocking send
// so a slow client is coalesced rather than blocking the rebuild.
type hub struct {
	mu      sync.Mutex
	clients map[chan struct{}]struct{}
}

func newHub() *hub {
	return &hub{clients: make(map[chan struct{}]struct{})}
}

func (h *hub) add() chan struct{} {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *hub) remove(ch chan struct{}) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
}

func (h *hub) broadcast() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- struct{}{}:
		default: // a reload is already pending for this client; coalesce.
		}
	}
}

func (h *hub) clientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// runWatcher watches every dir in dirs recursively, plus the single configPath
// (via its parent directory, non-recursively), and calls onChange once per
// debounced burst of filesystem events, until ctx is cancelled. File events
// collected during the burst are passed as sorted absolute paths. Only paths
// that fall inside a recursive root OR equal configPath are surfaced — sibling
// root-level noise (package.json, dotfiles, the dist/ tree) is dropped, so an
// unrelated edit never triggers a rebuild. Directories created after startup are
// added to the watch on their Create event, but only when they fall within a
// recursive root — fsnotify does not recurse on its own, and the root's
// non-recursive config watch must not pull the whole project tree in
// (constellation/doc/DOC-BUILD-PLAN.md Phase 3 risk / CODE_REVIEW §1.4).
// configPath may be "" to disable the config watch entirely.
func runWatcher(ctx context.Context, dirs []string, configPath string, debounce time.Duration, onChange func(changed []string)) error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()

	for _, d := range dirs {
		if err := addTree(w, d); err != nil {
			return err
		}
	}
	if configPath != "" {
		// Watch the config file's directory (the project root) NON-recursively so
		// edits and atomic saves to puzzle.config.js surface; sibling subtrees
		// (dist/, node_modules/) are not pulled in. Non-fatal on failure — the
		// worst case is no "restart to apply" hint.
		if err := w.Add(filepath.Dir(configPath)); err != nil {
			logWarning(ui.New(os.Stderr), "watch config dir: %v", err)
		}
	}

	// A stopped timer we Reset on each event; it fires once the burst settles.
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	changed := make(map[string]struct{})

	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-w.Events:
			if !ok {
				return nil
			}
			// Watch newly-created subdirectories so their contents are seen too —
			// but only under a recursive root, never a bare root-level dir reached
			// via the config watch (that would recursively watch dist/, etc.).
			if event.Op&fsnotify.Create != 0 && withinAnyDir(dirs, event.Name) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					_ = addTree(w, event.Name)
				}
			}
			// Any op is a change worth rebuilding on — Chmod included, since a
			// bare `touch` (and some editors' atomic saves) surface only as an
			// attribute change. The debounce coalesces the resulting bursts. Drop
			// events outside every recursive root that are not the config file:
			// they are root-level noise the config watch also delivers.
			if event.Op != 0 && (withinAnyDir(dirs, event.Name) || event.Name == configPath) {
				if !eventIsDir(event.Name) {
					changed[event.Name] = struct{}{}
				}
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(debounce)
			}
		case err, ok := <-w.Errors:
			if !ok {
				return nil
			}
			logWarning(ui.New(os.Stderr), "watch error: %v", err)
		case <-timer.C:
			paths := make([]string, 0, len(changed))
			for p := range changed {
				paths = append(paths, p)
			}
			sort.Strings(paths)
			changed = make(map[string]struct{})
			onChange(paths)
		}
	}
}

func eventIsDir(name string) bool {
	info, err := os.Stat(name)
	return err == nil && info.IsDir()
}

// addTree adds dir and every directory beneath it to the watcher.
func addTree(w *fsnotify.Watcher, dir string) error {
	return filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return w.Add(p)
		}
		return nil
	})
}

// injectReload inserts the live-reload client before the last </body> (or
// appends it when there is no body tag).
func injectReload(html []byte) []byte {
	s := string(html)
	if i := strings.LastIndex(strings.ToLower(s), "</body>"); i >= 0 {
		return []byte(s[:i] + reloadScript + "\n" + s[i:])
	}
	return append(html, []byte("\n"+reloadScript+"\n")...)
}

// withinDir reports whether target resolves inside dir (path-traversal guard).
// It is purely lexical — see withinDirResolved for the symlink-aware backstop.
func withinDir(dir, target string) bool {
	rel, err := filepath.Rel(dir, target)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// withinAnyDir reports whether target lies inside any of dirs.
func withinAnyDir(dirs []string, target string) bool {
	for _, d := range dirs {
		if withinDir(d, target) {
			return true
		}
	}
	return false
}

// partitionChanges splits a debounced change burst into the paths that warrant a
// rebuild and whether puzzle.config.js itself changed. A config change does NOT
// rebuild — the config is loaded once at startup — so it is reported separately
// (the dev loop prints a "restart to apply" advisory) and kept out of the
// rebuild set.
func partitionChanges(changed []string, configPath string) (rebuildPaths []string, configChanged bool) {
	for _, p := range changed {
		if configPath != "" && p == configPath {
			configChanged = true
			continue
		}
		rebuildPaths = append(rebuildPaths, p)
	}
	return rebuildPaths, configChanged
}

// withinDirResolved reports whether target, after symlink resolution, is inside
// dir (also symlink-resolved). It backstops the lexical withinDir: a symlink
// under dist pointing outside passes that check, but http.ServeFile would follow
// it. Resolving dir too normalizes a symlinked prefix (e.g. macOS /tmp →
// /private/tmp) so a legitimate in-root file is not wrongly rejected. A
// resolution error (e.g. the path vanished) is treated as outside — fail closed.
func withinDirResolved(dir, target string) bool {
	realDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return false
	}
	realTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		return false
	}
	return withinDir(realDir, realTarget)
}

// reloadCoalesceDelay collapses the double reload (esbuild rebuild + Tailwind
// rescan) that a single .pzl edit produces into one broadcast (D27).
const reloadCoalesceDelay = 100 * time.Millisecond

// tailwindPollInterval is how often the dev loop checks the warm watcher's
// private output file for a rewrite. A single-file mtime poll is the simplest
// reliable trigger — fsnotify on one file is fragile across atomic replaces.
const tailwindPollInterval = 150 * time.Millisecond

// pipeline (re)composes dist/styles.css from the Tailwind layer and the
// collected <styles> blocks. The Tailwind layer comes from the warm watcher's
// private output file; if that path is unavailable (watcher failed to start or
// died) it falls back to running the CLI one-shot, so styles never silently
// freeze (D27). Composition may be invoked concurrently (rebuild, the output
// poll, the death fallback); writeMu serializes the file write.
type pipeline struct {
	dist         string
	twOutputPath string        // private Tailwind output file; "" when no warm watcher
	collectedCSS func() string // WatchBuilder.CSS; nil only in the full-fallback path

	mu      sync.Mutex
	oneShot func() (string, error) // set when the warm watcher is unavailable/dead
	writeMu sync.Mutex
}

// enableOneShot switches the pipeline to run the Tailwind CLI once per
// composition (the D26 path) — used when the warm watcher can't be started or
// has died.
func (p *pipeline) enableOneShot(appRoot string) {
	input := styles.DefaultInput(appRoot)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.oneShot = func() (string, error) {
		return styles.NpxRunner{}.Run(styles.RunOptions{AppRoot: appRoot, Input: input, Production: false})
	}
}

// tailwindCSS returns the current Tailwind layer: the one-shot output when in
// fallback mode, else the warm watcher's private file (empty until it first
// writes), else "" when Tailwind is not enabled.
func (p *pipeline) tailwindCSS() (string, error) {
	p.mu.Lock()
	oneShot := p.oneShot
	p.mu.Unlock()
	if oneShot != nil {
		return oneShot()
	}
	if p.twOutputPath == "" {
		return "", nil
	}
	data, err := os.ReadFile(p.twOutputPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // not generated yet; the poll recomposes once it lands.
		}
		return "", err
	}
	return string(data), nil
}

// recompose writes dist/styles.css = Tailwind layer + collected <styles>.
func (p *pipeline) recompose() error {
	tw, err := p.tailwindCSS()
	if err != nil {
		return fmt.Errorf("tailwind styles: %w", err)
	}
	var collected string
	if p.collectedCSS != nil {
		collected = p.collectedCSS()
	}
	final := styles.Compose(tw, collected)
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	// Atomic write: the dev server may be serving dist/styles.css concurrently, so
	// an in-place truncate-then-write could hand a client a truncated file.
	return fsutil.WriteFileAtomic(filepath.Join(p.dist, "styles.css"), []byte(final), 0o644)
}

// reloadCoalescer debounces reload broadcasts: request() (re)arms a timer that
// fires once the burst settles, so the two recompositions behind a single edit
// yield one reload.
type reloadCoalescer struct {
	delay time.Duration
	fire  func()

	mu    sync.Mutex
	timer *time.Timer
}

func newReloadCoalescer(delay time.Duration, fire func()) *reloadCoalescer {
	return &reloadCoalescer{delay: delay, fire: fire}
}

func (r *reloadCoalescer) request() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.timer == nil {
		r.timer = time.AfterFunc(r.delay, r.fire)
		return
	}
	r.timer.Reset(r.delay)
}

// pollFile calls onChange whenever path's mtime or size changes, until ctx is
// done. It seeds from the file's state at start so the pre-existing (empty) temp
// file is not itself treated as a change — only the watcher's real writes fire.
func pollFile(ctx context.Context, path string, interval time.Duration, onChange func()) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var lastMod time.Time
	var lastSize int64
	if info, err := os.Stat(path); err == nil {
		lastMod, lastSize = info.ModTime(), info.Size()
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			info, err := os.Stat(path)
			if err != nil {
				continue
			}
			if mt, sz := info.ModTime(), info.Size(); !mt.Equal(lastMod) || sz != lastSize {
				lastMod, lastSize = mt, sz
				onChange()
			}
		}
	}
}

func printReady(p *ui.Printer, url, watching, stylesText string, elapsed time.Duration, showQuitHint bool) {
	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(
		os.Stdout,
		"  %s %s  ready in %s\n\n",
		p.Bold(p.Magenta("⬢ Puzzle")),
		p.Dim("v"+version.Version),
		p.Bold(formatReadyMillis(elapsed)),
	)
	printInfoLine(p, "Local:", p.Cyan(url))
	printInfoLine(p, "Watching:", p.Dim(watching))
	if stylesText != "" {
		printInfoLine(p, "Styles:", p.Dim(stylesText))
	}
	// Only advertise 'q' when the key listener is actually active (a real TTY).
	if showQuitHint {
		fmt.Fprintf(os.Stdout, "\n  %s\n", p.Dim("press q to quit"))
	}
	fmt.Fprintln(os.Stdout)
}

// logShutdown prints the "shutting down…" line. leadingNewline is true for the
// signal path (moves past the terminal's echoed "^C") and false for the 'q'
// path (nothing was echoed in cbreak mode).
func logShutdown(p *ui.Printer, leadingNewline bool) {
	prefix := ""
	if leadingNewline {
		prefix = "\n"
	}
	fmt.Fprintf(os.Stdout, "%s%s %s %s\n", prefix, p.Dim(ui.Clock()), p.Bold(p.Cyan("[puzzle]")), p.Dim("shutting down…"))
}

func printInfoLine(p *ui.Printer, label, value string) {
	spacing := 11 - len(label)
	if spacing < 1 {
		spacing = 1
	}
	fmt.Fprintf(os.Stdout, "  %s  %s%s%s\n", p.Green("➜"), p.Bold(label), strings.Repeat(" ", spacing), value)
}

func logRebuild(p *ui.Printer, root string, changed []string, elapsed time.Duration) {
	msg := p.Green("rebuilt in " + formatCompactMillis(elapsed))
	if summary := changedSummary(root, changed); summary != "" {
		msg += "  " + p.Dim(summary)
	}
	fmt.Fprintf(os.Stdout, "%s %s %s\n", p.Dim(ui.Clock()), p.Bold(p.Cyan("[puzzle]")), msg)
}

func logBuildFailure(p *ui.Printer, err error) {
	fmt.Fprintf(
		os.Stderr,
		"%s %s %s\n%v\n",
		p.Dim(ui.Clock()),
		p.Bold(p.Cyan("[puzzle]")),
		p.Bold(p.Red("✘ build failed")),
		err,
	)
}

func logWarning(p *ui.Printer, format string, args ...any) {
	fmt.Fprintf(
		os.Stderr,
		"%s %s %s\n",
		p.Dim(ui.Clock()),
		p.Bold(p.Cyan("[puzzle]")),
		p.Yellow(fmt.Sprintf(format, args...)),
	)
}

func newTailwindStderr(p *ui.Printer) io.WriteCloser {
	return ui.NewLineWriter(os.Stderr, func(line string) (string, bool) {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" ||
			strings.HasPrefix(trimmed, "≈ tailwindcss") ||
			strings.HasPrefix(trimmed, "Done in") ||
			strings.HasPrefix(trimmed, "Rebuilding") {
			return "", false
		}
		return fmt.Sprintf("%s %s %s", p.Dim(ui.Clock()), p.Bold(p.Yellow("[tailwind]")), strings.TrimRight(line, "\r")), true
	})
}

func watchLabel(root, appDir string) string {
	rel, err := filepath.Rel(root, appDir)
	if err != nil || rel == "." {
		rel = filepath.Base(appDir)
	}
	rel = filepath.ToSlash(rel)
	if !strings.HasSuffix(rel, "/") {
		rel += "/"
	}
	return rel
}

func changedSummary(root string, changed []string) string {
	if len(changed) == 0 {
		return ""
	}
	if len(changed) >= 3 {
		return fmt.Sprintf("%d files changed", len(changed))
	}
	rel := make([]string, 0, len(changed))
	for _, name := range changed {
		p, err := filepath.Rel(root, name)
		if err != nil {
			p = name
		}
		rel = append(rel, filepath.ToSlash(p))
	}
	return strings.Join(rel, ", ")
}

func resolveTailwindName(root string) string {
	if cli, ok := styles.ResolveCLI(root); ok {
		return cli.Name
	}
	return "Tailwind"
}

func tailwindStatus(name string, watch bool) string {
	base := name
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "tailwind v4"):
		base = "Tailwind v4"
	case strings.Contains(lower, "tailwind v3"):
		base = "Tailwind v3"
	}
	if watch {
		if base == name {
			return name
		}
		return base + " --watch"
	}
	return base + " (one-shot per rebuild)"
}

func formatReadyMillis(d time.Duration) string {
	return fmt.Sprintf("%d ms", d.Round(time.Millisecond).Milliseconds())
}

func formatCompactMillis(d time.Duration) string {
	return fmt.Sprintf("%dms", d.Round(time.Millisecond).Milliseconds())
}

// openBrowser best-effort launches url in the default browser. Failures are
// silent — opening a browser is a convenience, never required.
func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler"}
	default:
		cmd = "xdg-open"
	}
	_ = exec.Command(cmd, append(args, url)...).Start()
}
