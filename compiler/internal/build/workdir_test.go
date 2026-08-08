package build

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// mkStale creates dir and backdates it past the sweep's age threshold.
func mkStale(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * staleWorkAge)
	if err := os.Chtimes(dir, old, old); err != nil {
		t.Fatal(err)
	}
	return dir
}

func mkFresh(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

// The sweep removes stale transient dirs — in the current .puzzle/tmp location
// AND in the legacy app-root location, so an existing project heals itself —
// while leaving everything else exactly where it is.
func TestSweepWorkDirs(t *testing.T) {
	root := t.TempDir()
	tmp, err := ensureWorkTmp(root)
	if err != nil {
		t.Fatal(err)
	}

	staleStaging := mkStale(t, filepath.Join(tmp, stagingPrefix+"abc123"))
	staleOldDist := mkStale(t, filepath.Join(tmp, oldDistPrefix+"xyz789"))
	legacyStaging := mkStale(t, filepath.Join(root, legacyStagingPrefix+"abc123"))
	legacyOldDist := mkStale(t, filepath.Join(root, legacyOldDistPrefix+"xyz789"))

	// Everything below must SURVIVE.
	activeStaging := mkFresh(t, filepath.Join(tmp, stagingPrefix+"running"))
	dist := mkStale(t, filepath.Join(root, "dist"))
	userDir := mkStale(t, filepath.Join(root, "distributions"))
	scratchOther := mkStale(t, filepath.Join(tmp, "somebody-elses-dir"))
	fixturesDir := mkStale(t, filepath.Join(root, puzzleWorkDir, "fixtures"))

	SweepWorkDirs(root)

	for _, gone := range []string{staleStaging, staleOldDist, legacyStaging, legacyOldDist} {
		if exists(gone) {
			t.Errorf("stale transient dir survived the sweep: %s", gone)
		}
	}
	for _, kept := range []string{activeStaging, dist, userDir, scratchOther, fixturesDir, tmp} {
		if !exists(kept) {
			t.Errorf("the sweep removed something it must not touch: %s", kept)
		}
	}
}

// A symlink whose NAME matches a swept pattern must be left alone: removing it
// is at best pointless and at worst follows a link out of the app root.
func TestSweepWorkDirsSkipsSymlinks(t *testing.T) {
	root := t.TempDir()
	tmp, err := ensureWorkTmp(root)
	if err != nil {
		t.Fatal(err)
	}

	outside := t.TempDir()
	victim := filepath.Join(outside, "precious.txt")
	if err := os.WriteFile(victim, []byte("do not delete"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(tmp, stagingPrefix+"link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	old := time.Now().Add(-2 * staleWorkAge)
	_ = os.Chtimes(link, old, old)

	SweepWorkDirs(root)

	if !exists(victim) {
		t.Fatal("the sweep followed a symlink out of the app root and deleted the target's contents")
	}
	if !exists(link) {
		t.Error("the sweep removed a symlink; it should skip anything that is not a real directory")
	}
}

// The scratch root has to ignore itself, and the compiler must never rewrite an
// ignore file it did not author.
func TestEnsureWorkTmpWritesSelfIgnoringGitignore(t *testing.T) {
	root := t.TempDir()
	tmp, err := ensureWorkTmp(root)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := tmp, filepath.Join(root, ".puzzle", "tmp"); got != want {
		t.Errorf("scratch dir = %q, want %q", got, want)
	}

	ignore := filepath.Join(root, ".puzzle", ".gitignore")
	got, err := os.ReadFile(ignore)
	if err != nil {
		t.Fatalf("no .gitignore in the scratch root: %v", err)
	}
	if string(got) != workDirGitignore {
		t.Errorf(".gitignore = %q, want %q", got, workDirGitignore)
	}

	// A second call must not clobber it.
	if err := os.WriteFile(ignore, []byte("# mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureWorkTmp(root); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(ignore); string(got) != "# mine\n" {
		t.Errorf("an existing .gitignore was overwritten: %q", got)
	}
}

// A real build must put its staging tree in the scratch dir and leave nothing
// there afterwards — the staging dir is consumed by the rename into dist/.
func TestBuildStagesInsideTheScratchDir(t *testing.T) {
	root := scratchApp(t)
	write(t, filepath.Join(root, "app", "views", "Home.pzl"), strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "app.js")); err != nil {
		t.Fatalf("dist/app.js missing after the build: %v", err)
	}

	entries, err := os.ReadDir(workTmp(root))
	if err != nil {
		t.Fatalf("the build must create the scratch dir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("scratch dir should be empty after a successful build, holds %d entries", len(entries))
	}

	// And nothing of the old shape beside dist/.
	rootEntries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range rootEntries {
		if matchesAnyPrefix(e.Name(), []string{legacyStagingPrefix, legacyOldDistPrefix}) {
			t.Errorf("build created a legacy-style transient dir beside dist/: %s", e.Name())
		}
	}
}
