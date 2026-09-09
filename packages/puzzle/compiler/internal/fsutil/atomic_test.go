package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWriteFileAtomicCreatesAndReplaces(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "styles.css")

	if err := WriteFileAtomic(path, []byte("first"), 0o644); err != nil {
		t.Fatalf("initial write: %v", err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "first" {
		t.Fatalf("read after create: got %q err %v, want %q", got, err, "first")
	}

	// Overwriting replaces the contents in place (same path, same URL served).
	if err := WriteFileAtomic(path, []byte("second, longer"), 0o644); err != nil {
		t.Fatalf("replace write: %v", err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "second, longer" {
		t.Fatalf("read after replace: got %q err %v, want %q", got, err, "second, longer")
	}

	// The temp file must be renamed away, never left behind next to the target.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "styles.css" {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("directory should hold only the target file, got %v", names)
	}
}

func TestWriteFileAtomicPreservesPerm(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix file permissions")
	}
	path := filepath.Join(t.TempDir(), "index.html")
	if err := WriteFileAtomic(path, []byte("<html></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("perm = %o, want 0644", info.Mode().Perm())
	}
}
