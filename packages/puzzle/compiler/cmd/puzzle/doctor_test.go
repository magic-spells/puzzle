package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/version"
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

// The node line holds the Node 24 floor (D200): an older Node fails naming its
// version, 24 and later pass.
func TestDoctorNodeFloor(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script node stub")
	}
	for ver, want := range map[string]doctorCheck{
		"v22.11.0": {"node", doctorFail, "v22.11.0 — Puzzle needs Node 24 or later"},
		"v24.0.0":  {"node", doctorPass, "v24.0.0"},
	} {
		bin := t.TempDir()
		mustWriteExecutable(t, filepath.Join(bin, "node"), "#!/bin/sh\necho "+ver+"\n")
		t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
		if got := doctorChecks(t.TempDir())[0]; got != want {
			t.Errorf("node %s: got %+v, want %+v", ver, got, want)
		}
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

// A TypeScript app's entry is app/app.ts; doctor resolves it by the build's rule.
func TestDoctorTypeScriptEntry(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "app", "app.ts"), "export default 1;\n")
	mustWrite(t, filepath.Join(dir, "app", "public", "index.html"), "<html></html>\n")
	var buf bytes.Buffer
	runDoctor(&buf, plainPrinter(), dir)
	if !strings.Contains(buf.String(), "✓ entry") || !strings.Contains(buf.String(), "app/app.ts") {
		t.Errorf("expected the entry check to pass on app/app.ts, got:\n%s", buf.String())
	}
}

// Both entries is a hard failure naming both files — the build refuses it too.
func TestDoctorBothEntries(t *testing.T) {
	dir := healthyProject(t)
	mustWrite(t, filepath.Join(dir, "app", "app.ts"), "export default 1;\n")
	var buf bytes.Buffer
	if fails := runDoctor(&buf, plainPrinter(), dir); fails == 0 {
		t.Fatalf("expected a failure for two entries, got 0:\n%s", buf.String())
	}
	if !strings.Contains(buf.String(), "app/app.ts and app/app.js both exist") {
		t.Errorf("expected the entry check to name both files, got:\n%s", buf.String())
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

// fakeRuntime installs a stand-in runtime package at version v under dir and
// returns its client-runtime/index.js, pinning this CLI to 0.10.0 for the test.
func fakeRuntime(t *testing.T, dir, v string) string {
	t.Helper()
	previous := version.Version
	version.Version = "0.10.0"
	t.Cleanup(func() { version.Version = previous })
	pkg := filepath.Join(dir, "node_modules", "@magic-spells", "puzzle")
	mustWrite(t, filepath.Join(pkg, "package.json"), `{"name":"@magic-spells/puzzle","version":"`+v+`"}`)
	mustWrite(t, filepath.Join(pkg, "client-runtime", "index.js"), "export {}\n")
	return filepath.Join(pkg, "client-runtime", "index.js")
}

// The runtime row names the installed version, and a pair across a breaking
// release fails with the message build and dev stop on.
func TestDoctorRuntimeVersion(t *testing.T) {
	t.Setenv(build.RuntimeEnvVar, "")
	for installed, status := range map[string]string{"0.10.1": doctorPass, "0.9.0": doctorFail} {
		dir := healthyProject(t)
		want := doctorCheck{"runtime package", status, "@magic-spells/puzzle " + installed + " installed"}
		if _, err := build.InstalledVersion(fakeRuntime(t, dir, installed)); err != nil {
			want.Detail = err.Error()
		}
		checks := doctorChecks(dir)
		if got := checks[len(checks)-1]; got != want {
			t.Errorf("installed %s: got %+v, want %+v", installed, got, want)
		}
	}
}
