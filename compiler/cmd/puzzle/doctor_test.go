package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/config"
)

func doctorRequireNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
}

// healthyProject builds a minimal well-formed project (entry + index.html, no
// config) under a temp dir and returns its path.
func healthyProject(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "app", "app.js"), "export default 1;\n")
	mustWrite(t, filepath.Join(dir, "app", "public", "index.html"), "<html><body></body></html>\n")
	return dir
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDoctorHealthy(t *testing.T) {
	doctorRequireNode(t) // the node check must pass for a clean run
	dir := healthyProject(t)
	var buf bytes.Buffer
	if fails := runDoctor(&buf, plainPrinter(), dir); fails != 0 {
		t.Fatalf("expected 0 failures for a healthy project, got %d:\n%s", fails, buf.String())
	}
	if !strings.Contains(buf.String(), "all checks passed") {
		t.Errorf("expected a success summary, got:\n%s", buf.String())
	}
}

func TestDoctorMissingAppJS(t *testing.T) {
	dir := t.TempDir()
	// index.html present but no app/app.js.
	mustWrite(t, filepath.Join(dir, "app", "public", "index.html"), "<html></html>\n")
	var buf bytes.Buffer
	fails := runDoctor(&buf, plainPrinter(), dir)
	if fails == 0 {
		t.Fatalf("expected a failure for a missing entry point, got 0:\n%s", buf.String())
	}
	if !strings.Contains(buf.String(), "app/app.js") {
		t.Errorf("expected the entry check to be named, got:\n%s", buf.String())
	}
}

func TestDoctorConfigLoadFailure(t *testing.T) {
	doctorRequireNode(t)
	dir := healthyProject(t)
	// A syntactically broken config must fail the config check.
	mustWrite(t, filepath.Join(dir, config.ConfigFileName), "export default { styles: { use: [ };\n")
	var buf bytes.Buffer
	if fails := runDoctor(&buf, plainPrinter(), dir); fails == 0 {
		t.Fatalf("expected a failure for a malformed config, got 0:\n%s", buf.String())
	}
}

func TestDoctorCommandExitsNonZero(t *testing.T) {
	// The cobra command surfaces failures as an error (→ non-zero exit).
	dir := t.TempDir() // empty: missing entry + index.html
	doctorCmd.SetArgs([]string{dir})
	err := doctorCmd.RunE(doctorCmd, []string{dir})
	if err == nil {
		t.Fatal("expected doctor to return an error when checks fail")
	}
}
