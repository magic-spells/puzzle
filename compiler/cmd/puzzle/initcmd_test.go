package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/scaffold"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// fakeRunner is a styles.Runner that returns canned CSS instead of shelling out
// to the real Tailwind CLI, so the integration build is deterministic and does
// not require the Tailwind toolchain.
type fakeRunner struct{ css string }

func (f fakeRunner) Run(styles.RunOptions) (string, error) { return f.css, nil }

// repoRoot returns the module root (compiler/cmd/puzzle → ../../..).
func repoRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(wd, "..", "..", ".."))
	if _, err := os.Stat(filepath.Join(root, "client-runtime", "index.js")); err != nil {
		t.Fatalf("client-runtime not found at %s: %v", root, err)
	}
	return root
}

// installRuntime makes '@magic-spells/puzzle' resolvable from appDir by placing
// node_modules/@magic-spells/puzzle with the repo's package.json and a symlink to
// its client-runtime — exactly the layout build.findInstalledRuntime probes.
func installRuntime(t *testing.T, appDir, root string) {
	t.Helper()
	pkgDir := filepath.Join(appDir, "node_modules", "@magic-spells", "puzzle")
	if err := os.MkdirAll(pkgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	pkg, err := os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pkgDir, "package.json"), pkg, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "client-runtime"), filepath.Join(pkgDir, "client-runtime")); err != nil {
		t.Fatal(err)
	}
}

// buildScaffold scaffolds template into a temp dir and runs a real build.Build
// over it, asserting the expected dist artifacts appear. It proves the emitted
// template source actually compiles.
func buildScaffold(t *testing.T, template string) {
	t.Helper()
	// Reading puzzle.config.js is done by executing node (the Go side never
	// parses JS), so a build of a Tailwind-declaring app needs node on PATH.
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH — required to read puzzle.config.js")
	}

	root := repoRoot(t)
	parent := t.TempDir()

	res, err := scaffold.Create(parent, "sample-app", template)
	if err != nil {
		t.Fatalf("scaffold.Create(%q): %v", template, err)
	}
	installRuntime(t, res.Dir, root)

	// Inject a fake Tailwind runner: the template declares the Tailwind pipeline,
	// which is unavailable offline. This mirrors internal/build's own tests.
	opts := build.Options{Development: true, Runner: fakeRunner{css: "/* tw */"}}
	if err := build.Build(res.Dir, opts); err != nil {
		t.Fatalf("build.Build(%q scaffold): %v", template, err)
	}

	dist := filepath.Join(res.Dir, "dist")
	for _, f := range []string{"app.js", "index.html", "styles.css"} {
		if _, err := os.Stat(filepath.Join(dist, f)); err != nil {
			t.Errorf("expected dist/%s for %q template: %v", f, template, err)
		}
	}
}

func TestScaffoldDefaultBuilds(t *testing.T) { buildScaffold(t, "default") }

func TestScaffoldTodosBuilds(t *testing.T) { buildScaffold(t, "todos") }

// TestPrintInitSummaryNonTTY exercises the summary path on a non-TTY (the test's
// stdout is not a terminal) to guard against a nil-deref / formatting panic.
func TestPrintInitSummaryNonTTY(t *testing.T) {
	res := &scaffold.Result{Dir: filepath.Join(t.TempDir(), "app"), Files: []string{"package.json"}}
	// Should not panic; output goes to the process stdout (captured by test).
	printInitSummary(ui.New(os.Stdout), "app", "default", res, false)
	printInitSummary(ui.New(os.Stdout), "app", "default", res, true)
}

// TestPromptAppNameValid confirms a valid first answer is returned as-is.
func TestPromptAppNameValid(t *testing.T) {
	var out bytes.Buffer
	name, err := promptAppName(strings.NewReader("my-app\n"), &out)
	if err != nil {
		t.Fatalf("promptAppName: %v", err)
	}
	if name != "my-app" {
		t.Errorf("name: got %q, want %q", name, "my-app")
	}
}

// TestPromptAppNameReprompts confirms an invalid answer is rejected (its
// validation error shown) and the loop accepts the next, valid line.
func TestPromptAppNameReprompts(t *testing.T) {
	var out bytes.Buffer
	name, err := promptAppName(strings.NewReader("My App\nmy-app\n"), &out)
	if err != nil {
		t.Fatalf("promptAppName: %v", err)
	}
	if name != "my-app" {
		t.Errorf("name: got %q, want %q", name, "my-app")
	}
	// The rejected first line's validation message must have surfaced.
	if !strings.Contains(out.String(), "invalid app name") {
		t.Errorf("output missing validation error:\n%s", out.String())
	}
}

