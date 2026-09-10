package update

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
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

// stubSpawn replaces the detached-helper spawn with a counter, so the tests
// can observe that a refresh was REQUESTED without forking anything. The real
// spawn is exercised end to end in TestDetachedRefreshOutlivesItsParent.
func stubSpawn(t *testing.T) *atomic.Int64 {
	t.Helper()
	var spawns atomic.Int64
	previous := spawnRefresh
	spawnRefresh = func() error {
		spawns.Add(1)
		return nil
	}
	t.Cleanup(func() { spawnRefresh = previous })
	return &spawns
}

// countingRegistry serves a fixed version and counts every request, so a test
// can assert the passive path made none of its own.
func countingRegistry(t *testing.T, version string) *atomic.Int64 {
	t.Helper()
	var hits atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"version":"` + version + `"}`))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("PUZZLE_REGISTRY", srv.URL)
	return &hits
}

func useTempCacheDir(t *testing.T) {
	t.Helper()
	previous := CacheDir
	CacheDir = t.TempDir()
	t.Cleanup(func() { CacheDir = previous })
}

func TestCheckPassiveUsesFreshCache(t *testing.T) {
	useTempCacheDir(t)
	hits := countingRegistry(t, "9.9.9")
	spawns := stubSpawn(t)

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
	if got := spawns.Load(); got != 0 {
		t.Fatalf("spawns = %d, want 0 — a fresh cache must not refresh", got)
	}
}

// A stale cache answers from what it holds and asks for exactly one background
// refresh. That is the whole design: the command never touches the network, so
// the fresher answer shows up on the NEXT run.
func TestCheckPassiveStaleCacheSpawnsRefreshOnce(t *testing.T) {
	useTempCacheDir(t)
	hits := countingRegistry(t, "0.3.0")
	spawns := stubSpawn(t)

	if err := WriteCache("0.2.0", time.Now().Add(-2*cacheTTL)); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	latest, available := CheckPassive("0.1.0")
	elapsed := time.Since(start)

	if !available || latest != "0.2.0" {
		t.Fatalf("CheckPassive = %q, %v; want the cached 0.2.0, true", latest, available)
	}
	if got := spawns.Load(); got != 1 {
		t.Fatalf("spawns = %d, want exactly 1", got)
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("registry hits = %d, want 0 — CheckPassive must never fetch", got)
	}
	if budget := 50 * time.Millisecond; elapsed > budget {
		t.Fatalf("CheckPassive took %s, want under %s — it must not wait on anything", elapsed, budget)
	}
	// The cache is left exactly as it was: writing it is the helper's job.
	cached, err := ReadCache()
	if err != nil {
		t.Fatal(err)
	}
	if cached.Latest != "0.2.0" {
		t.Fatalf("cache latest = %q, want the untouched 0.2.0", cached.Latest)
	}
}

// No cache at all is the first-run case: nothing to say, and a refresh asked
// for so the second run can say it.
func TestCheckPassiveWithNoCacheSpawnsRefresh(t *testing.T) {
	useTempCacheDir(t)
	spawns := stubSpawn(t)

	if latest, available := CheckPassive("0.1.0"); available || latest != "" {
		t.Fatalf("CheckPassive = %q, %v; want empty, false", latest, available)
	}
	if got := spawns.Load(); got != 1 {
		t.Fatalf("spawns = %d, want exactly 1", got)
	}
}

// A failed refresh is remembered, and for failureBackoff afterwards no helper
// is spawned at all — so an unreachable registry costs one process per quarter
// hour rather than one per command.
func TestCheckPassiveBacksOffAfterFailedRefresh(t *testing.T) {
	useTempCacheDir(t)
	spawns := stubSpawn(t)

	if err := WriteCache("0.2.0", time.Now().Add(-2*cacheTTL)); err != nil {
		t.Fatal(err)
	}
	if err := writeFailure(time.Now()); err != nil {
		t.Fatal(err)
	}
	disk, err := readCacheFile()
	if err != nil {
		t.Fatal(err)
	}
	if disk.Latest != "0.2.0" || disk.CheckedAt == "" {
		t.Fatalf("cache = %#v, want the recorded answer left alone", disk)
	}

	if latest, available := CheckPassive("0.1.0"); !available || latest != "0.2.0" {
		t.Fatalf("CheckPassive = %q, %v; want the stale 0.2.0, true", latest, available)
	}
	if got := spawns.Load(); got != 0 {
		t.Fatalf("spawns = %d, want 0 — the backoff window must not refresh", got)
	}

	// Past the window the refresh is requested again.
	if err := writeFailure(time.Now().Add(-failureBackoff - time.Minute)); err != nil {
		t.Fatal(err)
	}
	if latest, available := CheckPassive("0.1.0"); !available || latest != "0.2.0" {
		t.Fatalf("CheckPassive after the backoff = %q, %v; want 0.2.0, true", latest, available)
	}
	if got := spawns.Load(); got != 1 {
		t.Fatalf("spawns = %d, want 1 — an expired backoff must refresh", got)
	}
}

// The helper's own body: a good registry answer becomes the cache and clears
// any recorded failure.
func TestRefreshWritesCacheAndClearsFailure(t *testing.T) {
	useTempCacheDir(t)
	countingRegistry(t, "0.3.0")

	if err := writeFailure(time.Now()); err != nil {
		t.Fatal(err)
	}
	Refresh()

	cached, err := ReadCache()
	if err != nil {
		t.Fatal(err)
	}
	if cached.Latest != "0.3.0" {
		t.Fatalf("cache latest = %q, want 0.3.0", cached.Latest)
	}
	if cached.Stale(time.Now()) {
		t.Fatal("a fresh refresh must leave a fresh cache")
	}
	disk, err := readCacheFile()
	if err != nil {
		t.Fatal(err)
	}
	if disk.FailedAt != "" {
		t.Fatalf("failed_at = %q, want cleared by the successful refresh", disk.FailedAt)
	}
}

// A failing registry becomes a failure stamp, leaving the recorded answer
// exactly where it was so the notice keeps printing while the backoff runs.
func TestRefreshStampsFailure(t *testing.T) {
	useTempCacheDir(t)
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	defer broken.Close()
	t.Setenv("PUZZLE_REGISTRY", broken.URL)

	if err := WriteCache("0.2.0", time.Now().Add(-2*cacheTTL)); err != nil {
		t.Fatal(err)
	}
	Refresh()

	disk, err := readCacheFile()
	if err != nil {
		t.Fatal(err)
	}
	if disk.FailedAt == "" {
		t.Fatal("a failed refresh must record failed_at")
	}
	if disk.Latest != "0.2.0" {
		t.Fatalf("cache latest = %q, want the recorded 0.2.0 left alone", disk.Latest)
	}
	if until, backing := disk.backoffUntil(); !backing || time.Now().After(until) {
		t.Fatalf("backoffUntil = %s, %v; want a window still open", until, backing)
	}
}

// The subcommand is reachable from a shell, so it re-evaluates the gates rather
// than trusting the parent that spawned it.
func TestRefreshHonorsGates(t *testing.T) {
	for _, gate := range []string{"CI", "PUZZLE_NO_UPDATE_CHECK"} {
		t.Run(gate, func(t *testing.T) {
			useTempCacheDir(t)
			hits := countingRegistry(t, "0.3.0")
			t.Setenv(gate, "1")

			Refresh()

			if got := hits.Load(); got != 0 {
				t.Fatalf("registry hits = %d, want 0 with %s set", got, gate)
			}
			if _, err := ReadCache(); err == nil {
				t.Fatal("a gated refresh must write nothing")
			}
		})
	}
}

// The cache is replaced by rename, never written in place: two commands started
// at once each spawn a helper, and a reader must never catch a half-written
// file and conclude the cache is corrupt.
func TestWriteCacheIsAtomic(t *testing.T) {
	useTempCacheDir(t)
	if err := WriteCache("0.2.0", time.Now()); err != nil {
		t.Fatal(err)
	}

	var stop atomic.Bool
	var writers sync.WaitGroup
	for i := 0; i < 4; i++ {
		writers.Add(1)
		go func() {
			defer writers.Done()
			for n := 0; n < 50; n++ {
				_ = WriteCache("0.2.0", time.Now())
				_ = writeFailure(time.Now())
			}
		}()
	}
	torn := make(chan string, 1)
	var reader sync.WaitGroup
	reader.Add(1)
	go func() {
		defer reader.Done()
		for !stop.Load() {
			if _, err := readCacheFile(); err != nil && !os.IsNotExist(err) {
				select {
				case torn <- err.Error():
				default:
				}
				return
			}
		}
	}()
	writers.Wait()
	stop.Store(true)
	reader.Wait()

	select {
	case err := <-torn:
		t.Fatalf("a concurrent reader saw a torn cache file: %s", err)
	default:
	}

	// And nothing is left behind: the temp files are renamed, not abandoned.
	entries, err := os.ReadDir(filepath.Dir(mustCachePath(t)))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != cacheFileName {
			t.Fatalf("stray file %q left in the cache dir", entry.Name())
		}
	}
}

// The cache file predates failed_at, so a file written without it must still
// load — and suppress nothing.
func TestReadCacheAcceptsFileWithoutFailedAt(t *testing.T) {
	useTempCacheDir(t)

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
	useTempCacheDir(t)

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
	if cacheTTL != time.Hour {
		t.Fatalf("cacheTTL = %s, want 1h", cacheTTL)
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
