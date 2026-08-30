package main

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
	embeddedskills "github.com/magic-spells/puzzle/skills"
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
	if runtime.GOOS == "windows" {
		t.Skip("a read-only directory mode does not block file creation on Windows")
	}
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

// TestAddTailwindWritesConfigAtProjectRoot: `add tailwind` resolves the app root
// by walking up for package.json / puzzle.config.js, exactly like `add piece`.
// Run from app/, it used to write app/puzzle.config.js — a file the compiler
// never loads (it reads the ROOT config), so the command reported success and
// changed nothing about the build.
func TestAddTailwindWritesConfigAtProjectRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"name":"app"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	stylesDir := filepath.Join(root, "app", "styles")
	if err := os.MkdirAll(stylesDir, 0o755); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	// Invoked from a SUBDIRECTORY of the project.
	if err := runAdd(&buf, plainPrinter(), filepath.Join(root, "app"), []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !fsFileExists(filepath.Join(root, config.ConfigFileName)) {
		t.Errorf("config was not written at the project root:\n%s", buf.String())
	}
	if fsFileExists(filepath.Join(root, "app", config.ConfigFileName)) {
		t.Error("config was written inside app/ — the compiler never loads that one")
	}
	// The entry stylesheet is seeded relative to the same root.
	if !fsFileExists(filepath.Join(stylesDir, "styles.css")) {
		t.Errorf("app/styles/styles.css was not created from the walked-up root:\n%s", buf.String())
	}
}

