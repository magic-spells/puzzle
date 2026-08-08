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
// its private output or an esbuild rebuild changes the collected <style>; the
// two reloads a single edit produces are coalesced. Production `puzzle build`
// keeps D26's one-shot path.
package dev

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
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
	"github.com/magic-spells/puzzle/compiler/internal/keys"
	"github.com/magic-spells/puzzle/compiler/internal/serve"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// debounceInterval coalesces editor save-bursts (rename+write, multi-file
// formatters) into a single rebuild. 150ms sits in the plan's 100–200ms window.
const debounceInterval = 150 * time.Millisecond

// buildErrorStyle is shared by the client-drawn overlay and the first-build
// fallback shell so SSE connection timing never changes what the error looks
// like (D92).
const buildErrorStyle = "position:fixed;inset:0;z-index:2147483647;background:#111;color:#fff;padding:24px;box-sizing:border-box;overflow:auto;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap"

// reloadScript is injected into served HTML shells (never onto disk). It opens
// an EventSource to the SSE endpoint, reports build failures in-page (D92), and
// full-page reloads on a `reload` event.
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
  var overlay = document.getElementById("__puzzle-build-error");
  function clearError() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
  }
  es.addEventListener("builderror", function (event) {
    try {
      var message = JSON.parse(event.data);
      clearError();
      overlay = document.createElement("div");
      overlay.id = "__puzzle-build-error";
      overlay.style.cssText = "` + buildErrorStyle + `";
      var heading = document.createElement("strong");
      heading.textContent = "Puzzle build error";
      overlay.appendChild(heading);
      overlay.appendChild(document.createTextNode("\n\n" + message));
      document.body.appendChild(overlay);
    } catch (e) {}
  });
  es.addEventListener("clear", clearError);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") clearError();
  });
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

const (
	reloadEvent     = "reload"
	buildErrorEvent = "builderror"
	clearEvent      = "clear"
)

