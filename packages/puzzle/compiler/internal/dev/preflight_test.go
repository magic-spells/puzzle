package dev

import (
	"os"
	"path/filepath"
	"testing"
)

func TestServeRuntimePreflightFailsBeforeStartup(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "app", "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte("import '@magic-spells/puzzle';\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "public", "index.html"), []byte("<html></html>\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PUZZLE_RUNTIME", "")

	err := Serve(root, Options{})
	if err == nil {
		t.Fatal("Serve unexpectedly succeeded without a runtime")
	}
	want := "puzzle: @magic-spells/puzzle is not installed in this project.\nRun `npm install` (or your package manager's install) and try again."
	if err.Error() != want {
		t.Fatalf("error = %q, want %q", err, want)
	}
	if _, statErr := os.Stat(filepath.Join(root, "dist")); !os.IsNotExist(statErr) {
		t.Fatalf("dist exists or could not be checked: %v", statErr)
	}
}
