package pieces

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

// parseVersion splits a semver string into its numeric parts. A prerelease or
// build suffix ("0.6.0-rc.1") is reported via pre; a string that isn't three
// dot-separated non-negative integers reports ok=false.
func parseVersion(s string) (major, minor, patch int, pre bool, ok bool) {
	rest := s
	if i := strings.IndexAny(rest, "-+"); i >= 0 {
		pre = true
		rest = rest[:i]
	}
	parts := strings.Split(rest, ".")
	if len(parts) != 3 {
		return 0, 0, 0, false, false
	}
	var nums [3]int
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return 0, 0, 0, false, false
		}
		nums[i] = n
	}
	return nums[0], nums[1], nums[2], pre, true
}

// selectVersion picks the highest published pieces version sharing the CLI's
// major.minor — the lockstep contract: pieces 0.6.x pair with puzzle 0.6.x, and
// the patch digit belongs to the registry. Prereleases are never auto-selected.
// Returns "" (nil error) when no release matches; the caller renders that with
// the full published list so the user sees the real boundary.
func selectVersion(published []string, cliVersion string) (string, error) {
	cliMajor, cliMinor, _, _, ok := parseVersion(cliVersion)
	if !ok {
		return "", fmt.Errorf(
			"cannot derive a pieces release from puzzle version %q — pin one with --pieces-version", cliVersion)
	}
	best, bestPatch := "", -1
	for _, v := range published {
		major, minor, patch, pre, ok := parseVersion(v)
		if !ok || pre || major != cliMajor || minor != cliMinor {
			continue
		}
		if patch > bestPatch {
			best, bestPatch = v, patch
		}
	}
	return best, nil
}

// selectFallbackVersion implements the compatibility fallback for a zero-config
// run whose own minor has no pieces release yet — the normal state of a fresh
// `@magic-spells/puzzle` install, since the compiler and the registry are
// published separately and the compiler usually goes first. It returns the
// newest published NON-prerelease whose major.minor is strictly LOWER than the
// CLI's, or "" when nothing older exists (the caller then keeps the hard error).
//
// Older, never newer: a registry authored for a LATER compiler may use grammar
// this binary does not have, which is the failure the lockstep rule exists to
// prevent. An earlier registry only misses features, which is what a fallback
// can honestly promise.
func selectFallbackVersion(published []string, cliVersion string) string {
	cliMajor, cliMinor, _, _, ok := parseVersion(cliVersion)
	if !ok {
		return ""
	}
	best := ""
	bestMajor, bestMinor, bestPatch := -1, -1, -1
	for _, v := range published {
		major, minor, patch, pre, ok := parseVersion(v)
		if !ok || pre {
			continue
		}
		if major > cliMajor || (major == cliMajor && minor >= cliMinor) {
			continue
		}
		if major > bestMajor ||
			(major == bestMajor && minor > bestMinor) ||
			(major == bestMajor && minor == bestMinor && patch > bestPatch) {
			best, bestMajor, bestMinor, bestPatch = v, major, minor, patch
		}
	}
	return best
}

// compareVersions orders two published version strings the way a release
// timeline does: numerically by major, minor, then patch, with a prerelease
// sorting BEFORE the release it leads to (0.6.0-rc.1 < 0.6.0). A string that is
// not three dot-separated integers cannot be placed on that line at all, so it
// sorts below everything that can, alphabetically among its own kind — it is the
// first thing dropped when the error listing truncates.
func compareVersions(a, b string) int {
	aMajor, aMinor, aPatch, aPre, aOK := parseVersion(a)
	bMajor, bMinor, bPatch, bPre, bOK := parseVersion(b)
	switch {
	case !aOK && !bOK:
		return strings.Compare(a, b)
	case !aOK:
		return -1
	case !bOK:
		return 1
	}
	for _, pair := range [][2]int{{aMajor, bMajor}, {aMinor, bMinor}, {aPatch, bPatch}} {
		if pair[0] != pair[1] {
			if pair[0] < pair[1] {
				return -1
			}
			return 1
		}
	}
	if aPre != bPre {
		if aPre {
			return -1
		}
		return 1
	}
	// Same numbers and same kind: two prerelease tags on one version. Their
	// relative order is not meaningful to resolution (a prerelease is never
	// auto-selected), so compare the strings for a stable listing.
	return strings.Compare(a, b)
}