// Options configure Serve.
type Options struct {
	// Port is the TCP port the static/SSE server listens on. A busy port is not
	// fatal: Serve scans upward for the next free one (see portScanLimit) unless
	// StrictPort is set.
	Port int
	// StrictPort, when true, binds Port or fails. Pinned ports exist on purpose
	// — container mappings, OAuth redirect URIs, proxy configs — and silently
	// moving to a neighbour breaks whatever depends on the number.
	StrictPort bool
	// Open, when true, best-effort opens the app in the default browser once
	// the server is listening.
	Open bool
	// Fixtures wires the app's app/fixtures.js (or .ts) through the detachable
	// fixtures/mock runtime module (`--fixtures`, D98). The wrapper entry is
	// generated once, at builder construction, and lives under <root>/.puzzle/ —
	// outside every watched directory, so it cannot feed a rebuild loop.
	Fixtures bool
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

	// Clear out any transient build directories a previous, interrupted run left
	// behind. The static rebuild path reaches this through build.Build, but the
	// SPA path never calls it — and either way a dev session is where a build is
	// most likely to be killed mid-flight, so the sweep belongs at startup.
	build.SweepWorkDirs(absRoot)

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

	cfg, cfgErr := config.LoadConfig(absRoot)
	if cfgErr != nil {
		logWarning(stderr, "%s", configFallbackWarning(cfgErr))
	}
	// Hand the config we just loaded to every build.Build this session runs, so a
	// rebuild does not re-spawn node to re-read a file dev has already decided not
	// to reload (a config edit prints "restart to apply" and nothing else). The
	// builds therefore see exactly the config the rest of the dev loop is using —
	// previously the static rebuild silently picked up mid-session config edits
	// that dev itself was ignoring. A config that FAILED to load is not passed
	// along: dev degrades to the zero Config for its own decisions, but the build
	// keeps its own hard failure on a malformed config file.
	var buildCfg *config.Config
	if cfgErr == nil {
		buildCfg = &cfg
	}

	// Serving mode (D81). `output: 'static'` projects get the REAL static build in
	// dev — prerendered pages, clean URLs, full page loads, per-page mountStatic
	// modules — because that is what ships; serving them through the SPA runtime
	// would make dev a different application from the build. `hybrid` deliberately
	// stays on the SPA dev loop: its shipped runtime IS the SPA bundle after
	// takeover, so the SPA loop already shows what ships (and dev never prerenders
	// for it, so there would be no pages to serve).
	staticMode := cfg.Output == "static"
	serveMode := serve.ModeSPA
	if staticMode {
		serveMode = serve.ModeStatic
		// --fixtures is rejected alongside an output mode (D98); fail here rather
		// than let every rebuild fail with the same message.
		if opts.Fixtures {
			return fmt.Errorf(
				"puzzle dev --fixtures cannot be combined with output: 'static' in %s — prerender + fixtures interplay is not supported",
				config.ConfigFileName,
			)
		}
	}

	srv := newServer(dist, serveMode, ctx, cfg.Dev.Proxy)

	// Reload broadcasts are coalesced (D27): one .pzl edit triggers BOTH an
	// esbuild rebuild AND a Tailwind rescan — two recompositions of styles.css.
	// Debouncing the broadcast within reloadCoalesceDelay collapses those into a
	// single browser reload.
	coalescer := newReloadCoalescer(reloadCoalesceDelay, srv.hub.broadcast)

	// Styles / Tailwind (D27, amending D26). In dev we no longer re-spawn the
	// Tailwind CLI per rebuild. Instead:
	//   - an incremental esbuild api.Context (build.WatchBuilder) rebuilds the JS
	//     bundle reusing caches, and exposes the collected <style>;
	//   - a single `tailwindcss --watch` child (styles.TailwindWatcher) runs for
	//     the whole session, continuously rewriting a PRIVATE output file;
	//   - dist/styles.css is (re)composed from that file + the collected <style>
	//     whenever EITHER side changes.
	// Production `puzzle build` keeps D26's one-shot path. Every fast-path failure
	// degrades gracefully — we never leave dev without CSS updates.
	pl := &pipeline{dist: dist}
	stylesStatus := ""

	// Both serving modes now drive an incremental builder and, when the project
	// declares Tailwind, the warm --watch child: static output gets
	// build.StaticWatchBuilder (persistent esbuild contexts + a staging swap per
	// rebuild) rather than a cold one-shot build per save.
	tailwindEnabled := cfgErr == nil && cfg.TailwindEnabled()

	var builder *build.WatchBuilder
	var staticBuilder *build.StaticWatchBuilder
	if staticMode {
		var builderErr error
		// The Tailwind accessor is installed below (SetTailwind), once the warm
		// child's fate is known. In static mode nothing writes styles.css into the
		// served dist/ directly — the file only ever arrives through an atomic swap
		// alongside the pages it belongs to.
		staticBuilder, builderErr = build.NewStaticWatchBuilder(absRoot, build.StaticWatchOptions{Config: cfg})
		if builderErr != nil {
			// No persistent contexts: degrade to the one-shot build.Build per change
			// (slower, but identical output — including its own Tailwind run).
			logWarning(stderr, "%v (falling back to non-incremental rebuilds)", builderErr)
		} else {
			defer staticBuilder.Dispose()
		}
	} else {
		var builderErr error
		builder, builderErr = build.NewWatchBuilder(absRoot, build.WatchOptions{Fixtures: opts.Fixtures})
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
	}
	// A static rebuild composes styles.css itself, into staging. The pipeline is
	// still the thing that knows where the Tailwind layer comes from (the warm
	// child's output file, or the one-shot fallback when that child is gone), so
	// the builder reads it through the same accessor the SPA path composes from.
	if staticBuilder != nil {
		staticBuilder.SetTailwind(pl.tailwindCSS)
	}
	// The one-shot fallback for static mode runs Tailwind itself; a warm child
	// alongside it would double-compose.
	warmTailwind := tailwindEnabled && (builder != nil || staticBuilder != nil)
	if tailwindEnabled && !warmTailwind {
		stylesStatus = tailwindStatus(resolveTailwindName(absRoot), false)
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

	// stylesChanged is what the Tailwind side calls when the warm child has
	// rewritten its output. The two serving modes answer it differently and the
	// rebuild closure is defined below, so it is a forward-declared hook rather
	// than a direct recompose call:
	//   - SPA mode recomposes dist/styles.css in place (the file is served
	//     straight off disk, so the atomic write is the whole update);
	//   - static mode must NOT touch the served dist/ — styles.css belongs to the
	//     prerendered tree and only ever arrives through a staging swap — so it
	//     asks for a (debounced) rebuild instead.
	var stylesChanged func()

	// Warm Tailwind watcher — only alongside an incremental builder. (In the
	// full-fallback path build.Build already runs Tailwind one-shot, so a warm
	// child would double-compose.)
	if warmTailwind {
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

				// (a) Update styles whenever the child rewrites its output file.
				go pollFile(ctx, twOutput, tailwindPollInterval, func() {
					if stylesChanged != nil {
						stylesChanged()
					}
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
					if stylesChanged != nil {
						stylesChanged()
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
			message := err.Error()
			srv.rememberBuildError(message)
			srv.hub.broadcast(hubMessage{event: buildErrorEvent, payload: message})
			if opts.onRebuild != nil {
				opts.onRebuild(err)
			}
			return
		}
		var err error
		switch {
		case staticBuilder != nil:
			// The real static pipeline, incrementally: persistent esbuild contexts
			// for the app, prerender, and per-page passes, composed into a fresh
			// staging dir that is atomically swapped in. A failed compile OR a failed
			// prerender discards staging, so the last good pages keep serving and the
			// browser gets the diagnostic through the D92 channel below.
			err = staticBuilder.Rebuild(changed)
		case staticMode:
			// No persistent contexts (construction failed): the cold one-shot build,
			// which produces the same output more slowly and runs Tailwind itself.
			err = build.Build(absRoot, build.Options{Development: true, Output: "static", Config: buildCfg})
		case builder != nil:
			if err = builder.ScanUsage(); err == nil {
				err = builder.Rebuild()
			}
			if err == nil {
				err = pl.recompose()
			}
		default:
			err = build.Build(absRoot, build.Options{Development: true, Fixtures: opts.Fixtures, Config: buildCfg})
		}
		if err != nil {
			logBuildFailure(stderr, err)
			message := err.Error()
			srv.rememberBuildError(message)
			srv.hub.broadcast(hubMessage{event: buildErrorEvent, payload: message})
			if opts.onRebuild != nil {
				opts.onRebuild(err)
			}
			return
		}
		if logSuccess {
			logRebuild(stdout, absRoot, changed, time.Since(start))
		}
		// Clear the last failure immediately; only the subsequent reload remains
		// debounced with Tailwind's companion update (D27, D92).
		srv.rememberBuildError("")
		srv.hub.broadcast(hubMessage{event: clearEvent})
		coalescer.request()
		if opts.onRebuild != nil {
			opts.onRebuild(nil)
		}
	}

	// With the rebuild closure in hand, wire the Tailwind hook described above.
	if staticMode {
		// Coalesce: the CLI rewrites its output file several times while a burst of
		// class-name edits settles, and each rewrite would otherwise cost a full
		// static rebuild. This is the same 150ms window the source watcher uses.
		var mu sync.Mutex
		var timer *time.Timer
		stylesChanged = func() {
			mu.Lock()
			defer mu.Unlock()
			if timer == nil {
				timer = time.AfterFunc(debounceInterval, func() { rebuild(nil, false) })
				return
			}
			timer.Reset(debounceInterval)
		}
	} else {
		stylesChanged = func() {
			if err := pl.recompose(); err != nil {
				logWarning(stderr, "recompose styles: %v", err)
				return
			}
			coalescer.request()
		}
	}

	// Initial build: keep serving even if it fails (retry on next change).
	if staticMode {
		logInfo(stdout, "static output — every route prerendered on each rebuild (no router, plain page loads)")
	}
	rebuild(nil, false)

	// Bind synchronously BEFORE the ready banner: a failed bind must surface as a
	// clean error, with no false "ready" line printed and no browser opened on a
	// dead port. A port already in use is not a failure — listenDev scans upward
	// for a free one — but an exhausted scan still lands here.
	ln, err := serve.Listen(opts.Port, opts.StrictPort)
	if err != nil {
		return fmt.Errorf("dev server: %w", err)
	}
	// Everything downstream (banner, browser-open) must report the port actually
	// BOUND, not the one requested: they differ whenever the scan moved on, and
	// `--port 0` never had a real number to begin with.
	port := serve.BoundPort(ln, opts.Port)
	if port != opts.Port && opts.Port != 0 {
		logWarning(stderr, "port %d in use — serving on %d instead", opts.Port, port)
	}

	httpSrv := &http.Server{
		Addr:    ln.Addr().String(),
		Handler: srv.handler(),
	}

	serverErr := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	// Drops bursts that are a metadata-only echo of a rebuild that already ran —
	// the trailing CHTIMES an editor save delivers after a slow rebuild finishes
	// draining events (see changes.go). Genuine successive saves carry different
	// bytes and pass straight through.
	filter := newChangeFilter()

	watchErr := make(chan error, 1)
	go func() {
		watchErr <- runWatcher(ctx, watchDirs, configPath, debounceInterval, func(changed []string) {
			rebuildPaths, configChanged := partitionChanges(changed, configPath)
			rebuildPaths = filter.pending(rebuildPaths)
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
	if restore, ok := keys.StdinCbreak(); ok {
		defer restore()
		quitCh = keys.Listen(ctx, os.Stdin)
	}

	url := fmt.Sprintf("http://localhost:%d/", port)
	outputStatus := ""
	if staticMode {
		outputStatus = "static (prerendered pages, no router)"
	}
	printReady(stdout, url, watchLabel(absRoot, appDir), stylesStatus, outputStatus, time.Since(serveStart), quitCh != nil)
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
	// mode is the serving mode from serve: ModeSPA for a default or hybrid
	// project, ModeStatic for `output: 'static'`. It decides both URL resolution
	// and where the live-reload client is injected — a static site has no shell,
	// so every page it serves carries the client.
	mode     string
	hub      *hub
	proxies  map[string]string
	proxyLog io.Writer
	// Unlike the fan-out hub, this is retained state for clients that connect
	// after a failed build or refresh while it remains broken (D92).
	buildErrorMu sync.Mutex
	lastError    string
	// ctx is cancelled on shutdown; SSE handlers watch it so http.Server.Shutdown
	// does not hang on their long-lived streams (constellation/doc/DOC-BUILD-PLAN.md Phase 3
	// risk: "SSE + http.Server.Shutdown").
	ctx context.Context
}

func newServer(dist, mode string, ctx context.Context, proxies map[string]string) *server {
	return &server{dist: dist, mode: mode, hub: newHub(), proxies: proxies, proxyLog: os.Stderr, ctx: ctx}
}

func (s *server) rememberBuildError(message string) {
	s.buildErrorMu.Lock()
	s.lastError = message
	s.buildErrorMu.Unlock()
}

func (s *server) currentBuildError() string {
	s.buildErrorMu.Lock()
	defer s.buildErrorMu.Unlock()
	return s.lastError
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(reloadPath, s.serveSSE)

	// Proxy patterns must be registered before the static catch-all so matching
	// backend requests never reach the SPA history fallback. ServeMux treats an
	// exact pattern and its subtree form separately, hence both registrations.
	prefixes := make([]string, 0, len(s.proxies))
	for prefix := range s.proxies {
		prefixes = append(prefixes, prefix)
	}
	sort.Strings(prefixes)
	rootProxied := false
	registered := make(map[string]bool, len(prefixes))
	for _, configuredPrefix := range prefixes {
		prefix := strings.TrimRight(configuredPrefix, "/")
		if prefix == "" {
			prefix = "/"
		}
		// config.LoadConfig rejects both a root proxy and two prefixes that
		// normalize to the same route, so neither shape reaches a real dev run. The
		// guards stay because ServeMux PANICS on an empty or already-registered
		// pattern and nothing on the Serve path recovers: a config the loader never
		// saw must not be able to kill the server with a Go stack trace.
		if registered[prefix] {
			continue
		}
		registered[prefix] = true
		proxy := s.reverseProxy(prefix, s.proxies[configuredPrefix])
		mux.Handle(prefix, proxy)
		if prefix == "/" {
			rootProxied = true
			continue
		}
		mux.Handle(prefix+"/", proxy)
	}
	if !rootProxied {
		mux.HandleFunc("/", s.serveStatic)
	}
	return mux
}

func (s *server) reverseProxy(prefix, targetURL string) http.Handler {
	target, _ := url.Parse(targetURL) // validated by config.LoadConfig
	proxy := httputil.NewSingleHostReverseProxy(target)

	// NewSingleHostReverseProxy normally prepends a path carried by the target
	// URL. dev.proxy has no rewrite semantics, so keep the browser's path and
	// query byte-for-byte while still letting the standard director set the
	// backend scheme, host, and forwarding headers.
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		requestPath, requestRawPath, requestQuery := r.URL.Path, r.URL.RawPath, r.URL.RawQuery
		director(r)
		r.URL.Path, r.URL.RawPath, r.URL.RawQuery = requestPath, requestRawPath, requestQuery
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		fmt.Fprintf(s.proxyLog, "proxy %s → %s refused — is the backend running?\n", prefix, targetURL)
		http.Error(w, "puzzle dev: backend unavailable", http.StatusBadGateway)
	}
	return proxy
}

// serveStatic answers a request against dist/ per the serving mode. serve.Resolve
// owns the URL→file mapping (SPA history fallback vs static clean URLs + a real
// 404); this method only decides how the chosen file is written:
//
//   - the root SPA shell goes through serveIndex, which injects the live-reload
//     client and degrades to the D92 build-error page when the file is missing;
//   - an HTML page is written out directly — verbatim in SPA mode (a nested
//     dist/docs/index.html is a real page, not the shell), with the reload client
//     injected in static mode, where every page is a real page and there is no
//     shell to carry the client;
//   - anything else is streamed by http.ServeFile.
//
// http.ServeFile cannot serve the HTML pages: it 301-redirects any
// ".../index.html" request to ".../" (its documented index-page special case).
func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) {
	res := serve.Resolve(s.dist, s.mode, r.URL.Path)
	switch {
	case res.Shell:
		s.serveIndex(w, r)
	case res.File == "":
		// Static-mode miss with no built 404.html.
		s.serveStaticMiss(w)
	case res.HTML:
		s.serveHTMLFile(w, res.File, res.Status)
	default:
		http.ServeFile(w, r, res.File)
	}
}

// serveStaticMiss answers a static-mode URL that resolves to no file. A broken
// build is reported the same way the SPA path reports it (D92); otherwise the
// answer is a real 404 — that is what the host would do — but the reload client
// rides along so the page self-heals once the route exists.
func (s *server) serveStaticMiss(w http.ResponseWriter) {
	if message := s.currentBuildError(); message != "" {
		s.serveBuildErrorShell(w, message)
		return
	}
	page := `<!doctype html>
<html>
<head><meta charset="utf-8"><title>404 — not found</title></head>
<body>
<h1>404</h1>
<p>No page was prerendered for this URL. In static output every URL is a file, so
this is what a static host would answer too.</p>
</body>
</html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write(injectReload([]byte(page)))
}

// serveIndex reads dist/index.html, injects the live-reload client, and writes
// the result. The on-disk file is never modified (keeps dist/ production-clean).
func (s *server) serveIndex(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(filepath.Join(s.dist, "index.html"))
	if err != nil {
		if message := s.currentBuildError(); message != "" {
			s.serveBuildErrorShell(w, message)
			return
		}
		// Keep the no-build-error response byte-for-byte identical: callers that
		// genuinely requested a missing dev path still get the existing 404.
		http.Error(w, "puzzle dev: dist/index.html not found (build may have failed)", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(injectReload(data))
}

// serveBuildErrorShell replaces an otherwise-unhelpful missing-index 404 only
// while a build is known to be broken. The injected client makes the 503 page
// self-heal as soon as the next successful rebuild broadcasts reload (D92).
func (s *server) serveBuildErrorShell(w http.ResponseWriter, message string) {
	page := `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Puzzle build error</title>
</head>
<body>
<div id="__puzzle-build-error" style="` + buildErrorStyle + `"><strong>Puzzle build error</strong>

` + html.EscapeString(message) + `</div>
</body>
</html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = w.Write(injectReload([]byte(page)))
}

// serveHTMLFile writes an on-disk .html file with the given status. In SPA mode
// it is verbatim — a nested dist/docs/index.html is a real page and injecting
// into it would be a surprise. In static mode the live-reload client is injected
// (serve-time only; dist/ on disk stays production-clean), because every static
// page is served this way and none of them would otherwise reach the SSE channel
// that drives reload and the D92 error overlay.
func (s *server) serveHTMLFile(w http.ResponseWriter, path string, status int) {
	data, err := os.ReadFile(path)
	if err != nil {
		if s.mode == serve.ModeStatic {
			s.serveStaticMiss(w)
			return
		}
		http.Error(w, "puzzle dev: file not found", http.StatusNotFound)
		return
	}
	if s.mode == serve.ModeStatic {
		data = injectReload(data)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

// serveSSE streams typed dev events. It registers a client with the hub and
// blocks until either the client disconnects (r.Context) or the server shuts
// down (s.ctx), so shutdown never hangs on the open stream.
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

	// Register before reading retained state: a concurrent build transition must
	// reach this client through either replay or the hub, never fall between them
	// (D92). A duplicate is harmless because the later event self-corrects.
	ch := s.hub.add()
	defer s.hub.remove(ch)

	// Flush headers so the EventSource opens immediately.
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	if message := s.currentBuildError(); message != "" {
		if err := writeSSEFrame(w, hubMessage{event: buildErrorEvent, payload: message}); err != nil {
			return
		}
		flusher.Flush()
	}

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-r.Context().Done():
			return
		case msg := <-ch:
			if err := writeSSEFrame(w, msg); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// writeSSEFrame is shared by retained-state replay and live hub delivery so a
// multi-line compiler diagnostic always uses identical JSON-safe framing (D92).
func writeSSEFrame(w io.Writer, msg hubMessage) error {
	payload, err := json.Marshal(msg.payload)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.event, payload)
	return err
}

// hub is the dev-event broadcaster: a registry of connected SSE clients. Each
// client owns a buffered (size 1) channel; broadcast stays non-blocking, but a
// newer message replaces any stale pending one so the browser sees the latest
// build state (D92).
type hubMessage struct {
	event   string
	payload string
}

type hub struct {
	mu      sync.Mutex
	clients map[chan hubMessage]struct{}
}

func newHub() *hub {
	return &hub{clients: make(map[chan hubMessage]struct{})}
}

func (h *hub) add() chan hubMessage {
	ch := make(chan hubMessage, 1)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *hub) remove(ch chan hubMessage) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
}

func (h *hub) broadcast(msg hubMessage) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- msg:
			default:
			}
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
// rebuild set. Known editor/OS junk files are dropped entirely; a burst
// consisting only of junk schedules no rebuild at all.
func partitionChanges(changed []string, configPath string) (rebuildPaths []string, configChanged bool) {
	for _, p := range changed {
		if configPath != "" && p == configPath {
			configChanged = true
			continue
		}
		if isJunkChange(p) {
			continue
		}
		rebuildPaths = append(rebuildPaths, p)
	}
	return rebuildPaths, configChanged
}

// isJunkChange reports whether a watched path is a file no build could ever
// consume: Finder metadata, or an editor's swap/backup/lock scratch file. Saving
// once in vim produces several of these under app/, and each one used to
// schedule a full rebuild.
//
// This is a DENYLIST of specific known names and patterns, never an allowlist of
// interesting extensions. public/ may contain literally anything — `.htaccess`,
// `_headers`, `_redirects`, `.nojekyll`, `.well-known/*` are all real,
// meaningful inputs — so anything unrecognized must rebuild.
func isJunkChange(path string) bool {
	name := filepath.Base(path)
	switch name {
	case ".DS_Store", "Thumbs.db", "desktop.ini":
		return true
	case "4913":
		// vim writes (and immediately removes) a probe file named 4913 to test
		// whether a directory is writable before saving into it.
		return true
	}
	switch {
	case strings.HasSuffix(name, "~"):
		// vim/emacs/gedit backup copy.
		return true
	case strings.HasPrefix(name, ".#"):
		// emacs lock symlink (.#file.pzl).
		return true
	case strings.HasPrefix(name, "#") && strings.HasSuffix(name, "#"):
		// emacs auto-save (#file.pzl#).
		return true
	case strings.HasSuffix(name, "___jb_tmp___"), strings.HasSuffix(name, "___jb_old___"):
		// JetBrains safe-write scratch files.
		return true
	}
	// vim swap files: file.pzl.swp / .file.pzl.swp and the .swo/.swn/.swx
	// siblings it rolls onto when several are open.
	if ext := filepath.Ext(name); len(ext) == 4 && strings.HasPrefix(ext, ".sw") {
		c := ext[3]
		return c >= 'a' && c <= 'z'
	}
	return false
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
// collected <style> blocks. The Tailwind layer comes from the warm watcher's
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
	// lastWritten is the sha256 of the bytes recompose last put on disk, guarded
	// by writeMu. One .pzl edit reaches recompose TWICE — once from the rebuild
	// and once from the Tailwind output poll a moment later — and in the common
	// case (a template edit with no new utility classes) both compose the same
	// stylesheet. Comparing before writing collapses the pair into a single
	// atomic write + rename against the file the dev server is serving, with no
	// timer to tune and no window in which styles.css is momentarily stale.
	lastWritten [32]byte
	haveWritten bool
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

// recompose writes dist/styles.css = Tailwind layer + collected <style>, unless
// that is byte-for-byte what it already wrote.
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
	sum := sha256.Sum256([]byte(final))
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if p.haveWritten && p.lastWritten == sum {
		return nil
	}
	// Atomic write: the dev server may be serving dist/styles.css concurrently, so
	// an in-place truncate-then-write could hand a client a truncated file.
	if err := fsutil.WriteFileAtomic(filepath.Join(p.dist, "styles.css"), []byte(final), 0o644); err != nil {
		return err
	}
	p.lastWritten, p.haveWritten = sum, true
	return nil
}

// reloadCoalescer debounces reload broadcasts: request() (re)arms a timer that
// fires once the burst settles, so the two recompositions behind a single edit
// yield one reload.
type reloadCoalescer struct {
	delay time.Duration
	fire  func(hubMessage)

	mu    sync.Mutex
	timer *time.Timer
}

func newReloadCoalescer(delay time.Duration, fire func(hubMessage)) *reloadCoalescer {
	return &reloadCoalescer{delay: delay, fire: fire}
}

func (r *reloadCoalescer) request() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.timer == nil {
		r.timer = time.AfterFunc(r.delay, func() {
			r.fire(hubMessage{event: reloadEvent, payload: "1"})
		})
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

func printReady(p *ui.Printer, url, watching, stylesText, outputText string, elapsed time.Duration, showQuitHint bool) {
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
	if outputText != "" {
		printInfoLine(p, "Output:", p.Dim(outputText))
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

// configFallbackWarning is the message printed when puzzle.config.js is present
// but fails to load. Dev keeps serving from the zero Config — a broken config
// must never stop the loop — but that Config drops EVERY key the file would have
// carried, not just styles. dev.proxy is the one that misleads: with no proxy
// registered the SPA history fallback answers /api/* with index.html, so the app
// reports a JSON parse error on "<!doctype html>" with nothing tying it back to
// the config. Both losses are named so cause and effect connect.
//
// LoadConfig returns no error when there is no config file at all, so a
// zero-config app never sees this warning.
func configFallbackWarning(err error) string {
	return fmt.Sprintf(
		"%v — continuing with defaults: no Tailwind pipeline and no dev.proxy (proxied paths will fall through to the SPA shell); fix the config and restart",
		err,
	)
}

// logInfo prints a dimmed status line in the rebuild-line style — used for facts
// about the loop itself (the static-output notice), not for build results.
func logInfo(p *ui.Printer, format string, args ...any) {
	fmt.Fprintf(
		os.Stdout,
		"%s %s %s\n",
		p.Dim(ui.Clock()),
		p.Bold(p.Cyan("[puzzle]")),
		p.Dim(fmt.Sprintf(format, args...)),
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
