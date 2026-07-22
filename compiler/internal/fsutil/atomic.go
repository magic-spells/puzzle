// Package fsutil holds small filesystem helpers shared across the compiler.
package fsutil

import (
	"os"
	"path/filepath"
)

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