// TestAddTailwindExistingRootConfigSeenFromSubdir: the walk-up also means an
// EXISTING root config is found from a subdirectory, so the command no-ops
// instead of writing a second, ignored config next to the user.
func TestAddTailwindExistingRootConfigSeenFromSubdir(t *testing.T) {
	addRequireNode(t)
	root := t.TempDir()
	cfg := "export default { styles: { use: ['tailwindcss'] } };\n"
	if err := os.WriteFile(filepath.Join(root, config.ConfigFileName), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(root, "app", "views")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if err := runAdd(&buf, plainPrinter(), sub, []string{"tailwind"}, "", false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(buf.String(), "already") {
		t.Errorf("expected the root config to be found from a subdir, got:\n%s", buf.String())
	}
	if fsFileExists(filepath.Join(sub, config.ConfigFileName)) {
		t.Error("a second config was written in the subdirectory")
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

func TestDetectSkillTargetsUsesExistingConfigDirs(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{".claude", ".cursor"} {
		if err := os.Mkdir(filepath.Join(home, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// A file named like a config root is not an install target.
	if err := os.WriteFile(filepath.Join(home, ".codex"), []byte("not a directory\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	targets, err := detectSkillTargets(home)
	if err != nil {
		t.Fatalf("detect targets: %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("detected %d targets, want 2: %#v", len(targets), targets)
	}
	if targets[0].Name != "Claude Code" || targets[0].Root != filepath.Join(home, ".claude") {
		t.Errorf("first target = %#v, want Claude Code", targets[0])
	}
	if targets[1].Name != "Cursor" || targets[1].Root != filepath.Join(home, ".cursor") {
		t.Errorf("second target = %#v, want Cursor", targets[1])
	}
}

func TestPromptSkillTargetsUsesInjectedInputUnderDumbTerminal(t *testing.T) {
	t.Setenv("TERM", "dumb")
	targets := []skillTarget{
		{Name: "Claude Code", Root: filepath.Join(t.TempDir(), ".claude")},
		{Name: "Codex", Root: filepath.Join(t.TempDir(), ".codex")},
	}

	selected, err := promptSkillTargets(strings.NewReader("\r"), io.Discard, targets)
	if err != nil {
		t.Fatalf("prompt skill targets: %v", err)
	}
	if len(selected) != len(targets) {
		t.Fatalf("selected targets = %#v, want all defaults selected", selected)
	}
	for i := range targets {
		if selected[i] != targets[i] {
			t.Errorf("selected target %d = %#v, want %#v", i, selected[i], targets[i])
		}
	}
}

func TestAddSkillsNoDetectedTargetsIsFriendlyNoOp(t *testing.T) {
	home := t.TempDir()
	var buf bytes.Buffer
	env := addEnvironment{
		homeDir:     func() (string, error) { return home, nil },
		interactive: false,
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("add skills with no targets: %v", err)
	}
	if out := buf.String(); !strings.Contains(out, "nothing to install") {
		t.Errorf("expected a friendly no-target note, got:\n%s", out)
	}
}

func TestAddSkillsNonInteractiveInstallsAllDetectedTargets(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{".claude", ".codex", ".cursor"} {
		if err := os.Mkdir(filepath.Join(home, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	var buf bytes.Buffer
	env := addEnvironment{
		homeDir:     func() (string, error) { return home, nil },
		interactive: false,
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("add skills: %v", err)
	}

	want, err := fs.ReadFile(embeddedskills.FS, "puzzle/SKILL.md")
	if err != nil {
		t.Fatalf("read embedded skill: %v", err)
	}
	for _, name := range []string{".claude", ".codex", ".cursor"} {
		dest := filepath.Join(home, name, "skills", "puzzle", "SKILL.md")
		got, err := os.ReadFile(dest)
		if err != nil {
			t.Errorf("read %s: %v", dest, err)
			continue
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s does not match embedded SKILL.md", dest)
		}
		if !strings.Contains(buf.String(), filepath.Dir(dest)) {
			t.Errorf("output does not include destination %s:\n%s", filepath.Dir(dest), buf.String())
		}
	}
}

func TestAddSkillsOverwriteRefusalAndSuccess(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	env := addEnvironment{
		homeDir:     func() (string, error) { return home, nil },
		interactive: false,
	}

	var buf bytes.Buffer
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("initial add skills: %v", err)
	}
	skillPath := filepath.Join(home, ".claude", "skills", "puzzle", "SKILL.md")
	custom := []byte("locally customized\n")
	if err := os.WriteFile(skillPath, custom, 0o644); err != nil {
		t.Fatal(err)
	}
	// Drop the stamp so the install reads as stale, the way a pre-D99 CLI wrote it.
	// A stamp matching this binary would be "up to date" and never reach the refusal.
	if err := os.Remove(filepath.Join(home, ".claude", "skills", "puzzle", skillVersionFile)); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(home, ".cursor"), 0o755); err != nil {
		t.Fatal(err)
	}

	buf.Reset()
	err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skill"}, "", "", false, env)
	if err == nil {
		t.Fatal("expected existing skill directory to be refused")
	}
	if !strings.Contains(err.Error(), "--overwrite") || !strings.Contains(err.Error(), filepath.Dir(skillPath)) {
		t.Fatalf("overwrite error should include the hint and destination, got: %v", err)
	}
	afterRefusal, err := os.ReadFile(skillPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(afterRefusal, custom) {
		t.Fatalf("refused install changed SKILL.md: %q", afterRefusal)
	}
	if cursorSkill := filepath.Join(home, ".cursor", "skills", "puzzle", "SKILL.md"); fsFileExists(cursorSkill) {
		t.Errorf("refused install partially wrote %s", cursorSkill)
	}

	buf.Reset()
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skill"}, "", "", true, env); err != nil {
		t.Fatalf("add skill --overwrite: %v", err)
	}
	want, err := fs.ReadFile(embeddedskills.FS, "puzzle/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	afterOverwrite, err := os.ReadFile(skillPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(afterOverwrite, want) {
		t.Error("--overwrite did not restore the embedded SKILL.md")
	}
	if cursorSkill := filepath.Join(home, ".cursor", "skills", "puzzle", "SKILL.md"); !fsFileExists(cursorSkill) {
		t.Errorf("--overwrite did not install the newly detected Cursor target at %s", cursorSkill)
	}
}

func TestAddSkillsExplicitRootsSkipDetectionAndPrompt(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".claude")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	env := addEnvironment{
		// A pinned root must not consult the home dir at all — a homeDir that
		// fails proves detection was skipped.
		homeDir:     func() (string, error) { return "", errors.New("home lookup should not happen") },
		interactive: true, // and must not prompt either
		skillRoots:  []string{root},
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("add skills --skill-root: %v", err)
	}

	want, err := fs.ReadFile(embeddedskills.FS, "puzzle/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(root, "skills", "puzzle", "SKILL.md"))
	if err != nil {
		t.Fatalf("read installed skill: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Error("pinned root did not receive the embedded SKILL.md")
	}
	if !strings.Contains(buf.String(), "Claude Code") {
		t.Errorf("a known config dir should still be labelled by tool, got:\n%s", buf.String())
	}
}

func TestAddSkillsExplicitRootMustExist(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	env := addEnvironment{
		homeDir:    func() (string, error) { return t.TempDir(), nil },
		skillRoots: []string{missing},
	}
	var buf bytes.Buffer
	err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env)
	if err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Fatalf("expected a missing --skill-root to error, got %v", err)
	}
	if fsFileExists(filepath.Join(missing, "skills", "puzzle", "SKILL.md")) {
		t.Error("a missing config dir must not be conjured")
	}
}

// stubSkillConfirm replaces the shared confirm prompt for the duration of a test
// and reports how many times it was consulted.
func stubSkillConfirm(t *testing.T, answer bool) *int {
	t.Helper()
	calls := 0
	previous := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) {
		calls++
		return answer, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = previous })
	return &calls
}

// staleSkillInstall writes an install that a previous CLI version produced.
func staleSkillInstall(t *testing.T, root, body string) string {
	t.Helper()
	dest := filepath.Join(root, "skills", "puzzle")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dest, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dest, skillVersionFile), []byte("0.0.1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dest
}

func embeddedSkill(t *testing.T) []byte {
	t.Helper()
	want, err := fs.ReadFile(embeddedskills.FS, "puzzle/SKILL.md")
	if err != nil {
		t.Fatalf("read embedded skill: %v", err)
	}
	return want
}

func TestAddSkillsPromptConfirmedReplacesStaleInstall(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, ".codex"), 0o755); err != nil {
		t.Fatal(err)
	}
	dest := staleSkillInstall(t, filepath.Join(home, ".codex"), "old release\n")
	calls := stubSkillConfirm(t, true)

	var buf bytes.Buffer
	env := addEnvironment{
		homeDir:     func() (string, error) { return home, nil },
		input:       strings.NewReader(""),
		interactive: true,
		skillRoots:  []string{filepath.Join(home, ".codex")},
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("add skills: %v", err)
	}
	if *calls != 1 {
		t.Fatalf("confirm prompt called %d times, want 1", *calls)
	}

	got, err := os.ReadFile(filepath.Join(dest, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, embeddedSkill(t)) {
		t.Error("confirmed prompt did not install the embedded SKILL.md")
	}
	stamped, ok := installedSkillVersion(dest)
	if !ok || stamped != version.Version {
		t.Errorf("stamp = %q (found %v), want %q", stamped, ok, version.Version)
	}
}

// Declining leaves existing installs alone but still installs where there is
// nothing to clobber — the whole point of dropping the all-or-nothing pre-flight.
func TestAddSkillsPromptDeclinedKeepsExistingAndInstallsFresh(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{".codex", ".cursor"} {
		if err := os.Mkdir(filepath.Join(home, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	existing := staleSkillInstall(t, filepath.Join(home, ".codex"), "old release\n")
	stubSkillConfirm(t, false)

	var buf bytes.Buffer
	// Roots are pinned so the target multi-select is skipped; the overwrite confirm
	// under test runs either way.
	env := addEnvironment{
		homeDir:     func() (string, error) { return "", errors.New("home lookup should not happen") },
		input:       strings.NewReader(""),
		interactive: true,
		skillRoots:  []string{filepath.Join(home, ".codex"), filepath.Join(home, ".cursor")},
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("add skills: %v", err)
	}

	kept, err := os.ReadFile(filepath.Join(existing, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(kept) != "old release\n" {
		t.Errorf("declined prompt overwrote the existing install: %q", kept)
	}
	fresh := filepath.Join(home, ".cursor", "skills", "puzzle", "SKILL.md")
	if !fsFileExists(fresh) {
		t.Errorf("declining should not block the target with no skill (%s)", fresh)
	}
	if out := buf.String(); !strings.Contains(out, "Left as is: "+existing) {
		t.Errorf("output should name what was left alone, got:\n%s", out)
	}
}

// A stamp matching this binary means there is nothing to replace: no prompt, no
// write, and a hint for the reinstall-anyway case.
func TestAddSkillsUpToDateInstallIsSkippedWithoutPrompting(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, ".codex")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	env := addEnvironment{
		homeDir:     func() (string, error) { return "", errors.New("home lookup should not happen") },
		input:       strings.NewReader(""),
		interactive: true,
		skillRoots:  []string{root},
	}

	var buf bytes.Buffer
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("initial add skills: %v", err)
	}
	dest := filepath.Join(root, "skills", "puzzle")
	marker := []byte("edited between installs\n")
	if err := os.WriteFile(filepath.Join(dest, "SKILL.md"), marker, 0o644); err != nil {
		t.Fatal(err)
	}

	calls := stubSkillConfirm(t, true)
	buf.Reset()
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("second add skills: %v", err)
	}
	if *calls != 0 {
		t.Errorf("an up-to-date install must not prompt, called %d times", *calls)
	}
	got, err := os.ReadFile(filepath.Join(dest, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, marker) {
		t.Error("an up-to-date install was rewritten")
	}
	out := buf.String()
	if !strings.Contains(out, "up to date") {
		t.Errorf("expected an up-to-date line, got:\n%s", out)
	}
	if !strings.Contains(out, "puzzle add skills --overwrite") {
		t.Errorf("expected the reinstall-anyway hint, got:\n%s", out)
	}

	// --overwrite is the documented escape, and must not need a version bump.
	buf.Reset()
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", true, env); err != nil {
		t.Fatalf("add skills --overwrite: %v", err)
	}
	restored, err := os.ReadFile(filepath.Join(dest, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, embeddedSkill(t)) {
		t.Error("--overwrite did not reinstall over an up-to-date install")
	}
}

// A symlinked destination is a dev checkout link. Writing through it would rewrite
// files in someone's working tree, so it is reported and skipped — and never
// removed, since RemoveAll on a symlink deletes the link itself.
func TestAddSkillsSkipsSymlinkedDestination(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevation on Windows")
	}
	home := t.TempDir()
	root := filepath.Join(home, ".claude")
	if err := os.MkdirAll(filepath.Join(root, "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	checkout := filepath.Join(t.TempDir(), "puzzle")
	if err := os.MkdirAll(checkout, 0o755); err != nil {
		t.Fatal(err)
	}
	source := []byte("canonical in-repo skill\n")
	if err := os.WriteFile(filepath.Join(checkout, "SKILL.md"), source, 0o644); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(root, "skills", "puzzle")
	if err := os.Symlink(checkout, dest); err != nil {
		t.Fatal(err)
	}

	calls := stubSkillConfirm(t, true)
	var buf bytes.Buffer
	env := addEnvironment{
		homeDir:     func() (string, error) { return "", errors.New("home lookup should not happen") },
		input:       strings.NewReader(""),
		interactive: true,
		skillRoots:  []string{root},
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("add skills: %v", err)
	}
	if *calls != 0 {
		t.Errorf("a symlinked destination must never be offered in the prompt, called %d times", *calls)
	}
	if out := buf.String(); !strings.Contains(out, "is a symlink") {
		t.Errorf("expected the symlink notice, got:\n%s", out)
	}
	got, err := os.ReadFile(filepath.Join(checkout, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, source) {
		t.Error("the linked checkout was rewritten")
	}
	if info, err := os.Lstat(dest); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Errorf("the symlink itself must survive (mode %v, err %v)", info.Mode(), err)
	}
}

// --overwrite still writes through a symlink: explicit intent, and D97's upgrade
// re-exec depends on this shape. It must merge rather than prune, or the link
// would be replaced by a real directory.
func TestAddSkillsOverwriteWritesThroughSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevation on Windows")
	}
	root := filepath.Join(t.TempDir(), ".claude")
	if err := os.MkdirAll(filepath.Join(root, "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	checkout := filepath.Join(t.TempDir(), "puzzle")
	if err := os.MkdirAll(checkout, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(checkout, "SKILL.md"), []byte("stale\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(root, "skills", "puzzle")
	if err := os.Symlink(checkout, dest); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	env := addEnvironment{
		homeDir:     func() (string, error) { return "", errors.New("home lookup should not happen") },
		interactive: false,
		skillRoots:  []string{root},
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", true, env); err != nil {
		t.Fatalf("add skills --overwrite: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(checkout, "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, embeddedSkill(t)) {
		t.Error("--overwrite did not write through the symlink")
	}
	if info, err := os.Lstat(dest); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Errorf("--overwrite must write through the link, not replace it (mode %v, err %v)", info.Mode(), err)
	}
}

// Reinstalling replaces the tree rather than merging into it: a file the newer
// payload dropped must not survive to contradict the current release.
func TestAddSkillsOverwritePrunesFilesTheEmbeddedTreeDropped(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".codex")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	dest := staleSkillInstall(t, root, "old release\n")
	orphan := filepath.Join(dest, "references", "removed-in-this-release.md")
	if err := os.MkdirAll(filepath.Dir(orphan), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(orphan, []byte("contradicts the current release\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	env := addEnvironment{
		homeDir:     func() (string, error) { return "", errors.New("home lookup should not happen") },
		interactive: false,
		skillRoots:  []string{root},
	}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", true, env); err != nil {
		t.Fatalf("add skills --overwrite: %v", err)
	}
	if fsFileExists(orphan) {
		t.Errorf("%s survived a reinstall", orphan)
	}
	if !fsFileExists(filepath.Join(dest, "SKILL.md")) {
		t.Error("prune removed the destination without reinstalling it")
	}
}

func TestInstalledSkillVersionTreatsMissingStampAsUnknown(t *testing.T) {
	dest := t.TempDir()
	if _, ok := installedSkillVersion(dest); ok {
		t.Error("a destination with no stamp must read as unknown")
	}
	if err := os.WriteFile(filepath.Join(dest, skillVersionFile), []byte("  \n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := installedSkillVersion(dest); ok {
		t.Error("a blank stamp must read as unknown, not as version \"\"")
	}
	if err := os.WriteFile(filepath.Join(dest, skillVersionFile), []byte("0.1.2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, ok := installedSkillVersion(dest)
	if !ok || got != "0.1.2" {
		t.Errorf("installedSkillVersion = %q, %v; want 0.1.2, true", got, ok)
	}
}

func TestSkillDestinationLinesNameTheInstalledVersion(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".codex")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	staleSkillInstall(t, root, "old release\n")
	stamped := skillDestinationLines([]skillTarget{{Name: "Codex", Root: root}})
	if len(stamped) != 1 || !strings.Contains(stamped[0], "installed 0.0.1") {
		t.Errorf("prompt line should name the installed version, got %q", stamped)
	}

	unstamped := skillDestinationLines([]skillTarget{{Name: "Cursor", Root: t.TempDir()}})
	if len(unstamped) != 1 || !strings.Contains(unstamped[0], "version unknown") {
		t.Errorf("an unstamped install should read as unknown, got %q", unstamped)
	}
}

func TestCopySkillTreeRecursivelyPreservesFiles(t *testing.T) {
	source := fstest.MapFS{
		"puzzle/SKILL.md":                    {Data: []byte("skill root\n")},
		"puzzle/references/routing/guide.md": {Data: []byte("nested reference\n")},
	}
	dest := filepath.Join(t.TempDir(), "skills", "puzzle")
	if err := copySkillTree(source, "puzzle", dest); err != nil {
		t.Fatalf("copy skill tree: %v", err)
	}

	for rel, want := range map[string]string{
		"SKILL.md":                    "skill root\n",
		"references/routing/guide.md": "nested reference\n",
	} {
		got, err := os.ReadFile(filepath.Join(dest, filepath.FromSlash(rel)))
		if err != nil {
			t.Errorf("read %s: %v", rel, err)
			continue
		}
		if string(got) != want {
			t.Errorf("%s = %q, want %q", rel, got, want)
		}
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

// TestAddPiecesVersionRequiresNpmSource pins the flag's failure mode: the pin is
// applied after the app-root walk-up, so the app dir carries a package.json and
// the only error left to surface is PinNpmSource refusing a directory source.
func TestAddPiecesVersionRequiresNpmSource(t *testing.T) {
	app := t.TempDir()
	if err := os.WriteFile(filepath.Join(app, "package.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	err := runAddWithEnvironment(&buf, plainPrinter(), app, []string{"piece", "button"}, "/some/dir", "0.6.2", false, addEnvironment{})
	if err == nil || !strings.Contains(err.Error(), "only applies to an npm registry source") {
		t.Fatalf("want the PinNpmSource error, got %v", err)
	}
}
