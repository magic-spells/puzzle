// Package fsutil holds small filesystem helpers shared across the compiler.
package fsutil

import (
	"fmt"
	"os"
	"path/filepath"
)

// FileExists reports whether path is an existing non-directory filesystem entry.
func FileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// RejectSymlink returns an error when path exists and is a symbolic link or a
// non-directory. A missing path is fine — the caller creates it. Tool-owned
// scratch directories are created, swept, and removed wholesale, so a symlinked
// ancestor would put those deletions somewhere the app root does not contain.
func RejectSymlink(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s is a symbolic link — the .puzzle scratch directory must be a real directory", path)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory — the .puzzle scratch directory must be a real directory", path)
	}
	return nil
}

// WriteFileAtomic writes data to a temporary file in the same directory as path
// and then renames it over path. Because os.Rename within a directory is atomic
// on POSIX (and replaces the destination on Windows via MoveFileEx), a concurrent
// reader — e.g. the dev server serving dist/styles.css or index.html — never
// observes the truncate-then-write window that os.WriteFile exposes. The parent
// directory must already exist (callers create it).
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // best-effort; a no-op once the rename succeeds
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
