package pieces

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
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
	tr := tar.NewReader(gz)
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
