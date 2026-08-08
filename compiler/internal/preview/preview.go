// Package preview implements `puzzle preview`: a local server for an ALREADY
// BUILT dist/, behaving the way the host that will serve it behaves. There is no
// watcher, no rebuild, no live-reload injection and no dev.proxy — the output is
// served exactly as it sits on disk, because the point of the command is to check
// the artifact rather than the source.
//
// What "the way a host behaves" means is decided by the resolved output mode from
// puzzle.config.js (D81), and that resolution lives in internal/serve so `puzzle
// dev` answers static URLs identically:
//
//   - SPA: history-API fallback — anything that is not a file is index.html.
//   - hybrid: the route's prerendered page when one was written, index.html
//     otherwise (the router owns the rest).
//   - static: clean URLs and a real 404 on a miss. No index.html fallback: a
//     static host has no router to fall back to, and a preview that quietly
//     served the home page for a missing route would hide exactly the bug this
//     command exists to catch.
package preview

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/keys"
	"github.com/magic-spells/puzzle/compiler/internal/serve"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// Options configure Serve.
type Options struct {
	// Port is the TCP port to listen on. A busy port is not fatal: the D90 scan
	// takes the next free one unless StrictPort is set.
	Port int
	// StrictPort binds Port or fails, for the same reasons `puzzle dev` has it —
	// container mappings and redirect URIs pin a number on purpose.
	StrictPort bool
	// OnReady runs after the ready banner is printed (test/CLI hook).
	OnReady func()
}

// Serve serves root/dist for the app rooted at root and blocks until
// SIGINT/SIGTERM.
func Serve(root string, opts Options) error {
	start := time.Now()
	stdout := ui.New(os.Stdout)
	stderr := ui.New(os.Stderr)

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolving app root: %w", err)
	}
	dist := filepath.Join(absRoot, "dist")

	// A config that will not load is fatal here, unlike in dev: the ONLY thing
	// this command decides is how to resolve URLs, and it decides it from the
	// config. Falling back to the zero Config would silently preview a static site
	// with SPA semantics — the exact mismatch preview exists to expose.
	cfg, err := config.LoadConfig(absRoot)
	if err != nil {
		return err
	}
	mode := cfg.Output

	if err := checkDist(dist); err != nil {
		return err
	}

	// The prerender modes stamp their own marker into the page they emit, so the
	// build says what it is. Config silent (the `--hybrid` / `--static` FLAG was
	// used) → believe the artifact, and say so. Config set → the config is the
	// request and wins, but a disagreement means dist/ predates it, which is worth
	// naming before the user chases a phantom routing bug.
	if built := builtMode(dist); built != "" {
		switch {
		case mode == "":
			mode = built
			logInfo(stdout, "dist/ was built with output %q (no output key in %s) — previewing it that way", built, config.ConfigFileName)
		case mode != built:
			logWarning(stderr, "%s says output: '%s' but dist/ was built as '%s' — serving as '%s'; rerun `puzzle build`",
				config.ConfigFileName, mode, built, mode)
		}
	}
	if warning := shapeWarning(dist, mode); warning != "" {
		logWarning(stderr, "%s", warning)
	}

	ln, err := serve.Listen(opts.Port, opts.StrictPort)
	if err != nil {
		return fmt.Errorf("preview server: %w", err)
	}
	port := serve.BoundPort(ln, opts.Port)
	if port != opts.Port && opts.Port != 0 {
		logWarning(stderr, "port %d in use — serving on %d instead", opts.Port, port)
	}

	httpSrv := &http.Server{Addr: ln.Addr().String(), Handler: Handler(dist, mode)}
	serverErr := make(chan error, 1)
	go func() {
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	// "press q to quit": put stdin into cbreak so a single 'q' keypress can end
	// the server, but only when stdin is a real TTY (skipped on pipes/CI/Windows).
	// This must run BEFORE printReady so the banner only advertises the hint when
	// the listener is actually active. Preview has no long-lived context of its
	// own, so the listener gets one that is cancelled when Serve returns; the
	// deferred restore runs after httpSrv.Shutdown (defers unwind at Serve's
	// return).
	keysCtx, cancelKeys := context.WithCancel(context.Background())
	defer cancelKeys()
	var quitCh <-chan struct{}
	if restore, ok := keys.StdinCbreak(); ok {
		defer restore()
		quitCh = keys.Listen(keysCtx, os.Stdin)
	}

	url := fmt.Sprintf("http://localhost:%d/", port)
	printReady(stdout, url, modeLabel(mode), time.Since(start), quitCh != nil)
	if opts.OnReady != nil {
		opts.OnReady()
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	// A nil quitCh blocks forever in select, so `case <-quitCh:` is safe even
	// when the key listener never started.
	select {
	case <-sigCh:
		// Leading "\n" moves past the terminal's echoed "^C".
		fmt.Fprintf(os.Stdout, "\n%s %s %s\n", stdout.Dim(ui.Clock()), stdout.Bold(stdout.Cyan("[puzzle]")), stdout.Dim("shutting down…"))
	case <-quitCh:
		// ECHO is off in cbreak mode, so the typed 'q' printed nothing — no
		// leading newline needed here.
		fmt.Fprintf(os.Stdout, "%s %s %s\n", stdout.Dim(ui.Clock()), stdout.Bold(stdout.Cyan("[puzzle]")), stdout.Dim("shutting down…"))
	case err := <-serverErr:
		return fmt.Errorf("preview server: %w", err)
	}

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	return httpSrv.Shutdown(shutdownCtx)
}

// Handler serves dist per mode. Exported so tests (and any future caller) can
// drive it through httptest without binding a port.
func Handler(dist, mode string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		res := serve.Resolve(dist, mode, r.URL.Path)
		switch {
		case res.File == "":
			http.Error(w, "404 not found", http.StatusNotFound)
		case res.HTML:
			// http.ServeFile cannot serve these: it 301-redirects any
			// ".../index.html" request to ".../", and it cannot carry the 404 status
			// a built 404.html must be served with.
			writeHTML(w, res.File, res.Status)
		default:
			http.ServeFile(w, r, res.File)
		}
	})
	return mux
}

