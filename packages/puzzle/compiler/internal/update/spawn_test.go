package update

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// The environment the re-executed test binary reads to act as the short-lived
// parent instead of running the suite. See TestMain.
const spawnParentEnv = "PUZZLE_TEST_SPAWN_EXE"

// TestMain gives the package a second mode. When spawnParentEnv is set the
// process is not a test run at all: it is the deliberately short-lived parent
// that TestDetachedRefreshOutlivesItsParent needs — it starts the detached
// helper and exits immediately, which is the exact condition `puzzle build`
// creates and the reason the helper is a process rather than a goroutine.
func TestMain(m *testing.M) {
	if exe := os.Getenv(spawnParentEnv); exe != "" {
		executablePath = func() (string, error) { return exe, nil }
		if err := spawnDetached(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// The one test that forks for real: build the CLI, have a process spawn its
// hidden refresh subcommand and die, and watch the cache file appear anyway.
// Everything else stubs the spawn, so without this nothing would catch a
// detach that silently kills the child with its parent.
func TestDetachedRefreshOutlivesItsParent(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the CLI binary")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("no go toolchain on PATH")
	}

	binDir := t.TempDir()
	exe := filepath.Join(binDir, "puzzle")
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	build := exec.Command("go", "build", "-o", exe, "github.com/magic-spells/puzzle/compiler/cmd/puzzle")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("building the CLI: %v\n%s", err, out)
	}

	registry := countingRegistry(t, "9.9.9")

	// The helper resolves its cache from the user cache dir, which is derived
	// from the environment — so a fake home is the only way to keep a real
	// forked process out of the developer's own cache file.
	home := t.TempDir()
	env := append(os.Environ(),
		spawnParentEnv+"="+exe,
		// Empty, not absent: the guard that stops a helper spawning a helper
		// must not fire on the deliberately-short-lived parent.
		helperEnv+"=",
		"CI=",
		"PUZZLE_NO_UPDATE_CHECK=",
		"PUZZLE_REGISTRY="+os.Getenv("PUZZLE_REGISTRY"),
		"HOME="+home,
		"XDG_CACHE_HOME="+filepath.Join(home, "cache"),
		"LocalAppData="+filepath.Join(home, "cache"),
	)

	// os.Args[0] is this test binary; re-executing it with spawnParentEnv set
	// runs the TestMain branch above rather than the suite.
	parent := exec.Command(os.Args[0])
	parent.Env = env
	started := time.Now()
	if out, err := parent.CombinedOutput(); err != nil {
		t.Fatalf("the spawning parent failed: %v\n%s", err, out)
	}
	parentElapsed := time.Since(started)
	t.Logf("parent exited after %s; waiting for the detached helper", parentElapsed)

	// The parent is gone. Anything that writes the cache now is the helper.
	deadline := time.Now().Add(15 * time.Second)
	for {
		if path := findCacheFile(t, home); path != "" {
			t.Logf("helper wrote %s %s after its parent exited", path, time.Since(started)-parentElapsed)
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if want := `"latest":"9.9.9"`; !strings.Contains(string(data), want) {
				t.Fatalf("cache file = %s, want it to carry %s", data, want)
			}
			if got := registry.Load(); got != 1 {
				t.Fatalf("registry hits = %d, want exactly 1", got)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the detached helper never wrote a cache file under %s (registry hits = %d)", home, registry.Load())
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// findCacheFile locates update-check.json anywhere under the fake home, so the
// test does not have to reimplement os.UserCacheDir per platform.
func findCacheFile(t *testing.T, root string) string {
	t.Helper()
	var found string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() && d.Name() == cacheFileName {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	return found
}
