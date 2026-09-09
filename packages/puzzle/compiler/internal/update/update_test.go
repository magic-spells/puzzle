package update

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
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

	// A fresh cache answers alone: the registry must not be contacted at all,
	// which is what keeps the notice free on the overwhelming majority of runs.
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"9.9.9"}`))
	}))
	defer srv.Close()
	t.Setenv("PUZZLE_REGISTRY", srv.URL)

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
	if got := hits.Load(); got != 0 {
		t.Fatalf("registry hits = %d, want 0 — a fresh cache must not fetch", got)
	}
}

// A stale cache is refreshed in the foreground, so a release published since
// the last check is reported on this run rather than the next one.
func TestCheckPassiveRefreshesStaleCacheInline(t *testing.T) {
	oldDir := CacheDir
	CacheDir = t.TempDir()
	t.Cleanup(func() { CacheDir = oldDir })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"0.3.0"}`))
	}))
	defer srv.Close()
	t.Setenv("PUZZLE_REGISTRY", srv.URL)

	if err := WriteCache("0.2.0", time.Now().Add(-2*cacheTTL)); err != nil {
		t.Fatal(err)
	}
	latest, available := CheckPassive("0.1.0")
	if !available || latest != "0.3.0" {
		t.Fatalf("CheckPassive = %q, %v; want 0.3.0, true", latest, available)
	}
	cached, err := ReadCache()
	if err != nil {
		t.Fatal(err)
	}
	if cached.Latest != "0.3.0" {
		t.Fatalf("cache latest = %q, want 0.3.0", cached.Latest)
	}
	if cached.Stale(time.Now()) {
		t.Fatal("cache should have been rewritten fresh")
	}
}

// A registry slower than the foreground cap must not hold the command: the
// stale answer returns immediately and the fire-and-forget refresh lands later.
func TestCheckPassiveSlowRegistryFallsBackToAsync(t *testing.T) {
	oldDir := CacheDir
	CacheDir = t.TempDir()
	t.Cleanup(func() { CacheDir = oldDir })

	// Only the foreground request stalls, and it stalls far past the cap so a
	// slow CI runner cannot accidentally beat it. The background retry that
	// follows answers at once, so the fallback can be observed without waiting
	// out a second stall — and abandoning the stall on client cancellation
	// keeps srv.Close from blocking on it.
	var seen atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen.Add(1) == 1 {
			select {
			case <-time.After(10 * syncTimeout):
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"0.3.0"}`))
	}))
	defer srv.Close()
	t.Setenv("PUZZLE_REGISTRY", srv.URL)

	if err := WriteCache("0.2.0", time.Now().Add(-2*cacheTTL)); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	latest, available := CheckPassive("0.1.0")
	elapsed := time.Since(start)

	if !available || latest != "0.2.0" {
		t.Fatalf("CheckPassive = %q, %v; want the stale 0.2.0, true", latest, available)
	}
	if budget := 2 * syncTimeout; elapsed > budget {
		t.Fatalf("CheckPassive took %s, want under %s", elapsed, budget)
	}

	// The background refresh gets the slow answer and writes it for a later run.
	deadline := time.Now().Add(5 * time.Second)
	for {
		cached, err := ReadCache()
		if err == nil && cached.Latest == "0.3.0" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("async refresh never wrote 0.3.0 (cache = %#v, err = %v)", cached, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// A failed foreground fetch is remembered, and for failureBackoff afterwards
// no fetch is attempted at all. Without this a blackholing network charges
// every single `puzzle build` the full cap: the failure writes no cache, so
// nothing ever goes un-stale, and `build` exits before the async retry lands.
func TestCheckPassiveBacksOffAfterFailedFetch(t *testing.T) {
	oldDir := CacheDir
	CacheDir = t.TempDir()
	t.Cleanup(func() { CacheDir = oldDir })

	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	defer broken.Close()
	t.Setenv("PUZZLE_REGISTRY", broken.URL)

	if err := WriteCache("0.2.0", time.Now().Add(-2*cacheTTL)); err != nil {
		t.Fatal(err)
	}
	if latest, available := CheckPassive("0.1.0"); !available || latest != "0.2.0" {
		t.Fatalf("CheckPassive = %q, %v; want the stale 0.2.0, true", latest, available)
	}
	disk, err := readCacheFile()
	if err != nil {
		t.Fatal(err)
	}
	if disk.FailedAt == "" {
		t.Fatal("a failed foreground fetch must record failed_at")
	}
	if disk.Latest != "0.2.0" {
		t.Fatalf("cache latest = %q, want the recorded 0.2.0 left alone", disk.Latest)
	}

	// A healthy registry that the backoff window must not reach. It is a second
	// server so the first call's background retry cannot touch this counter.
	var hits atomic.Int64
	live := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"0.3.0"}`))
	}))
	defer live.Close()
	t.Setenv("PUZZLE_REGISTRY", live.URL)

	start := time.Now()
	latest, available := CheckPassive("0.1.0")
	elapsed := time.Since(start)
	if !available || latest != "0.2.0" {
		t.Fatalf("CheckPassive = %q, %v; want the stale 0.2.0, true", latest, available)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("registry hits = %d, want 0 — the backoff window must not fetch", got)
	}
	if budget := syncTimeout / 2; elapsed > budget {
		t.Fatalf("CheckPassive took %s, want well under the %s cap", elapsed, syncTimeout)
	}

	// Past the window the check retries, and the success clears the stamp.
	if err := writeFailure(time.Now().Add(-failureBackoff - time.Minute)); err != nil {
		t.Fatal(err)
	}
	if latest, available := CheckPassive("0.1.0"); !available || latest != "0.3.0" {
		t.Fatalf("CheckPassive after the backoff = %q, %v; want 0.3.0, true", latest, available)
	}
	if got := hits.Load(); got != 1 {
		t.Fatalf("registry hits = %d, want 1 — the expired backoff must retry once", got)
	}
	disk, err = readCacheFile()
	if err != nil {
		t.Fatal(err)
	}
	if disk.FailedAt != "" {
		t.Fatalf("failed_at = %q, want cleared by the successful fetch", disk.FailedAt)
	}
}

// The cache file predates failed_at, so a file written without it must still
// load — and suppress nothing.
func TestReadCacheAcceptsFileWithoutFailedAt(t *testing.T) {
	oldDir := CacheDir
	CacheDir = t.TempDir()
	t.Cleanup(func() { CacheDir = oldDir })

	path := mustCachePath(t)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"checked_at":"` + time.Now().UTC().Format(time.RFC3339) + `","latest":"0.2.0"}`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	cached, err := ReadCache()
	if err != nil {
		t.Fatalf("old-format cache must still load: %v", err)
	}
	if cached.Latest != "0.2.0" {
		t.Fatalf("cache latest = %q, want 0.2.0", cached.Latest)
	}
	disk, err := readCacheFile()
	if err != nil {
		t.Fatal(err)
	}
	if _, backing := disk.backoffUntil(); backing {
		t.Fatal("a file with no failed_at must not suppress fetches")
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
	if cached.Stale(checkedAt.Add(cacheTTL - time.Minute)) {
		t.Fatalf("cache should remain fresh before %s", cacheTTL)
	}
	if !cached.Stale(checkedAt.Add(cacheTTL)) {
		t.Fatalf("cache should be stale at %s", cacheTTL)
	}
	if cacheTTL != 6*time.Hour {
		t.Fatalf("cacheTTL = %s, want 6h", cacheTTL)
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
