package pieces

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	tr := tar.NewReader(io.LimitReader(gz, maxUnpackedBytes+1))
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

	resolved string            // version actually fetched; set by load
	files    map[string][]byte // registry-relative path → bytes
}

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
	sort.Strings(published)

	pick := n.pin
	if pick == "" {
		pick, err = selectVersion(published, n.cliVersion)
		if err != nil {
			return "", "", err
		}
		if pick == "" {
			cliMajor, cliMinor, _, _, _ := parseVersion(n.cliVersion)
			return "", "", fmt.Errorf("no %s release matches puzzle %s (need %d.%d.x; published: %s)",
				n.pkg, n.cliVersion, cliMajor, cliMinor, strings.Join(published, ", "))
		}
	}
	entry, ok := pack.Versions[pick]
	if !ok {
		return "", "", fmt.Errorf("%s@%s is not published (published: %s)",
			n.pkg, pick, strings.Join(published, ", "))
	}
	if entry.Dist.Tarball == "" {
		return "", "", fmt.Errorf("npm metadata for %s@%s carries no tarball URL", n.pkg, pick)
	}
	return pick, entry.Dist.Tarball, nil
}

// boundedGet mirrors httpFetcher.Fetch's discipline — timeout, redirect
// budget, capped body — for the npm endpoints.
func boundedGet(url string, timeout time.Duration, limit int64) ([]byte, error) {
	return boundedGetWithAccept(url, timeout, limit, "")
}

func boundedGetWithAccept(url string, timeout time.Duration, limit int64, accept string) ([]byte, error) {
	client := &http.Client{
		Timeout: timeout,
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
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching %s: HTTP %d", url, resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("fetching %s: %w", url, err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("fetching %s: response exceeds the %d MiB limit", url, limit>>20)
	}
	return data, nil
}
