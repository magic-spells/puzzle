// Package serve holds the two pieces of HTTP plumbing `puzzle dev` and `puzzle
// preview` must agree on: the loopback port scan (D90) and the mode-aware
// mapping from a request path onto a built dist/ tree.
//
// The resolver exists because "what URL serves what file" is a property of the
// OUTPUT MODE, not of the command: an SPA falls back to index.html for anything
// that is not a file, a hybrid build serves the prerendered page for a route when
// one exists, and a true static build resolves clean URLs against directory
// index.html files and 404s on a miss — because that is what a static host does,
// and preview's job is to behave like one. Resolve answers only "which file, what
// status"; writing the response (live-reload injection in dev, none in preview)
// stays with each caller.
package serve

import (
	"fmt"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// The resolved output modes. They are the values `puzzle.config.js` `output`
// takes ("" meaning the default SPA build), so a config value passes straight in.
const (
	ModeSPA    = ""
	ModeHybrid = "hybrid"
	ModeStatic = "static"
)

// Result is how a request path maps onto the dist tree.
type Result struct {
	// File is the absolute path of the file to serve. Empty only when Status is
	// 404 and the tree carries no 404.html.
	File string
	// Shell reports that File is the ROOT dist/index.html being served as the SPA
	// document (either the root URL or the history-API fallback). Never true in
	// static mode, which has no shell. `puzzle dev` treats this response
	// specially: it is the one that carries the injected live-reload client in SPA
	// mode, and the one that degrades to the D92 build-error page when the file is
	// missing.
	Shell bool
	// HTML reports that File is an HTML document, so a caller may rewrite it
	// (dev's serve-time reload injection) rather than stream it verbatim.
	HTML bool
	// Status is the status code to write: 200, or 404 for a static-mode miss.
	Status int
}

// Resolve maps urlPath onto dist for the given output mode.
//
//   - SPA: an existing regular file, else the root index.html (history fallback).
//   - hybrid: an existing regular file, else the route's prerendered
//     <path>/index.html when one was written, else the root index.html — the
//     router owns whatever was not prerendered.
//   - static: an existing regular file, else the clean-URL <path>/index.html,
//     else a real 404 (dist/404.html when the catch-all route wrote one, which is
//     the file GitHub Pages / Netlify / Cloudflare serve). No index.html
//     fallback: a static host has no router to fall back to.
func Resolve(dist, mode, urlPath string) Result {
	index := filepath.Join(dist, "index.html")

	clean := path.Clean(urlPath)
	if clean == "/" || clean == "." {
		if mode == ModeStatic {
			if isFile(index) {
				return Result{File: index, HTML: true, Status: 200}
			}
			return missing(dist)
		}
		return Result{File: index, Shell: true, HTML: true, Status: 200}
	}

	candidate := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(clean, "/")))
	// withinDir is lexical; withinDirResolved backstops it for a symlink under
	// dist pointing outside. A path that escapes is treated as a miss, never
	// served.
	if withinDir(dist, candidate) {
		if isFile(candidate) && withinDirResolved(dist, candidate) {
			if candidate == index && mode != ModeStatic {
				// "/index.html" is the root document, same as "/".
				return Result{File: index, Shell: true, HTML: true, Status: 200}
			}
			return Result{File: candidate, HTML: isHTMLName(candidate), Status: 200}
		}

		// Clean URL: /about → dist/about/index.html. Only the prerender modes have
		// such files; the SPA path deliberately keeps its historical behavior of
		// falling straight through to the shell.
		if mode != ModeSPA {
			pageIndex := filepath.Join(candidate, "index.html")
			if isFile(pageIndex) && withinDirResolved(dist, pageIndex) {
				return Result{File: pageIndex, HTML: true, Status: 200}
			}
		}
	}

	if mode == ModeStatic {
		return missing(dist)
	}
	return Result{File: index, Shell: true, HTML: true, Status: 200}
}

// missing is the static-mode miss: the built 404 page when the app's catch-all
// route wrote one (SPEC §36), else a bare 404 the caller renders itself.
func missing(dist string) Result {
	page := filepath.Join(dist, "404.html")
	if isFile(page) {
		return Result{File: page, HTML: true, Status: 404}
	}
	return Result{Status: 404}
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func isHTMLName(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".html" || ext == ".htm"
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

// withinDirResolved reports whether target, after symlink resolution, is inside
// dir (also symlink-resolved). A resolution error is treated as outside — fail
// closed.
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

// PortScanLimit is how many consecutive ports Listen tries before giving up.
// A busy default port is a papercut, not a failure (the same posture as Vite,
// Next, and Astro), but the scan is bounded so a wedged machine reports a real
// error instead of walking the port space.
const PortScanLimit = 10

// Listen binds the first free loopback port at or above `port`, returning the
// listener. With strict set, only `port` itself is tried (D90).
//
// Loopback only: the dev and preview servers are a local convenience, not a LAN
// service. The banner prints localhost, so the bind must match. No host config
// option in v1.
//
// Any bind failure advances the scan, and the FIRST error is what surfaces once
// the range is exhausted — it belongs to the port the user actually asked for.
// Testing for EADDRINUSE specifically would need per-OS errno handling (Windows
// reports WSAEADDRINUSE), and it buys nothing: a failure that is not "in use"
// (permission, unavailable interface) fails identically on every candidate, so
// the scan costs a few syscalls and still reports the right error.
//
// Port 0 is passed through untouched — the kernel picks a free port and the one
// attempt always succeeds, so there is nothing to scan.
func Listen(port int, strict bool) (net.Listener, error) {
	const maxPort = 65535

	if port < 0 || port > maxPort {
		return nil, fmt.Errorf("invalid port %d: must be between 0 and %d", port, maxPort)
	}

	var firstErr error
	for candidate := port; candidate <= maxPort; candidate++ {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", candidate))
		if err == nil {
			return ln, nil
		}
		if firstErr == nil {
			firstErr = err
		}
		if strict || port == 0 || candidate-port >= PortScanLimit-1 {
			break
		}
	}
	return nil, firstErr
}

// BoundPort reports the port a listener actually bound, falling back to fallback
// for a non-TCP address that could never occur through Listen but should not
// panic a type assertion if it ever did.
func BoundPort(ln net.Listener, fallback int) int {
	if tcp, ok := ln.Addr().(*net.TCPAddr); ok {
		return tcp.Port
	}
	return fallback
}