// sortVersions orders a published-version slice oldest-first by compareVersions.
// It must NOT be sort.Strings: lexicographically "0.10.0" sorts before "0.9.0",
// so the moment a package crosses a double-digit minor or patch the newest
// releases are exactly the ones newestPublished's tail drops from the error
// listing — the message would name the boundary and then omit the versions that
// clear it.
func sortVersions(versions []string) {
	sort.Slice(versions, func(i, j int) bool {
		return compareVersions(versions[i], versions[j]) < 0
	})
}

// npmScheme marks a registry source as an npm package spec:
// "npm:<package>[@version]".
const npmScheme = "npm:"

// splitNpmSpec splits "<package>[@version]" into its parts. The leading @ of a
// scoped name is not a pin separator — only an @ past index 0 splits, and the
// LAST one wins so "@scope/name@1.2.3" parses correctly.
func splitNpmSpec(spec string) (pkg, pin string) {
	if i := strings.LastIndex(spec, "@"); i > 0 {
		return spec[:i], spec[i+1:]
	}
	return spec, ""
}

// PinNpmSource applies an explicit --pieces-version to an npm: source. It
// refuses a non-npm source (a dir or URL has no version to pin) and a source
// that already carries a pin (two pins is a contradiction, not a merge).
func PinNpmSource(source, version string) (string, error) {
	if !strings.HasPrefix(source, npmScheme) {
		return "", fmt.Errorf("--pieces-version only applies to an npm registry source, and the source is %q", source)
	}
	pkg, pin := splitNpmSpec(strings.TrimPrefix(source, npmScheme))
	if pkg == "" {
		return "", fmt.Errorf("registry source %q names no npm package", source)
	}
	if pin != "" {
		return "", fmt.Errorf("registry source %q already pins @%s — drop --pieces-version or the pin", source, pin)
	}
	return npmScheme + pkg + "@" + version, nil
}

// maxTarballBytes caps the compressed npm tarball download. The whole registry
// is ~2 MB of source text, so 50 MiB is far above anything real while refusing
// to stream an unbounded body into memory.
const maxTarballBytes = 50 << 20

// maxUnpackedBytes caps the total extracted size — a tiny compressed body must
// not decompress the CLI out of memory (the tarball is untrusted network input).
// It also bounds the total DECOMPRESSION WORK, not just the bytes we retain: the
// gunzip stream itself is read through this limit, so a hostile high-ratio
// tarball cannot grind through gigabytes of entries we would only discard.
const maxUnpackedBytes = 200 << 20

// extractRegistryTarball reads an npm package tarball (gzipped tar) and returns
// the files under package/registry/ keyed by registry-relative slash path — the
// same rel strings Add passes to Fetch. Non-registry entries (package.json,
// README) are skipped; per-file and total size caps bound decompression; a path
// that escapes the tarball root is refused outright.
func extractRegistryTarball(r io.Reader) (map[string][]byte, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return nil, fmt.Errorf("reading npm tarball: %w", err)
	}
	defer gz.Close()

	const prefix = "package/registry/"
	files := make(map[string][]byte)
	var total int64
	// Hold the limiter itself, not just the io.Reader it satisfies: the budget can
	// run out exactly on a 512-byte tar block boundary, in which case tar.Next
	// reports a clean io.EOF and we would return a SILENTLY TRUNCATED map. EOF at
	// the cap is otherwise indistinguishable from a genuine end of archive, so the
	// only honest check is lr.N afterwards.
	lr := &io.LimitedReader{R: gz, N: maxUnpackedBytes + 1}
	tr := tar.NewReader(lr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading npm tarball: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		name := path.Clean(hdr.Name)
		if path.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") {
			return nil, fmt.Errorf("npm tarball contains an unsafe path %q", hdr.Name)
		}
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		rel := strings.TrimPrefix(name, prefix)
		data, err := io.ReadAll(io.LimitReader(tr, maxBodyBytes+1))
		if err != nil {
			return nil, fmt.Errorf("reading %s from npm tarball: %w", rel, err)
		}
		if len(data) > maxBodyBytes {
			return nil, fmt.Errorf("%s in the npm tarball exceeds the %d MiB limit", rel, maxBodyBytes>>20)
		}
		total += int64(len(data))
		if total > maxUnpackedBytes {
			return nil, fmt.Errorf("npm tarball unpacks past the %d MiB limit", maxUnpackedBytes>>20)
		}
		files[rel] = data
	}
	// The +1 byte of headroom is never legitimately consumed, so an exhausted
	// limiter means the stream was cut short, not that the archive ended.
	if lr.N <= 0 {
		return nil, fmt.Errorf("npm tarball unpacks past the %d MiB limit", maxUnpackedBytes>>20)
	}
	return files, nil
}

