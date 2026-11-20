package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

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
	ran, err := runCodemod(root, false, ui.New(os.Stdout))
	if !ran || err == nil || !strings.Contains(err.Error(), "run puzzle check --fix") {
		t.Fatalf("ran = %v, err = %v; want a failure naming puzzle check --fix", ran, err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "app", "layouts", "Default.pzl"))
	if string(data) != oldLayout {
		t.Error("a dry run rewrote the layout")
	}
}

// with --fix, check rewrites in place and carries on.
func TestCheckFixRewrites(t *testing.T) {
	root := oldApp(t)
	ran, err := runCodemod(root, true, ui.New(os.Stdout))
	if !ran || err != nil {
		t.Fatalf("ran = %v, err = %v", ran, err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "app", "layouts", "Default.pzl"))
	if !strings.Contains(string(data), "<main><Outlet/></main>") {
		t.Errorf("layout not rewritten:\n%s", data)
	}
	// a second pass finds nothing, and does not fail
	if _, err := runCodemod(root, false, ui.New(os.Stdout)); err != nil {
		t.Errorf("dry run after --fix: %v", err)
	}
}

// outside an app, the pass steps aside so check gives its own project-root
// error.
func TestCheckCodemodOutsideAnApp(t *testing.T) {
	ran, err := runCodemod(t.TempDir(), true, ui.New(os.Stdout))
	if ran || err != nil {
		t.Errorf("ran = %v, err = %v; want false, nil", ran, err)
	}
}
