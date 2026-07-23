package update

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestCompare(t *testing.T) {
	tests := []struct {
		name string
		a    string
		b    string
		want int
	}{
		{name: "equal", a: "1.2.3", b: "1.2.3", want: 0},
		{name: "equal prerelease", a: "1.2.3-rc.1", b: "1.2.3-rc.1", want: 0},
		{name: "major", a: "2.0.0", b: "1.9.9", want: 1},
		{name: "minor", a: "1.3.0", b: "1.2.9", want: 1},
		{name: "patch", a: "1.2.4", b: "1.2.3", want: 1},
		{name: "older", a: "0.9.9", b: "1.0.0", want: -1},
		{name: "prerelease before release", a: "1.2.3-beta.1", b: "1.2.3", want: -1},
		{name: "release after prerelease", a: "1.2.3", b: "1.2.3-rc.1", want: 1},
		{name: "prerelease lexical", a: "1.2.3-beta", b: "1.2.3-alpha", want: 1},
		{name: "prerelease numeric", a: "1.2.3-beta.2", b: "1.2.3-beta.11", want: -1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Compare(tt.a, tt.b)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("Compare(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestCheckPassiveUsesFreshCache(t *testing.T) {
	oldDir := CacheDir
	CacheDir = t.TempDir()
	t.Cleanup(func() { CacheDir = oldDir })

	if err := WriteCache("0.2.0", time.Now()); err != nil {
		t.Fatal(err)
	}
	latest, available := CheckPassive("0.1.0")
	if !available || latest != "0.2.0" {
		t.Fatalf("CheckPassive = %q, %v; want 0.2.0, true", latest, available)
	}
	if latest, available := CheckPassive("0.2.0"); available || latest != "" {
		t.Fatalf("up-to-date CheckPassive = %q, %v; want empty, false", latest, available)
	}
}

func TestCacheReadWriteAndStaleness(t *testing.T) {
	oldDir := CacheDir
	CacheDir = t.TempDir()
	t.Cleanup(func() { CacheDir = oldDir })

	checkedAt := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	if err := WriteCache("0.2.0", checkedAt); err != nil {
		t.Fatal(err)
	}
	cached, err := ReadCache()
	if err != nil {
		t.Fatal(err)
	}
	if cached.Latest != "0.2.0" || !cached.CheckedAt.Equal(checkedAt) {
		t.Fatalf("cache = %#v, want latest 0.2.0 at %s", cached, checkedAt)
	}
	if cached.Stale(checkedAt.Add(23*time.Hour + 59*time.Minute)) {
		t.Fatal("cache should remain fresh before 24 hours")
	}
	if !cached.Stale(checkedAt.Add(24 * time.Hour)) {
		t.Fatal("cache should be stale at 24 hours")
	}
	if got, want := filepath.Base(mustCachePath(t)), cacheFileName; got != want {
		t.Fatalf("cache filename = %q, want %q", got, want)
	}
}

func mustCachePath(t *testing.T) string {
	t.Helper()
	path, err := cachePath()
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func TestFetchLatest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/@magic-spells/puzzle/latest" {
			t.Errorf("path = %q", r.URL.Path)
		}
		// The real npm registry rejects the abbreviated install-v1 format on
		// version endpoints such as /latest; emulate that so a regression to
		// the packument-only Accept header fails this test.
		if r.Header.Get("Accept") == "application/vnd.npm.install-v1+json" {
			http.Error(w, "not acceptable", http.StatusNotAcceptable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"0.2.0"}`))
	}))
	defer srv.Close()
	t.Setenv("PUZZLE_REGISTRY", srv.URL)

	got, err := FetchLatest(time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if got != "0.2.0" {
		t.Fatalf("latest = %q, want 0.2.0", got)
	}
}
