package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildRuntimePreflightStopsBeforeEsbuild(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "app", "app.js"), "import { PuzzleApp } from '@magic-spells/puzzle';\n")
	mustWrite(t, filepath.Join(dir, "app", "public", "index.html"), "<html></html>\n")
	mustWrite(t, filepath.Join(dir, "package-lock.json"), "{}\n")
	t.Setenv("PUZZLE_RUNTIME", "")

	err := buildCmd.RunE(buildCmd, []string{dir})
	if err == nil {
		t.Fatal("build unexpectedly succeeded without a runtime")
	}
	want := "puzzle: @magic-spells/puzzle is not installed in this project.\nRun `npm install` and try again."
	if err.Error() != want {
		t.Fatalf("error = %q, want %q", err, want)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "dist")); !os.IsNotExist(statErr) {
		t.Fatalf("dist exists or could not be checked: %v", statErr)
	}
	if strings.Contains(err.Error(), "could not resolve") {
		t.Fatalf("preflight leaked esbuild output: %v", err)
	}
}
