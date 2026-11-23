package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// a pre-0.10 layout: the router outlet still spelled <Slot/>.
const oldLayout = "<puzzle-view>\n  <main><Slot/></main>\n</puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class Default extends PuzzleView {}\n</script>\n"

// oldApp writes a one-layout app that still needs the 0.10 upgrade.
func oldApp(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	p := filepath.Join(root, "app", "layouts", "Default.pzl")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(oldLayout), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// without --fix, check lists the sites and fails before it type-checks, so CI
// on an un-upgraded app goes red with the command that fixes it.
func TestCheckDryRunFailsWithTheFixCommand(t *testing.T) {
	root := oldApp(t)
	err := runCodemod(root, false, ui.New(os.Stdout))
	if err == nil || !strings.Contains(err.Error(), "run puzzle check --fix") {
		t.Fatalf("err = %v; want a failure naming puzzle check --fix", err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "app", "layouts", "Default.pzl"))
	if string(data) != oldLayout {
		t.Error("a dry run rewrote the layout")
	}
}

// with --fix, check rewrites in place and carries on.
func TestCheckFixRewrites(t *testing.T) {
	root := oldApp(t)
	if err := runCodemod(root, true, ui.New(os.Stdout)); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "app", "layouts", "Default.pzl"))
	if !strings.Contains(string(data), "<main><Outlet/></main>") {
		t.Errorf("layout not rewritten:\n%s", data)
	}
	// a second pass finds nothing, and does not fail
	if err := runCodemod(root, false, ui.New(os.Stdout)); err != nil {
		t.Errorf("dry run after --fix: %v", err)
	}
}

// outside an app, the pass gives the project-root error.
func TestCheckCodemodOutsideAnApp(t *testing.T) {
	err := runCodemod(t.TempDir(), true, ui.New(os.Stdout))
	if err == nil || !strings.Contains(err.Error(), "run puzzle check from a Puzzle project root") {
		t.Errorf("err = %v; want the project-root error", err)
	}
}

// an editor's dotted file is not read; any other file the pass cannot read
// stops puzzle check --fix with its own error, not an unrelated one.
func TestCheckFixReportsWhatStoppedIt(t *testing.T) {
	root := oldApp(t)
	fakeRuntime(t, root, "0.10.0")
	layouts := filepath.Join(root, "app", "layouts")
	if err := os.Symlink("gone", filepath.Join(layouts, ".#Default.pzl")); err != nil {
		t.Skipf("symlinks unsupported here: %v", err)
	}
	if _, err := execRoot(t, "check", "--fix", root); err != nil {
		t.Errorf("an editor lock file stopped the pass: %v", err)
	}
	if err := os.Symlink("gone", filepath.Join(layouts, "Gone.pzl")); err != nil {
		t.Fatal(err)
	}
	if _, err := execRoot(t, "check", "--fix", root); err == nil || !strings.Contains(err.Error(), "Gone.pzl") {
		t.Errorf("a file the pass cannot read: err = %v, want its error", err)
	}
}

// a CLI across a breaking release from the project's install stops before the
// upgrade pass rewrites anything: the code would no longer fit the runtime.
func TestCheckFixStopsOnAMismatchedInstall(t *testing.T) {
	t.Setenv(build.RuntimeEnvVar, "")
	root := oldApp(t)
	fakeRuntime(t, root, "0.9.0")
	if _, err := execRoot(t, "check", "--fix", root); err == nil || !strings.Contains(err.Error(), "Puzzle 0.9.0 installed") {
		t.Errorf("err = %v, want the version-pair stop", err)
	}
	if got, _ := os.ReadFile(filepath.Join(root, "app", "layouts", "Default.pzl")); string(got) != oldLayout {
		t.Errorf("the layout was rewritten:\n%s", got)
	}
}