// defaultNpmPackage is the published registry package. It is a TRANSPORT: the
// CLI downloads its tarball and copies registry files out of it in memory —
// the package is never npm-installed and never appears in a consumer app.
const defaultNpmPackage = "@magic-spells/puzzle-pieces"

// npmRegistryBase is the public npm registry API root.
const npmRegistryBase = "https://registry.npmjs.org"

// npmTarballTimeout bounds the tarball download — a few MB, so a minute is
// generous even on a slow link (the 15s packument timeout would be tight).
const npmTarballTimeout = 60 * time.Second

// npmFetcher serves registry files out of a published npm release. Resolution
// is lazy: the first Fetch resolves the version (lockstep with cliVersion
// unless pinned), downloads the tarball, and unpacks package/registry/ into an
// in-memory map every later Fetch reads from. Add calls Fetch sequentially, so
// no locking is needed.
type npmFetcher struct {
	pkg        string // npm package name
	pin        string // exact version from --pieces-version / npm:…@v; "" derives from cliVersion
	cliVersion string // the compiler's own version (version.Version); tests fix it
	base       string // npm registry API root; tests point at an httptest.Server
	configured string // the source string as configured, pre-resolution
	notice     io.Writer

	resolved string            // version actually fetched; set by load
	files    map[string][]byte // registry-relative path → bytes
}

// noticeWriter is where the compatibility-fallback line goes. It is stderr and
// not the command's normal writer because resolution happens lazily inside the
// first Fetch, long before RenderSummary prints the report to stdout — keeping
// the notice on stderr means it cannot land in the middle of that block.
func (n *npmFetcher) noticeWriter() io.Writer {
	if n.notice != nil {
		return n.notice
	}
	return os.Stderr
}

var _ Fetcher = (*npmFetcher)(nil)

// npmPackument is the slice of npm's abbreviated package metadata we read:
// which versions exist and where each tarball lives.
type npmPackument struct {
	Versions map[string]struct {
		Dist struct {
			Tarball string `json:"tarball"`
		} `json:"dist"`
	} `json:"versions"`
}

func (n *npmFetcher) Fetch(rel string) ([]byte, error) {
	if n.files == nil {
		if err := n.load(); err != nil {
			return nil, err
		}
	}
	data, ok := n.files[rel]
	if !ok {
		return nil, fmt.Errorf("fetching %s: not present in %s@%s (missing registry/%s in the npm tarball)",
			rel, n.pkg, n.resolved, rel)
	}
	return data, nil
}

// Source is the configured spec until resolution succeeds — that exact string
// is what Add compares against defaultRegistry to decide whether to print the
// override hint — and the fully resolved npm:<pkg>@<version> afterwards, which
// is what lands in pieces.lock and the ✓ summary.
func (n *npmFetcher) Source() string {
	if n.resolved != "" {
		return npmScheme + n.pkg + "@" + n.resolved
	}
	return n.configured
}

func (n *npmFetcher) Ref(rel string) string {
	return n.Source() + "/registry/" + rel
}

// load resolves the release and unpacks its registry files.
func (n *npmFetcher) load() error {
	pick, tarball, err := n.resolve()
	if err != nil {
		return err
	}
	body, err := boundedGet(tarball, npmTarballTimeout, maxTarballBytes)
	if err != nil {
		return err
	}
	files, err := extractRegistryTarball(bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("unpacking %s@%s: %w", n.pkg, pick, err)
	}
	n.files, n.resolved = files, pick
	return nil
}

