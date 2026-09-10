// Package update checks the npm registry for newer Puzzle CLI releases and
// caches the result for passive notifications.
package update

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultRegistry = "https://registry.npmjs.org"
	cacheFileName   = "update-check.json"
	// cacheTTL is how long a recorded answer is reused before a background
	// refresh is started. Nothing ever waits on that refresh, so the TTL is
	// short: it only decides how many runs a newly published release stays
	// unmentioned, not how long any command takes.
	cacheTTL = time.Hour

	// refreshTimeout is the detached helper's fetch budget. It can afford to be
	// generous — the command that started it has already exited.
	refreshTimeout = 3 * time.Second
	// failureBackoff is how long a failed refresh suppresses the next one, so an
	// unreachable registry is contacted four times an hour rather than once per
	// command. A failed fetch writes no `checked_at`, so without the stamp the
	// cache would never stop being stale.
	failureBackoff = 15 * time.Minute

	// renameAttempts / renameRetryDelay bound the atomic write's retry loop.
	// See renameWithRetry: this exists for Windows, where a rename over a file
	// another process has open is a sharing violation rather than a no-op.
	renameAttempts   = 5
	renameRetryDelay = 20 * time.Millisecond
)

// CacheDir overrides the directory containing update-check.json. When empty,
// Puzzle uses <os.UserCacheDir()>/puzzle. Tests may redirect it to a temp dir.
var CacheDir string

// Cache is the last successful registry check.
type Cache struct {
	CheckedAt time.Time
	Latest    string
}

// cacheFile is the on-disk shape. failed_at is optional and was added after
// the first release, so a file written without it still loads.
type cacheFile struct {
	CheckedAt string `json:"checked_at"`
	Latest    string `json:"latest"`
	FailedAt  string `json:"failed_at,omitempty"`
}

// FetchLatest fetches the latest published @magic-spells/puzzle version.
func FetchLatest(timeout time.Duration) (string, error) {
	registry := os.Getenv("PUZZLE_REGISTRY")
	if registry == "" {
		registry = defaultRegistry
	}
	url := strings.TrimRight(registry, "/") + "/@magic-spells/puzzle/latest"

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("creating registry request: %w", err)
	}
	// npm only serves the abbreviated install-v1 format for packuments; asking
	// for it on a version endpoint like /latest gets a 406.
	req.Header.Set("Accept", "application/json")

	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return "", fmt.Errorf("contacting registry: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("registry returned %s", resp.Status)
	}

	var payload struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("reading registry response: %w", err)
	}
	if _, err := parseVersion(payload.Version); err != nil {
		return "", fmt.Errorf("registry returned %w", err)
	}
	return payload.Version, nil
}

// Compare compares two supported semantic versions, returning -1, 0, or 1.
func Compare(a, b string) (int, error) {
	av, err := parseVersion(a)
	if err != nil {
		return 0, err
	}
	bv, err := parseVersion(b)
	if err != nil {
		return 0, err
	}

	for i := range av.core {
		if av.core[i] < bv.core[i] {
			return -1, nil
		}
		if av.core[i] > bv.core[i] {
			return 1, nil
		}
	}
	return comparePrerelease(av.pre, bv.pre), nil
}

type semver struct {
	core [3]int
	pre  string
}

func parseVersion(s string) (semver, error) {
	var v semver
	core, pre, hasPre := strings.Cut(s, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 || (hasPre && pre == "") {
		return v, fmt.Errorf("invalid version %q", s)
	}
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return v, fmt.Errorf("invalid version %q", s)
		}
		v.core[i] = n
	}
	v.pre = pre
	return v, nil
}

func comparePrerelease(a, b string) int {
	if a == b {
		return 0
	}
	if a == "" {
		return 1
	}
	if b == "" {
		return -1
	}

	ap, bp := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(ap) && i < len(bp); i++ {
		if ap[i] == bp[i] {
			continue
		}
		an, aerr := strconv.Atoi(ap[i])
		bn, berr := strconv.Atoi(bp[i])
		switch {
		case aerr == nil && berr == nil:
			if an < bn {
				return -1
			}
			return 1
		case aerr == nil:
			return -1
		case berr == nil:
			return 1
		case ap[i] < bp[i]:
			return -1
		default:
			return 1
		}
	}
	if len(ap) < len(bp) {
		return -1
	}
	return 1
}

// ReadCache reads the cached registry result.
func ReadCache() (Cache, error) {
	disk, err := readCacheFile()
	if err != nil {
		return Cache{}, err
	}
	return disk.result()
}