// TestPromptAppNameEOF confirms an immediately-closed reader ends with the same
// "required" error the non-TTY path returns, rather than looping forever.
func TestPromptAppNameEOF(t *testing.T) {
	var out bytes.Buffer
	if _, err := promptAppName(strings.NewReader(""), &out); err == nil {
		t.Fatal("expected error on EOF, got nil")
	}
}

// TestInitZeroArgsNonTTY confirms `puzzle init` with no argument errors under a
// non-TTY stdin, preserving D32 scriptability instead of blocking on a prompt.
// os.Stdin is swapped for a pipe read-end (not a char device) so the non-TTY
// branch is exercised deterministically regardless of how the tests are run —
// under a pty (interactive) os.Stdin would otherwise read as a terminal and the
// prompt would block. RunE is called directly, mirroring doctor_test.go.
func TestInitZeroArgsNonTTY(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	w.Close()
	orig := os.Stdin
	os.Stdin = r
	defer func() {
		os.Stdin = orig
		r.Close()
	}()

	if err := initCmd.RunE(initCmd, []string{}); err == nil {
		t.Fatal("expected error with zero args on non-TTY stdin, got nil")
	} else if !strings.Contains(err.Error(), "app name required") {
		t.Errorf("error: got %q, want it to contain %q", err.Error(), "app name required")
	}
}

// TestInitTypeScriptWritesTsconfig confirms --typescript adds a strict tsconfig.
func TestInitTypeScriptWritesTsconfig(t *testing.T) {
	parent := t.TempDir()
	res, err := scaffold.Create(parent, "ts-app", "default")
	if err != nil {
		t.Fatalf("scaffold.Create: %v", err)
	}
	added, err := scaffold.WriteTypeScriptConfig(res.Dir)
	if err != nil {
		t.Fatalf("WriteTypeScriptConfig: %v", err)
	}
	if len(added) != 1 || added[0] != "tsconfig.json" {
		t.Fatalf("added: got %v", added)
	}
	data, err := os.ReadFile(filepath.Join(res.Dir, "tsconfig.json"))
	if err != nil {
		t.Fatalf("reading tsconfig.json: %v", err)
	}
	for _, want := range []string{"\"strict\": true", "\"noEmit\": true", "puzzle-env.d.ts", `"@/*": ["./app/*"]`} {
		if !strings.Contains(string(data), want) {
			t.Errorf("tsconfig.json missing %q:\n%s", want, data)
		}
	}
	// Second write refuses to clobber.
	if _, err := scaffold.WriteTypeScriptConfig(res.Dir); err == nil {
		t.Errorf("expected WriteTypeScriptConfig to refuse an existing tsconfig.json")
	}
}

// TestInitWritesJSConfigWithAliasPaths confirms a plain (non---typescript)
// scaffold gets the editor-only jsconfig.json carrying the '@' alias mapping
// (SPEC §40, D75), so '@/components/Card.pzl' resolves in editors the same way
// it does in the build.
func TestInitWritesJSConfigWithAliasPaths(t *testing.T) {
	parent := t.TempDir()
	res, err := scaffold.Create(parent, "js-app", "default")
	if err != nil {
		t.Fatalf("scaffold.Create: %v", err)
	}
	added, err := scaffold.WriteJSConfig(res.Dir)
	if err != nil {
		t.Fatalf("WriteJSConfig: %v", err)
	}
	if len(added) != 1 || added[0] != "jsconfig.json" {
		t.Fatalf("added: got %v", added)
	}
	data, err := os.ReadFile(filepath.Join(res.Dir, "jsconfig.json"))
	if err != nil {
		t.Fatalf("reading jsconfig.json: %v", err)
	}
	if !strings.Contains(string(data), `"@/*": ["./app/*"]`) {
		t.Errorf("jsconfig.json missing the '@' alias paths entry:\n%s", data)
	}
	// Second write refuses to clobber.
	if _, err := scaffold.WriteJSConfig(res.Dir); err == nil {
		t.Errorf("expected WriteJSConfig to refuse an existing jsconfig.json")
	}
}
