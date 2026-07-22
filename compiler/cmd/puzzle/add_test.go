package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// addRequireNode skips a test when node is unavailable — loading an existing
// puzzle.config.js shells out to node (D3).
func addRequireNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
}

// plainPrinter returns a color-disabled printer so test assertions match raw
// substrings.
func plainPrinter() *ui.Printer { return ui.New(nil) }

func TestAddUnknownIntegration(t *testing.T) {
	var buf bytes.Buffer
	err := runAdd(&buf, plainPrinter(), t.TempDir(), []string{"sass"}, "", false)
	if err == nil {
		t.Fatal("expected an error for an unknown integration")
	}
	if !strings.Contains(err.Error(), "supported") {
		t.Errorf("error should list supported integrations, got: %v", err)
	}
}

func TestAddTailwindNoConfigWritesConfig(t *testing.T) {
	dir := t.TempDir()
	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, config.ConfigFileName))
	if err != nil {
		t.Fatalf("config not written: %v", err)
	}
	body := string(data)
	if !strings.Contains(body, "tailwindcss") || !strings.Contains(body, "use") {
		t.Errorf("config missing styles.use tailwind entry:\n%s", body)
	}
	out := buf.String()
	if !strings.Contains(out, npmInstallLine) {
		t.Errorf("output should include the npm install reminder, got:\n%s", out)
	}
	// No app/styles/ directory → no stylesheet should have been created.
	if fsFileExists(filepath.Join(dir, "app", "styles", "styles.css")) {
		t.Error("did not expect styles.css without an app/styles/ dir")
	}
}

func TestAddTailwindAliasAccepted(t *testing.T) {
	dir := t.TempDir()
	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), dir, []string{"tailwindcss"}, "", false); err != nil {
		t.Fatalf("unexpected error for tailwindcss alias: %v", err)
	}
	if !fsFileExists(filepath.Join(dir, config.ConfigFileName)) {
		t.Error("expected config written for tailwindcss alias")
	}
}

func TestAddTailwindCreatesStylesCSS(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "app", "styles"), 0o755); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	css, err := os.ReadFile(filepath.Join(dir, "app", "styles", "styles.css"))
	if err != nil {
		t.Fatalf("styles.css not created: %v", err)
	}
	if !strings.Contains(string(css), `@import "tailwindcss"`) {
		t.Errorf("styles.css missing tailwind import:\n%s", css)
	}
}

func TestAddTailwindSkipsStylesWhenImportPresent(t *testing.T) {
	dir := t.TempDir()
	stylesDir := filepath.Join(dir, "app", "styles")
	if err := os.MkdirAll(stylesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// An existing stylesheet already pulls Tailwind in.
	if err := os.WriteFile(filepath.Join(stylesDir, "main.css"), []byte("@import \"tailwindcss\";\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if fsFileExists(filepath.Join(stylesDir, "styles.css")) {
		t.Error("should not create styles.css when a tailwind import already exists")
	}
}

func TestAddTailwindSurfacesStylesWriteError(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: directory permissions don't prevent writes")
	}
	dir := t.TempDir()
	stylesDir := filepath.Join(dir, "app", "styles")
	if err := os.MkdirAll(stylesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Read-only app/styles/ makes the styles.css write fail — the command must
	// surface that error, not silently report success (the FIX 3 bug).
	if err := os.Chmod(stylesDir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(stylesDir, 0o755) }) // let TempDir clean up

	var buf bytes.Buffer
	err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false)
	if err == nil {
		t.Fatal("expected runAdd to surface the styles write failure")
	}
	if fsFileExists(filepath.Join(stylesDir, "styles.css")) {
		t.Error("styles.css should not exist after a failed write")
	}
}

