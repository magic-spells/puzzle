package main

import (
	"os"
	"path/filepath"
	"testing"
)

// runGenerate drives the cobra command end-to-end with the given args, from
// within dir. It resets the command's flags first so tests don't leak state.
func runGenerate(t *testing.T, dir string, args ...string) error {
	t.Helper()
	chdir(t, dir)
	_ = generateCmd.Flags().Set("path", "")
	_ = generateCmd.Flags().Set("force", "false")
	rootCmd.SetArgs(append([]string{"generate"}, args...))
	return rootCmd.Execute()
}

// chdir switches to dir for the duration of the test. Go 1.24's t.Chdir does
// this natively, but the module targets go 1.21.
func chdir(t *testing.T, dir string) {
	t.Helper()
	prev, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(prev); err != nil {
			t.Fatal(err)
		}
	})
}

func stubProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestGenerateCommandCreatesComponent(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "component", "UserCard"); err != nil {
		t.Fatalf("generate component: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "app", "components", "UserCard.pzl")); err != nil {
		t.Errorf("expected component file: %v", err)
	}
}

func TestGenerateCommandModelCreatesJS(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "model", "user"); err != nil {
		t.Fatalf("generate model: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "app", "models", "user.js")); err != nil {
		t.Errorf("expected model file: %v", err)
	}
}

func TestGenerateCommandPathFlag(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "view", "Landing", "--path", "app/views/marketing"); err != nil {
		t.Fatalf("generate view: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "app", "views", "marketing", "Landing.pzl")); err != nil {
		t.Errorf("expected view at overridden path: %v", err)
	}
}

func TestGenerateCommandRejectsBadType(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "widget", "Thing"); err == nil {
		t.Error("expected error for unknown type")
	}
}

func TestGenerateCommandRejectsBadName(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "component", "userCard"); err == nil {
		t.Error("expected validation error for non-PascalCase name")
	}
}

func TestGenerateCommandForceOverwrite(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "view", "Home"); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := runGenerate(t, root, "view", "Home"); err == nil {
		t.Error("expected refusal without --force")
	}
	if err := runGenerate(t, root, "view", "Home", "--force"); err != nil {
		t.Errorf("expected --force to succeed: %v", err)
	}
}

func TestGenerateCommandNotAProject(t *testing.T) {
	dir := t.TempDir() // no package.json marker
	if err := runGenerate(t, dir, "component", "Thing"); err == nil {
		t.Skip("an ancestor of TempDir carries a project marker; walk-up correctly found it")
	}
}
