package fsutil

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// caseInsensitive reports whether dir's filesystem resolves a differently-cased
// spelling of an existing entry, probed at runtime rather than assumed per OS.
func caseInsensitive(t *testing.T, dir string) bool {
	t.Helper()
	probe := filepath.Join(dir, "CaseProbe")
	if err := os.Mkdir(probe, 0o755); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(probe)
	_, err := os.Stat(filepath.Join(dir, "caseprobe"))
	return err == nil
}

func TestCanonicalCaseRestoresOnDiskSpelling(t *testing.T) {
	// EvalSymlinks first: on Windows it expands an 8.3 TEMP spelling
	// (RUNNER~1), which no directory listing would ever return.
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !caseInsensitive(t, dir) {
		t.Skip("filesystem is case-sensitive")
	}
	want := filepath.Join(dir, "MixedCase", "App", "styles.CSS")
	if err := os.MkdirAll(filepath.Dir(want), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(want, nil, 0o644); err != nil {
		t.Fatal(err)
	}

	query := filepath.Join(dir, "mixedcase", "APP", "Styles.css")
	if got := CanonicalCase(query); got != want {
		t.Fatalf("CanonicalCase(%q) = %q, want %q", query, got, want)
	}
	// The temp dir itself, spelled in the wrong case, is restored too.
	upper := filepath.Join(filepath.Dir(dir), strings.ToUpper(filepath.Base(dir)), "mixedcase")
	if got, w := CanonicalCase(upper), filepath.Join(dir, "MixedCase"); got != w {
		t.Fatalf("CanonicalCase(%q) = %q, want %q", upper, got, w)
	}
}

func TestCanonicalCasePrefersExactMatch(t *testing.T) {
	dir := t.TempDir()
	if caseInsensitive(t, dir) {
		t.Skip("filesystem is case-insensitive: Foo and foo cannot coexist")
	}
	for _, name := range []string{"Foo", "foo"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"Foo", "foo"} {
		p := filepath.Join(dir, name)
		if got := CanonicalCase(p); got != p {
			t.Fatalf("CanonicalCase(%q) = %q, want it unchanged", p, got)
		}
	}
}

func TestCanonicalCaseFallsBackUnchanged(t *testing.T) {
	dir := t.TempDir()
	for _, p := range []string{
		filepath.Join(dir, "missing", "deeper"),
		"relative/Path",
		dir,
	} {
		if got := CanonicalCase(p); got != p {
			t.Fatalf("CanonicalCase(%q) = %q, want it unchanged", p, got)
		}
	}
}
