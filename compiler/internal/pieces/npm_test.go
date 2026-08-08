package pieces

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// --- version parsing ----------------------------------------------------------

func TestParseVersion(t *testing.T) {
	cases := []struct {
		in                  string
		major, minor, patch int
		pre                 bool
		ok                  bool
	}{
		{"0.6.2", 0, 6, 2, false, true},
		{"1.12.0", 1, 12, 0, false, true},
		{"0.6.0-rc.1", 0, 6, 0, true, true},
		{"0.6.0+build5", 0, 6, 0, true, true},
		{"0.6", 0, 0, 0, false, false},
		{"dev", 0, 0, 0, false, false},
		{"0.6.x", 0, 0, 0, false, false},
	}
	for _, c := range cases {
		major, minor, patch, pre, ok := parseVersion(c.in)
		if major != c.major || minor != c.minor || patch != c.patch || pre != c.pre || ok != c.ok {
			t.Errorf("parseVersion(%q) = (%d, %d, %d, %v, %v), want (%d, %d, %d, %v, %v)",
				c.in, major, minor, patch, pre, ok, c.major, c.minor, c.patch, c.pre, c.ok)
		}
	}
}

// --- lockstep selection -------------------------------------------------------

// The patch digit belongs to the registry, so 0.6.10 must beat 0.6.2 — a
// lexicographic comparison would pick 0.6.2 instead.
func TestSelectVersionPicksHighestLockstepPatch(t *testing.T) {
	published := []string{"0.5.0", "0.5.3", "0.6.0", "0.6.2", "0.6.10", "0.7.0"}
	got, err := selectVersion(published, "0.6.1")
	if err != nil {
		t.Fatalf("selectVersion returned error: %v", err)
	}
	if got != "0.6.10" {
		t.Errorf("selectVersion = %q, want %q", got, "0.6.10")
	}
}

func TestSelectVersionIgnoresPrereleases(t *testing.T) {
	got, err := selectVersion([]string{"0.6.0", "0.6.1-rc.1"}, "0.6.0")
	if err != nil {
		t.Fatalf("selectVersion returned error: %v", err)
	}
	if got != "0.6.0" {
		t.Errorf("selectVersion = %q, want %q", got, "0.6.0")
	}
}

// No release shares the CLI's major.minor: empty string, nil error. The caller
// renders that with the full published list so the user sees the real boundary.
func TestSelectVersionNoMatchReturnsEmpty(t *testing.T) {
	got, err := selectVersion([]string{"0.4.0", "0.5.0"}, "0.3.1")
	if err != nil {
		t.Fatalf("selectVersion returned error: %v", err)
	}
	if got != "" {
		t.Errorf("selectVersion = %q, want empty string", got)
	}
}

// A prerelease CLI build still pairs with its own major.minor line.
func TestSelectVersionPrereleaseCLIStillMatchesItsMinor(t *testing.T) {
	got, err := selectVersion([]string{"0.6.0"}, "0.6.0-rc.1")
	if err != nil {
		t.Fatalf("selectVersion returned error: %v", err)
	}
	if got != "0.6.0" {
		t.Errorf("selectVersion = %q, want %q", got, "0.6.0")
	}
}