func TestAddTailwindStylesPathNotDirectory(t *testing.T) {
	dir := t.TempDir()
	// A regular FILE where app/styles/ is expected: an actionable error, not a
	// silent no-op (the FIX 1/2 bug — any stat oddity was treated as "nothing").
	if err := os.MkdirAll(filepath.Join(dir, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app", "styles"), []byte("not a dir\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false)
	if err == nil {
		t.Fatal("expected an error when app/styles is a regular file")
	}
	if !strings.Contains(err.Error(), "not a directory") {
		t.Errorf("error should say app/styles is not a directory, got: %v", err)
	}
}

func TestAddTailwindSurfacesUnreadableCSS(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: file permissions don't prevent reads")
	}
	dir := t.TempDir()
	stylesDir := filepath.Join(dir, "app", "styles")
	if err := os.MkdirAll(stylesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// An unreadable candidate .css must abort the scan with the file's path — it
	// could be the very stylesheet that imports Tailwind (the FIX 3 bug: a silent
	// `continue` made the scan mis-answer).
	cssPath := filepath.Join(stylesDir, "theme.css")
	if err := os.WriteFile(cssPath, []byte("/* theme */\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(cssPath, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(cssPath, 0o644) }) // let TempDir clean up
	// Guard: skip when the OS doesn't actually enforce the permission.
	if _, err := os.ReadFile(cssPath); err == nil {
		t.Skip("filesystem does not enforce unreadable permissions")
	}

	var buf bytes.Buffer
	err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false)
	if err == nil {
		t.Fatal("expected runAdd to surface the unreadable .css")
	}
	if !strings.Contains(err.Error(), cssPath) {
		t.Errorf("error should contain the unreadable file path %q, got: %v", cssPath, err)
	}
}

func TestAddTailwindNeverOverwritesExistingStylesCSS(t *testing.T) {
	dir := t.TempDir()
	stylesDir := filepath.Join(dir, "app", "styles")
	if err := os.MkdirAll(stylesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// A styles.css that does NOT import Tailwind must still be left untouched.
	existing := "/* my styles, no tailwind */\nbody { margin: 0; }\n"
	target := filepath.Join(stylesDir, "styles.css")
	if err := os.WriteFile(target, []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	after, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("styles.css disappeared: %v", err)
	}
	if string(after) != existing {
		t.Errorf("existing styles.css was overwritten:\n%s", after)
	}
}

func TestAddTailwindConfigExistsWithTailwindNoOp(t *testing.T) {
	addRequireNode(t)
	dir := t.TempDir()
	cfg := "export default { styles: { use: ['tailwindcss'] } };\n"
	cfgPath := filepath.Join(dir, config.ConfigFileName)
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(buf.String(), "already") {
		t.Errorf("expected a no-op message, got:\n%s", buf.String())
	}
	// The user's config must be untouched.
	after, _ := os.ReadFile(cfgPath)
	if string(after) != cfg {
		t.Errorf("config was modified:\n%s", after)
	}
}

func TestAddTailwindConfigExistsWithoutTailwindPrintsSnippet(t *testing.T) {
	addRequireNode(t)
	dir := t.TempDir()
	cfg := "export default {};\n"
	cfgPath := filepath.Join(dir, config.ConfigFileName)
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), dir, []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "manual step") {
		t.Errorf("expected a manual-step message, got:\n%s", out)
	}
	if !strings.Contains(out, "use: ['tailwindcss']") {
		t.Errorf("expected the styles.use snippet, got:\n%s", out)
	}
	if !strings.Contains(out, npmInstallLine) {
		t.Errorf("expected the npm install line, got:\n%s", out)
	}
	// Must NOT rewrite the user's JS (D3).
	after, _ := os.ReadFile(cfgPath)
	if string(after) != cfg {
		t.Errorf("config must be left untouched, got:\n%s", after)
	}
}

// TestAddUnknownIntegrationListsPiece confirms the supported set now names piece.
func TestAddUnknownIntegrationListsPiece(t *testing.T) {
	var buf bytes.Buffer
	err := runAdd(&buf, plainPrinter(), t.TempDir(), []string{"sass"}, "", false)
	if err == nil || !strings.Contains(err.Error(), "piece") {
		t.Fatalf("expected supported set to include piece, got: %v", err)
	}
}

// TestAddPieceRequiresName is the dispatch guard: `add piece` with no names errors.
func TestAddPieceRequiresName(t *testing.T) {
	var buf bytes.Buffer
	err := runAdd(&buf, plainPrinter(), t.TempDir(), []string{"piece"}, "", false)
	if err == nil || !strings.Contains(err.Error(), "usage: puzzle add piece") {
		t.Fatalf("expected a usage error, got: %v", err)
	}
}

// TestAddPieceDispatchCopies drives the full cmd path against a local fixture
// registry: piece dispatch → app-root walk-up → copy → lock → summary.
func TestAddPieceDispatchCopies(t *testing.T) {
	reg := writeCmdFixtureRegistry(t)

	app := t.TempDir()
	if err := os.WriteFile(filepath.Join(app, "package.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(app, "app", "styles"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app, "app", "styles", "styles.css"), []byte("@import \"tailwindcss\";\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), app, []string{"piece", "button"}, reg, false); err != nil {
		t.Fatalf("add piece: %v", err)
	}
	if !fsFileExists(filepath.Join(app, "app", "components", "ui", "Button.pzl")) {
		t.Error("expected Button.pzl copied into app/components/ui")
	}
	if !fsFileExists(filepath.Join(app, "pieces.lock")) {
		t.Error("expected pieces.lock written")
	}
	if out := buf.String(); !strings.Contains(out, "button") {
		t.Errorf("summary should mention the piece, got:\n%s", out)
	}
}

// writeCmdFixtureRegistry lays out a one-piece registry on disk for the cmd test
// (kept independent of the real puzzle-pieces repo).
func writeCmdFixtureRegistry(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	writeFixtureFile(t, root, "registry.json", `{"version":1,"theme":"theme/pieces.css","pieces":[`+
		`{"name":"button","description":"","files":["Button.pzl"],"registryDependencies":[],"dependencies":[],"targetDir":"app/components/ui"}]}`)
	writeFixtureFile(t, root, "ui/button/Button.pzl", "<puzzle-view><button><Slot/></button></puzzle-view>\n")
	writeFixtureFile(t, root, "theme/pieces.css", "/* puzzle-pieces design tokens */\n")
	return root
}

func writeFixtureFile(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
