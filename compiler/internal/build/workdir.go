package build

// workdir.go — where a build puts the directories it needs only while it runs.
//
// Both of them used to be siblings of dist/ in the APP ROOT: the staging tree
// (`.dist-staging-*`) a build assembles before swapping it in, and the holding
// dir (`dist.old-*`) swapOutput renames the previous dist into. Each is removed
// on the happy path, but a killed build (^C, an OOM, a CI timeout) leaves one
// behind, and nothing ever cleaned them up.
//
// That is worse than untidy. Tailwind v4 auto-detects its sources by walking the
// project from the CLI's working directory, honoring .gitignore; a leftover is a
// full copy of dist/ that no ordinary `dist` gitignore rule matches
// (`.dist-staging-…` and `dist.old-…` are different names). Ten of them on the
// reference site turned Tailwind's source scan from 112ms into 14s. They also
// slipped past the usage scan's dot-directory prune in the `dist.old-*` case,
// so every leftover was re-parsed on every build.
//
// So: everything transient lives under a single <root>/.puzzle/tmp/, and
// <root>/.puzzle carries a `.gitignore` holding `*`. One directory for a user to
// know about, self-ignoring, and structurally invisible to any tool that
// respects gitignore — Tailwind included. `.puzzle` is already the compiler's
// scratch root (the --fixtures wrapper lives there) and already sits outside
// every directory `puzzle dev` watches, so nothing new is exposed.
//
// Staying under the app root matters: dist/ is <root>/dist, so a staging dir
// under <root>/.puzzle/tmp is still on the same filesystem and the final
// install is a plain atomic rename, never a cross-device copy.

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// workTmpDir is the transient-directory root, relative to the app root.
	workTmpDir = puzzleWorkDir + string(filepath.Separator) + "tmp"

	// stagingPrefix names a build's staging tree inside workTmpDir.
	stagingPrefix = "staging-"
	// oldDistPrefix names swapOutput's holding dir for the previous dist.
	oldDistPrefix = "dist-old-"

	// legacyStagingPrefix / legacyOldDistPrefix are the pre-.puzzle/tmp names,
	// swept from the app root so an existing project heals itself on its next
	// build instead of carrying its leftovers forever.
	legacyStagingPrefix = ".dist-staging-"
	legacyOldDistPrefix = "dist.old-"
)

// workDirGitignore is written into <root>/.puzzle when that file does not exist.
// `*` ignores the directory's whole contents — including the .gitignore itself,
// which is what makes it a single self-contained opt-out rather than something
// the user has to add to their own ignore file.
const workDirGitignore = "*\n"

// staleWorkAge is how long a transient directory must have gone untouched before
// the sweep will remove it. A build writes into its staging tree continuously,
// so anything this cold is the residue of a process that is no longer running.
//
// It is deliberately a plain mtime threshold rather than a lock or pid file: a
// pid marker is not portable in the way that matters (pids are reused, and a
// killed build cannot clean up its own marker either), while the cost of being
// wrong here is bounded — the worst case is that a pathologically long build
// loses its staging dir and fails, leaving dist/ exactly as it was.
const staleWorkAge = 10 * time.Minute

// workTmp returns the app's transient-directory path (it may not exist).
func workTmp(absRoot string) string {
	return filepath.Join(absRoot, workTmpDir)
}

// ensureWorkTmp creates <root>/.puzzle/tmp and, when it is absent, the
// self-ignoring <root>/.puzzle/.gitignore. An existing .gitignore is never
// touched: it may be the user's, and the compiler does not get to rewrite files
// it did not author.
func ensureWorkTmp(absRoot string) (string, error) {
	dir := workTmp(absRoot)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	ignore := filepath.Join(absRoot, puzzleWorkDir, ".gitignore")
	if _, err := os.Lstat(ignore); os.IsNotExist(err) {
		// Best-effort: failing to write the ignore file must not fail a build
		// whose output is otherwise correct.
		_ = os.WriteFile(ignore, []byte(workDirGitignore), 0o644)
	}
	return dir, nil
}

// SweepWorkDirs removes the transient directories a previous, interrupted build
// left behind. It is exported so `puzzle dev` can run it at startup on the SPA
// path, which never calls Build.
//
// Everything about it is deliberately conservative, because it deletes trees:
//   - only two locations are considered, <root>/.puzzle/tmp and the app root;
//   - only exact known name prefixes are matched, never a general pattern;
//   - only real directories are removed — a symlink is skipped outright, so the
//     sweep can never follow a link out of the app root;
//   - only entries untouched for staleWorkAge are removed, so a concurrently
//     running build's staging tree survives.
//
// Failures are ignored throughout: a leftover directory is a performance
// problem, and refusing to build because one could not be deleted would turn it
// into a correctness one.
func SweepWorkDirs(root string) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return
	}
	sweepDir(workTmp(absRoot), stagingPrefix, oldDistPrefix)
	// Legacy siblings of dist/, from before the .puzzle/tmp layout. New builds
	// never create these; sweeping them makes an existing project self-heal.
	sweepDir(absRoot, legacyStagingPrefix, legacyOldDistPrefix)
}

// sweepDir removes stale directories directly inside dir whose name starts with
// one of prefixes.
func sweepDir(dir string, prefixes ...string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-staleWorkAge)
	for _, e := range entries {
		if !matchesAnyPrefix(e.Name(), prefixes) {
			continue
		}
		// ReadDir's DirEntry does not follow symlinks, so Type() reporting a
		// directory means a real one. Anything else (a file, a symlink — even a
		// symlink TO a directory) is left alone.
		if e.Type()&fs.ModeSymlink != 0 || !e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		_ = os.RemoveAll(filepath.Join(dir, e.Name()))
	}
}

func matchesAnyPrefix(name string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}
