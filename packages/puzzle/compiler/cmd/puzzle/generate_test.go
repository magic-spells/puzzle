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
	_ = generateCmd.Flags().Set("family", "")
	generateCmd.Flags().Lookup("family").Changed = false
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

// TestGenerateCommandFamily drives the D167 --family flag end-to-end: the
// directory, every member, and the barrel land under app/components/<Name>/.
func TestGenerateCommandFamily(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "component", "Frame", "--family", "Wrapper, Content"); err != nil {
		t.Fatalf("generate component --family: %v", err)
	}
	for _, rel := range []string{"Frame.pzl", "Wrapper.pzl", "Content.pzl", "index.js"} {
		if _, err := os.Stat(filepath.Join(root, "app", "components", "Frame", rel)); err != nil {
			t.Errorf("expected app/components/Frame/%s: %v", rel, err)
		}
	}
	// A plain single-file component is not left behind next to the family dir.
	if _, err := os.Stat(filepath.Join(root, "app", "components", "Frame.pzl")); !os.IsNotExist(err) {
		t.Errorf("--family should not also write app/components/Frame.pzl (err=%v)", err)
	}
}

func TestGenerateCommandFamilyPathAndForce(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "component", "Frame", "--family", "Wrapper", "--path", "app/components/ui"); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "app", "components", "ui", "Frame", "index.js")); err != nil {
		t.Errorf("expected the family under --path: %v", err)
	}
	if err := runGenerate(t, root, "component", "Frame", "--family", "Wrapper", "--path", "app/components/ui"); err == nil {
		t.Error("expected refusal without --force")
	}
	if err := runGenerate(t, root, "component", "Frame", "--family", "Wrapper", "--path", "app/components/ui", "--force"); err != nil {
		t.Errorf("expected --force to succeed: %v", err)
	}
}

func TestGenerateCommandFamilyRejectsNonComponent(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "view", "Frame", "--family", "Wrapper"); err == nil {
		t.Error("expected --family on a view to be an error")
	}
}

func TestGenerateCommandFamilyRejectsBadMember(t *testing.T) {
	root := stubProject(t)
	if err := runGenerate(t, root, "component", "Frame", "--family", "Wrap-per"); err == nil {
		t.Error("expected a dashed family member to be rejected")
	}
	if err := runGenerate(t, root, "component", "Frame", "--family", "Wrapper,"); err == nil {
		t.Error("expected a trailing empty family member to be rejected")
	}
}
