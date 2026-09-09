package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

func infoRequireNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
}

func TestInfoOutputNoConfig(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "app", "app.js"), "export default 1;\n")

	var buf bytes.Buffer
	if err := runInfo(&buf, plainPrinter(), dir); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := buf.String()

	want := []string{version.Version, "app/", "dist/", "none (defaults)"}
	for _, s := range want {
		if !strings.Contains(out, s) {
			t.Errorf("info output missing %q:\n%s", s, out)
		}
	}
	// Project root should be the absolute path.
	abs, _ := filepath.Abs(dir)
	if !strings.Contains(out, abs) {
		t.Errorf("info output missing project root %q:\n%s", abs, out)
	}
}

func TestInfoOutputTailwindConfig(t *testing.T) {
	infoRequireNode(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, config.ConfigFileName),
		[]byte("export default { styles: { use: ['tailwindcss'] } };\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := runInfo(&buf, plainPrinter(), dir); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(buf.String(), "tailwindcss") {
		t.Errorf("expected styles line to report tailwindcss, got:\n%s", buf.String())
	}
}

func TestRootVersionSet(t *testing.T) {
	// info.go's init wires the root --version off the stamped value.
	if rootCmd.Version != version.Version {
		t.Errorf("rootCmd.Version = %q, want %q", rootCmd.Version, version.Version)
	}
}
