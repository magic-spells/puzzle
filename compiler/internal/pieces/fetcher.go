package pieces

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// defaultRegistry is the public puzzle-pieces registry, served as raw files off
// GitHub. It is the last resort after --registry and PUZZLE_PIECES_REGISTRY so a
// zero-config `puzzle add piece button` still works.
const defaultRegistry = "https://raw.githubusercontent.com/magic-spells/puzzle-pieces/main/registry"

// httpTimeout bounds a single registry request. A registry lives behind the
// network, so a hung host must not wedge the CLI — 15s is generous for a few KB
// of .pzl and JSON over raw.githubusercontent.com.
const httpTimeout = 15 * time.Second

// Fetcher reads registry resources by their registry-relative slash path
// ("registry.json", "ui/button/Button.pzl", "lib/date-math.js"). It abstracts
// the two source shapes — a local directory on disk and an http(s) URL prefix —
// so Add is oblivious to where bytes come from and tests can drive a temp dir or
// an httptest.Server through the identical code path.
type Fetcher interface {
	// Fetch returns the bytes at rel, or an error naming the concrete location
	// (path or URL) that failed — the user needs to know WHERE we looked.
	Fetch(rel string) ([]byte, error)
	// Source is the canonical source string recorded verbatim in pieces.lock so
	// a later diff/update knows which registry a piece came from.
	Source() string
	// Ref renders rel as a human-readable location for advisories (the theme
	// merge hint) — a full path for a dir source, a full URL for an http one.
	Ref(rel string) string
}

// ResolveSource picks the registry source by the documented precedence:
// the --registry flag, then $PUZZLE_PIECES_REGISTRY, then the public default.
func ResolveSource(flag string) string {
	if s := strings.TrimSpace(flag); s != "" {
		return s
	}
	if s := strings.TrimSpace(os.Getenv("PUZZLE_PIECES_REGISTRY")); s != "" {
		return s
	}
	return defaultRegistry
}

// NewFetcher returns the Fetcher for a resolved source: an http(s) URL prefix
// gets the network fetcher, anything else is treated as a local directory path.
func NewFetcher(source string) Fetcher {
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		return &httpFetcher{base: strings.TrimRight(source, "/")}
	}
	return &dirFetcher{root: source}
}

// dirFetcher reads a registry laid out on disk (a checkout of puzzle-pieces or a
// test fixture).
type dirFetcher struct{ root string }

func (d *dirFetcher) Fetch(rel string) ([]byte, error) {
	p := filepath.Join(d.root, filepath.FromSlash(rel))
	// Defense in depth: a registry manifest is untrusted input, so even though the
	// caller validates manifest paths (validateManifestPath), refuse at the read
	// boundary to serve any path resolving OUTSIDE the registry root — a `../`
	// traversal or a symlink that escapes it. Both sides are symlink-resolved so a
	// symlinked root or target is compared honestly (mirrors containedWritePath).
	contained, cerr := d.contains(p)
	if cerr != nil {
		return nil, fmt.Errorf("resolving %s: %w", p, cerr)
	}
	if !contained {
		return nil, fmt.Errorf("refusing to read %s: resolves outside the registry root %s", p, d.root)
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", p, err)
	}
	return data, nil
}

// contains reports whether p, after symlink resolution, stays under the
// registry root. It resolves the nearest existing ancestor (evalSymlinksAllowMissing)
// so a not-yet-existing target still has its `..` traversal caught, and a
// dangling symlink fails closed.
func (d *dirFetcher) contains(p string) (bool, error) {
	root, err := filepath.Abs(d.root)
	if err != nil {
		return false, err
	}
	root, err = evalSymlinksAllowMissing(root)
	if err != nil {
		return false, err
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return false, err
	}
	abs, err = evalSymlinksAllowMissing(abs)
	if err != nil {
		return false, err
	}
	fromRoot, err := filepath.Rel(root, abs)
	if err != nil || fromRoot == ".." || strings.HasPrefix(fromRoot, ".."+string(filepath.Separator)) {
		return false, nil
	}
	return true, nil
}

func (d *dirFetcher) Source() string { return d.root }
func (d *dirFetcher) Ref(rel string) string {
	return filepath.Join(d.root, filepath.FromSlash(rel))
}

// maxBodyBytes caps a single registry response. A piece is source text — a
// .pzl, a .js helper, the registry JSON — so 10 MiB is orders of magnitude above
// anything real, while a body without a cap lets a hostile or broken host stream
// the CLI out of memory (a chunked response ignores Content-Length entirely).
const maxBodyBytes = 10 << 20

// maxRedirects bounds the redirect chain. Go's default follows up to 10 hops to
// anywhere; a registry is a static file host (raw.githubusercontent.com does not
// redirect at all) so a legitimate mirror needs one or two, and 3 refuses to be
// walked down a long chain to an unrelated origin.
const maxRedirects = 3

// httpFetcher reads a registry served over http(s) (the public default, or any
// mirror). Each request is a fresh GET under a shared timeout, a bounded
// redirect chain, and a bounded response body.
type httpFetcher struct{ base string }

func (h *httpFetcher) Fetch(rel string) ([]byte, error) {
	url := h.base + "/" + rel
	client := &http.Client{
		Timeout: httpTimeout,
		// via holds the requests ALREADY issued, so len(via) is the number of
		// redirects followed to reach this one: allow it while that count is still
		// within budget, refuse the hop that would exceed it.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return fmt.Errorf("stopped after %d redirects", maxRedirects)
			}
			return nil
		},
	}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("fetching %s: %w", url, err)
	}
	defer resp.Body.Close()
	// A non-200 must name the URL — the usual cause is a mistyped piece name or a
	// registry that moved, and the URL is the actionable detail.
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching %s: HTTP %d", url, resp.StatusCode)
	}
	// Read ONE byte past the cap: a body that exactly fills it still succeeds, and
	// anything larger is detected without buffering the remainder.
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("fetching %s: %w", url, err)
	}
	if len(data) > maxBodyBytes {
		return nil, fmt.Errorf("fetching %s: response exceeds the %d MiB limit", url, maxBodyBytes>>20)
	}
	return data, nil
}

func (h *httpFetcher) Source() string        { return h.base }
func (h *httpFetcher) Ref(rel string) string { return h.base + "/" + rel }