func TestSelectVersionUnparseableCLIVersionErrors(t *testing.T) {
	_, err := selectVersion([]string{"0.6.0"}, "dev")
	if err == nil {
		t.Fatal("selectVersion(\"dev\") = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "--pieces-version") {
		t.Errorf("error %q does not mention --pieces-version", err.Error())
	}
}

// --- npm source specs ---------------------------------------------------------

func TestSplitNpmSpec(t *testing.T) {
	cases := []struct {
		in       string
		pkg, pin string
	}{
		{"@magic-spells/puzzle-pieces", "@magic-spells/puzzle-pieces", ""},
		{"@magic-spells/puzzle-pieces@0.6.2", "@magic-spells/puzzle-pieces", "0.6.2"},
		{"some-pkg", "some-pkg", ""},
		{"some-pkg@1.0.0", "some-pkg", "1.0.0"},
	}
	for _, c := range cases {
		pkg, pin := splitNpmSpec(c.in)
		if pkg != c.pkg || pin != c.pin {
			t.Errorf("splitNpmSpec(%q) = (%q, %q), want (%q, %q)", c.in, pkg, pin, c.pkg, c.pin)
		}
	}
}

func TestPinNpmSource(t *testing.T) {
	got, err := PinNpmSource("npm:@magic-spells/puzzle-pieces", "0.6.2")
	if err != nil {
		t.Fatalf("PinNpmSource returned error: %v", err)
	}
	if want := "npm:@magic-spells/puzzle-pieces@0.6.2"; got != want {
		t.Errorf("PinNpmSource = %q, want %q", got, want)
	}

	if _, err := PinNpmSource("/some/dir", "0.6.2"); err == nil ||
		!strings.Contains(err.Error(), "only applies to an npm registry source") {
		t.Errorf("PinNpmSource(\"/some/dir\") = %v, want a non-npm source error", err)
	}

	if _, err := PinNpmSource("npm:@magic-spells/puzzle-pieces@0.5.0", "0.6.2"); err == nil ||
		!strings.Contains(err.Error(), "already pins") {
		t.Errorf("PinNpmSource on an already-pinned source = %v, want an already-pinned error", err)
	}

	if _, err := PinNpmSource("npm:", "0.6.2"); err == nil ||
		!strings.Contains(err.Error(), "names no npm package") {
		t.Errorf("PinNpmSource(\"npm:\") = %v, want an empty-package error", err)
	}
}

// --- tarball extraction -------------------------------------------------------

// registryTarball builds an npm-shaped gzipped tarball in memory. Keys are FULL
// tarball paths ("package/registry/registry.json") so tests can also craft
// hostile entries.
func registryTarball(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		hdr := &tar.Header{
			Name:     name,
			Mode:     0o644,
			Size:     int64(len(body)),
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("writing tar header for %s: %v", name, err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatalf("writing tar body for %s: %v", name, err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("closing tar writer: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("closing gzip writer: %v", err)
	}
	return buf.Bytes()
}

// Only package/registry/** comes out, keyed by registry-relative path — the same
// rel strings Add passes to Fetch. package.json and README are package
// packaging, not registry content.
func TestExtractRegistryTarball(t *testing.T) {
	tarball := registryTarball(t, map[string]string{
		"package/package.json":                  `{"name":"@magic-spells/puzzle-pieces"}`,
		"package/README.md":                     "# pieces",
		"package/registry/registry.json":        `{"version":1,"pieces":[]}`,
		"package/registry/ui/button/Button.pzl": "<button/>",
		"package/registry/lib/date-math.js":     "export const x = 1;",
	})

	files, err := extractRegistryTarball(bytes.NewReader(tarball))
	if err != nil {
		t.Fatalf("extractRegistryTarball returned error: %v", err)
	}
	if len(files) != 3 {
		t.Fatalf("extracted %d files, want 3: %v", len(files), files)
	}
	if got := string(files["ui/button/Button.pzl"]); got != "<button/>" {
		t.Errorf("files[\"ui/button/Button.pzl\"] = %q, want %q", got, "<button/>")
	}
	if _, ok := files["registry.json"]; !ok {
		t.Errorf("files is missing the \"registry.json\" key: %v", files)
	}
}

// An entry that climbs out of the registry prefix loses the prefix when cleaned
// and is simply skipped — it never lands under any key. An entry that escapes
// the TARBALL ROOT is a hard error.
func TestExtractRegistryTarballRejectsTraversal(t *testing.T) {
	inner := registryTarball(t, map[string]string{
		"package/registry/../../evil":    "pwned",
		"package/registry/registry.json": "{}",
	})
	files, err := extractRegistryTarball(bytes.NewReader(inner))
	if err != nil {
		t.Fatalf("extractRegistryTarball returned error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("extracted %d files, want 1: %v", len(files), files)
	}

	rooted := registryTarball(t, map[string]string{"../evil": "pwned"})
	if _, err := extractRegistryTarball(bytes.NewReader(rooted)); err == nil {
		t.Fatal("extractRegistryTarball on a root-escaping entry = nil error, want an error")
	} else if !strings.Contains(err.Error(), "unsafe path") {
		t.Errorf("error %q does not mention an unsafe path", err.Error())
	}
}

func TestExtractRegistryTarballNotGzip(t *testing.T) {
	if _, err := extractRegistryTarball(strings.NewReader("not a tarball")); err == nil {
		t.Fatal("extractRegistryTarball on non-gzip input = nil error, want an error")
	}
}

// --- npm fetcher --------------------------------------------------------------

// fakeNpm serves a minimal npm registry: an abbreviated packument at /<pkg> and
// tarballs at /tarballs/<version>.tgz. versions maps a version to the tarball's
// FULL-path file map (the shape registryTarball takes).
func fakeNpm(t *testing.T, versions map[string]map[string]string) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/tarballs/") {
			v := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/tarballs/"), ".tgz")
			files, ok := versions[v]
			if !ok {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(registryTarball(t, files))
			return
		}
		// The packument path must carry the SCOPED name escaped (@scope%2Fname).
		// r.URL.Path is already decoded, so check the raw request URI — this is
		// what makes resolve's strings.Replace load-bearing.
		if !strings.Contains(r.RequestURI, "@magic-spells%2Fpuzzle-pieces") {
			http.NotFound(w, r)
			return
		}
		type dist struct {
			Tarball string `json:"tarball"`
		}
		type entry struct {
			Dist dist `json:"dist"`
		}
		out := map[string]map[string]entry{"versions": {}}
		for v := range versions {
			out["versions"][v] = entry{Dist: dist{Tarball: srv.URL + "/tarballs/" + v + ".tgz"}}
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(out); err != nil {
			t.Errorf("encoding packument: %v", err)
		}
	}))
	return srv
}

func newTestNpmFetcher(srvURL, cliVersion, pin string) *npmFetcher {
	return &npmFetcher{pkg: defaultNpmPackage, pin: pin, cliVersion: cliVersion, base: srvURL, configured: npmScheme + defaultNpmPackage}
}

// Resolution is lazy and lockstep: nothing is fetched until the first Fetch,
// which picks the HIGHEST 0.6.x for a 0.6.1 CLI, and every later Fetch reads the
// already-unpacked in-memory map.
func TestNpmFetcherResolvesLockstepAndFetches(t *testing.T) {
	srv := fakeNpm(t, map[string]map[string]string{
		"0.5.0": {"package/registry/registry.json": `{"v":"0.5.0"}`},
		"0.6.0": {"package/registry/registry.json": `{"v":"0.6.0"}`},
		"0.6.2": {
			"package/registry/registry.json":        `{"v":"0.6.2"}`,
			"package/registry/ui/button/Button.pzl": "<button/>",
		},
		"0.7.0": {"package/registry/registry.json": `{"v":"0.7.0"}`},
	})
	defer srv.Close()
	f := newTestNpmFetcher(srv.URL, "0.6.1", "")

	// Before any Fetch, Source is the CONFIGURED spec — Add compares that string
	// against defaultRegistry to decide whether to print the override hint.
	if want := npmScheme + defaultNpmPackage; f.Source() != want {
		t.Errorf("pre-resolution Source() = %q, want %q", f.Source(), want)
	}

	data, err := f.Fetch("registry.json")
	if err != nil {
		t.Fatalf("Fetch(registry.json) returned error: %v", err)
	}
	if got := string(data); got != `{"v":"0.6.2"}` {
		t.Errorf("Fetch(registry.json) = %q, want %q (the highest 0.6.x)", got, `{"v":"0.6.2"}`)
	}

	if want := npmScheme + defaultNpmPackage + "@0.6.2"; f.Source() != want {
		t.Errorf("post-resolution Source() = %q, want %q", f.Source(), want)
	}

	// Served out of the in-memory map — no second download.
	btn, err := f.Fetch("ui/button/Button.pzl")
	if err != nil {
		t.Fatalf("Fetch(ui/button/Button.pzl) returned error: %v", err)
	}
	if string(btn) != "<button/>" {
		t.Errorf("Fetch(ui/button/Button.pzl) = %q, want %q", btn, "<button/>")
	}

	if _, err := f.Fetch("ui/ghost/Ghost.pzl"); err == nil {
		t.Fatal("Fetch of a file absent from the tarball = nil error, want an error")
	}
}

// An explicit pin overrides lockstep entirely — even when a higher patch on the
// CLI's own line exists.
func TestNpmFetcherHonorsPin(t *testing.T) {
	srv := fakeNpm(t, map[string]map[string]string{
		"0.6.0": {"package/registry/registry.json": `{"v":"0.6.0"}`},
		"0.6.2": {"package/registry/registry.json": `{"v":"0.6.2"}`},
	})
	defer srv.Close()
	f := newTestNpmFetcher(srv.URL, "0.6.9", "0.6.0")

	data, err := f.Fetch("registry.json")
	if err != nil {
		t.Fatalf("Fetch(registry.json) returned error: %v", err)
	}
	if got := string(data); got != `{"v":"0.6.0"}` {
		t.Errorf("Fetch(registry.json) = %q, want %q (the pinned release)", got, `{"v":"0.6.0"}`)
	}
}

// No release shares the CLI's major.minor: the error must name the boundary it
// needs AND everything that is actually published.
func TestNpmFetcherNoMatchNamesTheBoundary(t *testing.T) {
	srv := fakeNpm(t, map[string]map[string]string{
		"0.4.0": {},
		"0.5.2": {},
	})
	defer srv.Close()
	f := newTestNpmFetcher(srv.URL, "0.3.1", "")

	_, err := f.Fetch("registry.json")
	if err == nil {
		t.Fatal("Fetch with no matching release = nil error, want an error")
	}
	// "0.3.x" and not "0.3": the latter is already a substring of "puzzle 0.3.1"
	// in the same message, so it would not cover the "need N.M.x" clause.
	for _, want := range []string{"0.3.x", "0.4.0", "0.5.2"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %q", err.Error(), want)
		}
	}
}

func TestNpmFetcherUnknownPinListsPublished(t *testing.T) {
	srv := fakeNpm(t, map[string]map[string]string{
		"0.6.0": {"package/registry/registry.json": "{}"},
	})
	defer srv.Close()
	f := newTestNpmFetcher(srv.URL, "0.6.0", "9.9.9")

	_, err := f.Fetch("registry.json")
	if err == nil {
		t.Fatal("Fetch with an unpublished pin = nil error, want an error")
	}
	if !strings.Contains(err.Error(), "0.6.0") {
		t.Errorf("error %q does not list the published versions", err.Error())
	}
}

func TestAddThroughNpmFetcherRecordsProvenance(t *testing.T) {
	registryJSON := `{"version":1,"pieces":[{"name":"button","files":["Button.pzl"]}]}`
	srv := fakeNpm(t, map[string]map[string]string{
		"0.6.0": {
			"package/registry/registry.json":        registryJSON,
			"package/registry/ui/button/Button.pzl": "<button/>",
			"package/registry/theme/pieces.css":     "/* puzzle-pieces design tokens */",
		},
	})
	defer srv.Close()

	app := t.TempDir()
	res, err := Add(Options{
		AppRoot: app,
		Names:   []string{"button"},
		Fetcher: newTestNpmFetcher(srv.URL, "0.6.0", ""),
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := "npm:" + defaultNpmPackage + "@0.6.0"; res.Source != want {
		t.Errorf("Result.Source = %q, want %q", res.Source, want)
	}
	if _, err := os.Stat(filepath.Join(app, "app", "components", "ui", "Button.pzl")); err != nil {
		t.Errorf("Button.pzl not copied: %v", err)
	}
	lock, err := readLock(filepath.Join(app, LockFileName))
	if err != nil {
		t.Fatal(err)
	}
	if want := "npm:" + defaultNpmPackage + "@0.6.0"; lock.Registry != want {
		t.Errorf("lock registry = %q, want %q", lock.Registry, want)
	}
	if lock.Puzzle != version.Version {
		t.Errorf("lock puzzle = %q, want %q", lock.Puzzle, version.Version)
	}
}