// readCacheFile reads the raw cache file without validating the recorded
// check, so a file holding only a failure stamp still yields that stamp.
func readCacheFile() (cacheFile, error) {
	path, err := cachePath()
	if err != nil {
		return cacheFile{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return cacheFile{}, err
	}
	var disk cacheFile
	if err := json.Unmarshal(data, &disk); err != nil {
		return cacheFile{}, err
	}
	return disk, nil
}

// result validates the recorded check. A file carrying only a failure stamp
// has no answer to give and reports an error, exactly like no file at all.
func (f cacheFile) result() (Cache, error) {
	checkedAt, err := time.Parse(time.RFC3339, f.CheckedAt)
	if err != nil {
		return Cache{}, err
	}
	if _, err := parseVersion(f.Latest); err != nil {
		return Cache{}, err
	}
	return Cache{CheckedAt: checkedAt, Latest: f.Latest}, nil
}

// backoffUntil reports when the recorded failure stops suppressing fetches. An
// absent or unparseable stamp suppresses nothing.
func (f cacheFile) backoffUntil() (time.Time, bool) {
	if f.FailedAt == "" {
		return time.Time{}, false
	}
	failedAt, err := time.Parse(time.RFC3339, f.FailedAt)
	if err != nil {
		return time.Time{}, false
	}
	return failedAt.Add(failureBackoff), true
}

// WriteCache records a successful registry check.
func WriteCache(latest string, checkedAt time.Time) error {
	if _, err := parseVersion(latest); err != nil {
		return err
	}
	path, err := cachePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// No FailedAt: a successful check clears any recorded failure.
	return writeCacheFile(cacheFile{
		CheckedAt: checkedAt.UTC().Format(time.RFC3339),
		Latest:    latest,
	})
}

// writeFailure records a failed refresh. The recorded answer is left exactly as
// it was — only the failure stamp moves — so a stale-but-usable latest keeps
// answering while the backoff runs.
func writeFailure(at time.Time) error {
	// A missing or corrupt file yields the zero value, which is what we want:
	// a stamp with no answer behind it.
	disk, _ := readCacheFile()
	disk.FailedAt = at.UTC().Format(time.RFC3339)
	return writeCacheFile(disk)
}

// writeCacheFile replaces the cache file atomically: a temp file in the same
// directory, then a rename. Two commands started at once each spawn their own
// helper, so concurrent writers are normal — and a reader must never catch a
// half-written file and decide the cache is corrupt.
func writeCacheFile(disk cacheFile) error {
	path, err := cachePath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(disk)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, cacheFileName+".*")
	if err != nil {
		return err
	}
	// Harmless once the rename lands; the cleanup that matters is the one after
	// a failed write partway through.
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	// CreateTemp makes the file 0600; the cache is not a secret.
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return renameWithRetry(tmp.Name(), path)
}

// renameWithRetry replaces the cache file, retrying briefly.
//
// On unix a rename over an open file always succeeds. On Windows it does not:
// replacing a file another process holds open fails with a sharing violation,
// and two `puzzle` commands started at once — each with its own helper, one
// renaming while the other reads — is the normal case here, not an exotic one.
// The window is a single small read, so a handful of short sleeps is the whole
// of what is needed; anything still failing after that is a real error (a
// read-only or vanished cache dir), and losing a refresh to it is silent by
// design. The 80 ms worst case is charged either to the detached helper, which
// has no one waiting on it, or to the last step of `puzzle upgrade`, which has
// just spent seconds running a package manager. Never to `build` or `dev`:
// CheckPassive only ever reads.
func renameWithRetry(from, to string) error {
	var err error
	for attempt := 0; attempt < renameAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(renameRetryDelay)
		}
		if err = os.Rename(from, to); err == nil {
			return nil
		}
	}
	return err
}

// Stale reports whether the cached check is at least cacheTTL old.
func (c Cache) Stale(now time.Time) bool {
	return !now.Before(c.CheckedAt.Add(cacheTTL))
}

func cachePath() (string, error) {
	dir := CacheDir
	if dir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(base, "puzzle")
	}
	return filepath.Join(dir, cacheFileName), nil
}

// CheckPassive returns a newer published version when one exists, answering
// from the cache alone. It never contacts the registry and never waits.
//
// When the recorded answer is older than cacheTTL — or there is none — a
// detached helper is started to refresh it for the NEXT run. The notice for a
// freshly published release therefore appears one run late, which is the price
// of never charging a build for the network. A failed refresh is stamped by the
// helper and suppresses the next spawn for failureBackoff.
//
// Registry errors are never surfaced, and a helper that cannot be spawned fails
// silently: the notice is a courtesy, not a feature anything depends on.
func CheckPassive(current string) (string, bool) {
	now := time.Now()
	disk, _ := readCacheFile()
	cached, cacheErr := disk.result()

	answer := func() (string, bool) {
		if cacheErr != nil {
			return "", false
		}
		return newerThan(cached.Latest, current)
	}

	if cacheErr == nil && !cached.Stale(now) {
		return answer()
	}
	if until, backing := disk.backoffUntil(); backing && now.Before(until) {
		return answer()
	}
	_ = spawnRefresh()
	return answer()
}

// Refresh performs the registry check the detached helper exists to run: fetch,
// then record either the answer or the failure. It is the whole body of the
// hidden `puzzle update-check` subcommand.
//
// The gates are re-evaluated here rather than trusted from the parent, because
// the subcommand is reachable directly from a shell.
func Refresh() {
	if os.Getenv("CI") != "" || os.Getenv("PUZZLE_NO_UPDATE_CHECK") != "" {
		return
	}
	latest, err := FetchLatest(refreshTimeout)
	if err != nil {
		_ = writeFailure(time.Now())
		return
	}
	_ = WriteCache(latest, time.Now())
}

// newerThan reports latest when it is strictly newer than current.
func newerThan(latest, current string) (string, bool) {
	if cmp, err := Compare(latest, current); err == nil && cmp > 0 {
		return latest, true
	}
	return "", false
}
