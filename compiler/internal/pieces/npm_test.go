package pieces

import (
	"strings"
	"testing"
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