// resolve fetches the abbreviated packument and picks the release: the
// explicit pin when given, else the newest version lockstep with cliVersion.
func (n *npmFetcher) resolve() (version, tarballURL string, err error) {
	// A bare "npm:" source reaches here with an empty package name — PinNpmSource
	// guards that, but only when --pieces-version is passed. Without this the URL
	// is the bare registry root and the user gets an opaque 404 instead of the
	// real mistake.
	if n.pkg == "" {
		return "", "", fmt.Errorf("registry source %q names no npm package", n.configured)
	}
	// A scoped name's / is escaped in the packument URL (@scope%2Fname).
	url := n.base + "/" + strings.Replace(n.pkg, "/", "%2F", 1)
	body, err := boundedGetWithAccept(url, httpTimeout, maxBodyBytes,
		// The abbreviated packument is a fraction of the full one and still
		// carries versions + dist.tarball — everything resolution needs.
		"application/vnd.npm.install-v1+json")
	if err != nil {
		return "", "", err
	}
	var pack npmPackument
	if err := json.Unmarshal(body, &pack); err != nil {
		return "", "", fmt.Errorf("parsing npm metadata for %s: %w", n.pkg, err)
	}
	published := make([]string, 0, len(pack.Versions))
	for v := range pack.Versions {
		published = append(published, v)
	}
	sortVersions(published)

	pick := n.pin
	if pick == "" {
		pick, err = selectVersion(published, n.cliVersion)
		if err != nil {
			return "", "", err
		}
		if pick == "" {
			cliMajor, cliMinor, _, _, _ := parseVersion(n.cliVersion)
			// No release on this compiler's own line. That is the ordinary state of
			// a fresh install — the compiler ships before the matching registry
			// minor exists — so fall back to the newest OLDER release rather than
			// making every zero-config `puzzle add piece` fail until pieces catches
			// up. The notice names both versions so the mismatch is never silent.
			fallback := selectFallbackVersion(published, n.cliVersion)
			if fallback == "" {
				return "", "", fmt.Errorf("no %s release matches puzzle %s (need %d.%d.x; published: %s)",
					n.pkg, n.cliVersion, cliMajor, cliMinor, newestPublished(published, maxListedVersions))
			}
			fmt.Fprintf(n.noticeWriter(),
				"note: no %s release matches puzzle %s (%d.%d.x is not published yet) — using %s, the newest compatible release. Pin an exact one with --pieces-version.\n",
				n.pkg, n.cliVersion, cliMajor, cliMinor, fallback)
			pick = fallback
		}
	}
	entry, ok := pack.Versions[pick]
	if !ok {
		return "", "", fmt.Errorf("%s@%s is not published (published: %s)",
			n.pkg, pick, newestPublished(published, maxListedVersions))
	}
	if entry.Dist.Tarball == "" {
		return "", "", fmt.Errorf("npm metadata for %s@%s carries no tarball URL", n.pkg, pick)
	}
	return pick, entry.Dist.Tarball, nil
}

// maxListedVersions bounds how many published versions an error message names.
// A long-lived package accumulates hundreds of releases; dumping all of them
// buries the actual error, and the newest handful is what tells the user what
// they can actually ask for.
const maxListedVersions = 15

// newestPublished renders the last n entries of a slice sorted by sortVersions
// (NOT sort.Strings — see there), comma separated, prefixed with "… " when
// entries were dropped.
func newestPublished(published []string, n int) string {
	if n <= 0 || len(published) <= n {
		return strings.Join(published, ", ")
	}
	return "… " + strings.Join(published[len(published)-n:], ", ")
}

// boundedGet is the one HTTP path for every remote registry read — an http(s)
// mirror's files and both npm endpoints — under a timeout, a redirect budget,
// and a capped body.
func boundedGet(url string, timeout time.Duration, limit int64) ([]byte, error) {
	return boundedGetWithAccept(url, timeout, limit, "")
}

func boundedGetWithAccept(url string, timeout time.Duration, limit int64, accept string) ([]byte, error) {
	client := &http.Client{
		Timeout: timeout,
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
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := client.Do(req)
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
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("fetching %s: %w", url, err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("fetching %s: response exceeds the %d MiB limit", url, limit>>20)
	}
	return data, nil
}
