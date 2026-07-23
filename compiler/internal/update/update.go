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
	cacheTTL        = 24 * time.Hour
)

// CacheDir overrides the directory containing update-check.json. When empty,
// Puzzle uses <os.UserCacheDir()>/puzzle. Tests may redirect it to a temp dir.
var CacheDir string

// Cache is the last successful registry check.
type Cache struct {
	CheckedAt time.Time
	Latest    string
}

type cacheFile struct {
	CheckedAt string `json:"checked_at"`
	Latest    string `json:"latest"`
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
	path, err := cachePath()
	if err != nil {
		return Cache{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Cache{}, err
	}
	var disk cacheFile
	if err := json.Unmarshal(data, &disk); err != nil {
		return Cache{}, err
	}
	checkedAt, err := time.Parse(time.RFC3339, disk.CheckedAt)
	if err != nil {
		return Cache{}, err
	}
	if _, err := parseVersion(disk.Latest); err != nil {
		return Cache{}, err
	}
	return Cache{CheckedAt: checkedAt, Latest: disk.Latest}, nil
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
	data, err := json.Marshal(cacheFile{
		CheckedAt: checkedAt.UTC().Format(time.RFC3339),
		Latest:    latest,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// Stale reports whether the cached check is at least 24 hours old.
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

// CheckPassive returns a newer cached version, when one exists, and refreshes
// stale cache data in the background. It never blocks on or reports registry
// errors.
func CheckPassive(current string) (string, bool) {
	now := time.Now()
	cached, err := ReadCache()
	available := ""
	if err == nil {
		if cmp, compareErr := Compare(cached.Latest, current); compareErr == nil && cmp > 0 {
			available = cached.Latest
		}
	}
	if err != nil || cached.Stale(now) {
		refreshAsync()
	}
	return available, available != ""
}

func refreshAsync() {
	go func() {
		latest, fetchErr := FetchLatest(3 * time.Second)
		if fetchErr == nil {
			_ = WriteCache(latest, time.Now())
		}
	}()
}
