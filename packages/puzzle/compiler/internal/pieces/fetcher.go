package pieces

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// defaultRegistry is the published pieces registry on npm. It is the last
// resort after --registry and PUZZLE_PIECES_REGISTRY, and it is VERSIONED: the
// fetcher prefers the newest release whose major.minor matches this CLI's own
// version, so a zero-config `puzzle add piece button` gets pieces authored for
// the compiler running it.
//
// That preference is not a requirement, because the two packages are published
// separately and the compiler normally goes first: when this CLI's own minor has
// no pieces release yet, the fetcher falls back to the newest published release
// on a LOWER major.minor and says so (selectFallbackVersion). Only when nothing
// older exists either — a registry that has never published anything this
// compiler can use — is it a hard error. --pieces-version overrides all of it.
const defaultRegistry = npmScheme + defaultNpmPackage

// httpTimeout bounds a single registry-file request off an http(s) mirror, and
// the npm PACKUMENT fetch. A registry lives behind the network, so a hung host
// must not wedge the CLI — 15s is generous for the few KB of .pzl, .js, and
// JSON involved. The npm TARBALL is megabytes, not KB, so it runs under its own
// longer budget (npmTarballTimeout).
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
	// a later diff/update knows which registry a piece came from. For the npm
	// fetcher it is the CONFIGURED spec until the first successful Fetch resolves
	// a release, and the fully pinned npm:<pkg>@<version> afterwards — so a caller
	// recording it must read it AFTER fetching (Add does).
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

// NewFetcher returns the Fetcher for a resolved source: an npm:<pkg>[@version]
// spec gets the versioned npm fetcher, an http(s) URL prefix the network
// fetcher, anything else a local directory path.
func NewFetcher(source string) Fetcher {
	if strings.HasPrefix(source, npmScheme) {
		pkg, pin := splitNpmSpec(strings.TrimPrefix(source, npmScheme))
		return &npmFetcher{
			pkg:        pkg,
			pin:        pin,
			cliVersion: version.Version,
			base:       npmRegistryBase,
			configured: source,
		}
	}
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

// Fetch is boundedGet over the mirror's URL prefix — the same timeout, redirect
// budget, capped body, and URL-naming errors the npm endpoints get.
func (h *httpFetcher) Fetch(rel string) ([]byte, error) {
	return boundedGet(h.base+"/"+rel, httpTimeout, maxBodyBytes)
}

func (h *httpFetcher) Source() string        { return h.base }
func (h *httpFetcher) Ref(rel string) string { return h.base + "/" + rel }