func writeHTML(w http.ResponseWriter, path string, status int) {
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "404 not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Preview mirrors a host closely enough to be worth checking, but a cached
	// page across two `puzzle build` runs would be actively misleading.
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

// checkDist rejects a missing or empty output directory with the one instruction
// that fixes it.
func checkDist(dist string) error {
	info, err := os.Stat(dist)
	if os.IsNotExist(err) {
		return fmt.Errorf("puzzle preview: no build output at %s — run `puzzle build` first", dist)
	}
	if err != nil {
		return fmt.Errorf("puzzle preview: checking %s: %w", dist, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("puzzle preview: %s is not a directory — remove it and run `puzzle build`", dist)
	}
	entries, err := os.ReadDir(dist)
	if err != nil {
		return fmt.Errorf("puzzle preview: reading %s: %w", dist, err)
	}
	if len(entries) == 0 {
		return fmt.Errorf("puzzle preview: %s is empty — run `puzzle build` first", dist)
	}
	return nil
}

// shapeWarning reports a visible disagreement between the config's output mode
// and what dist/ actually holds — almost always a build that predates the config
// change. Preview still serves per the config (the config is the request); the
// warning explains why the result may look wrong.
func shapeWarning(dist, mode string) string {
	appJS := filepath.Join(dist, "app.js")
	hasAppJS := fileExists(appJS)
	switch mode {
	case serve.ModeStatic:
		if hasAppJS {
			return "dist/app.js exists, but puzzle.config.js says output: 'static' (a static build emits no app.js) — " +
				"serving as static; rebuild with `puzzle build` to preview the real output"
		}
	default:
		if !hasAppJS {
			label := "the default SPA output"
			if mode == serve.ModeHybrid {
				label = "output: 'hybrid'"
			}
			return fmt.Sprintf(
				"dist/app.js is missing, but puzzle.config.js selects %s (which ships app.js) — "+
					"serving anyway; rebuild with `puzzle build` to preview the real output", label)
		}
	}
	return ""
}

// builtMode reads the output mode back out of dist/index.html: the prerenderer
// stamps the mount container `data-puzzle-static` in static mode and
// `data-puzzle-ssg` in hybrid mode (SPEC §36), which is the artifact describing
// itself rather than the preview guessing from file shapes. "" means no marker —
// a plain SPA build, or a `prerender: false` root route.
func builtMode(dist string) string {
	data, err := os.ReadFile(filepath.Join(dist, "index.html"))
	if err != nil {
		return ""
	}
	page := string(data)
	switch {
	case strings.Contains(page, "data-puzzle-static"):
		return serve.ModeStatic
	case strings.Contains(page, "data-puzzle-ssg"):
		return serve.ModeHybrid
	}
	return ""
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func modeLabel(mode string) string {
	switch mode {
	case serve.ModeStatic:
		return "static (clean URLs, real 404s)"
	case serve.ModeHybrid:
		return "hybrid (prerendered pages, SPA fallback)"
	default:
		return "spa (history-API fallback)"
	}
}

func printReady(p *ui.Printer, url, mode string, elapsed time.Duration, showQuitHint bool) {
	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(
		os.Stdout,
		"  %s %s  preview in %d ms\n\n",
		p.Bold(p.Magenta("⬢ Puzzle")),
		p.Dim("v"+version.Version),
		elapsed.Round(time.Millisecond).Milliseconds(),
	)
	printInfoLine(p, "Local:", p.Cyan(url))
	printInfoLine(p, "Serving:", p.Dim("dist/"))
	printInfoLine(p, "Mode:", p.Dim(mode))
	// Only advertise 'q' when the key listener is actually active (a real TTY).
	if showQuitHint {
		fmt.Fprintf(os.Stdout, "\n  %s\n", p.Dim("press q to quit"))
	}
	fmt.Fprintln(os.Stdout)
}

func printInfoLine(p *ui.Printer, label, value string) {
	spacing := 11 - len(label)
	if spacing < 1 {
		spacing = 1
	}
	fmt.Fprintf(os.Stdout, "  %s  %s%s%s\n", p.Green("➜"), p.Bold(label), strings.Repeat(" ", spacing), value)
}

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
