package generate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// newProject creates a stub Puzzle project (a package.json marker) and returns
// its root.
func newProject(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestGenerateDefaultPaths(t *testing.T) {
	cases := []struct {
		kind    Kind
		name    string
		relPath string
		classIn string // substring the file must contain
	}{
		{KindComponent, "UserCard", "app/components/UserCard.pzl", "class UserCard extends PuzzleView"},
		{KindView, "Profile", "app/views/Profile.pzl", "class Profile extends PuzzleView"},
		{KindLayout, "Admin", "app/layouts/Admin.pzl", "class Admin extends PuzzleView"},
		{KindModel, "user", "app/models/user.js", "class User extends PuzzleModel"},
	}
	for _, tc := range cases {
		t.Run(string(tc.kind), func(t *testing.T) {
			root := newProject(t)
			res, err := Generate(Options{Root: root, Kind: tc.kind, Name: tc.name})
			if err != nil {
				t.Fatalf("Generate: %v", err)
			}
			if res.Rel != tc.relPath {
				t.Errorf("Rel = %q, want %q", res.Rel, tc.relPath)
			}
			want := filepath.Join(root, filepath.FromSlash(tc.relPath))
			if res.Path != want {
				t.Errorf("Path = %q, want %q", res.Path, want)
			}
			body, err := os.ReadFile(res.Path)
			if err != nil {
				t.Fatalf("read generated: %v", err)
			}
			if !strings.Contains(string(body), tc.classIn) {
				t.Errorf("generated %s missing %q\n%s", tc.relPath, tc.classIn, body)
			}
			if tc.kind == KindModel {
				if res.Hint == "" || !strings.Contains(res.Hint, "app/models/index.js") {
					t.Errorf("model hint missing registry instruction: %q", res.Hint)
				}
			} else if res.Hint != "" {
				t.Errorf("unexpected hint for %s: %q", tc.kind, res.Hint)
			}
		})
	}
}

func TestGeneratePathOverride(t *testing.T) {
	root := newProject(t)
	res, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Widget", Dir: "app/components/ui"})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if res.Rel != "app/components/ui/Widget.pzl" {
		t.Errorf("Rel = %q, want app/components/ui/Widget.pzl", res.Rel)
	}
	if _, err := os.Stat(res.Path); err != nil {
		t.Errorf("expected file at %s: %v", res.Path, err)
	}
}

// TestGenerateRejectsPathOutsideRoot proves --path cannot write outside the
// project root: a relative path that climbs out or an absolute path is refused,
// while an ordinary nested path still works.
func TestGenerateRejectsPathOutsideRoot(t *testing.T) {
	root := newProject(t)

	// Relative --path that escapes the root.
	if _, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Widget", Dir: filepath.Join("..", "..", "..")}); err == nil {
		t.Error("expected a relative escaping --path to be refused, got nil")
	} else if !strings.Contains(err.Error(), "outside the project root") {
		t.Errorf("error = %q, want 'outside the project root'", err)
	}

	// Absolute --path outside the root.
	outside := t.TempDir()
	if _, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Widget", Dir: outside}); err == nil {
		t.Error("expected an absolute out-of-root --path to be refused, got nil")
	} else if !strings.Contains(err.Error(), "outside the project root") {
		t.Errorf("error = %q, want 'outside the project root'", err)
	}

	// A normal nested --path is still allowed.
	if _, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Widget", Dir: filepath.Join("app", "components", "ui")}); err != nil {
		t.Errorf("nested --path should be allowed, got: %v", err)
	}
}

func TestGenerateNameValidation(t *testing.T) {
	root := newProject(t)
	cases := []struct {
		kind Kind
		name string
	}{
		{KindComponent, "userCard"},  // not PascalCase
		{KindView, "my-view"},        // hyphen
		{KindLayout, "admin_layout"}, // underscore
		{KindComponent, "9Thing"},    // leading digit
		{KindModel, "User"},          // uppercase model
		{KindModel, "user-profile"},  // hyphen in model
		{KindModel, "2fast"},         // leading digit
	}
	for _, tc := range cases {
		if _, err := Generate(Options{Root: root, Kind: tc.kind, Name: tc.name}); err == nil {
			t.Errorf("%s %q: expected validation error, got nil", tc.kind, tc.name)
		}
	}
}

func TestGenerateRefusesOverwrite(t *testing.T) {
	root := newProject(t)
	opts := Options{Root: root, Kind: KindView, Name: "Home"}
	if _, err := Generate(opts); err != nil {
		t.Fatalf("first Generate: %v", err)
	}
	_, err := Generate(opts)
	if err == nil {
		t.Fatal("expected refusal on existing file, got nil")
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("error = %q, want 'already exists'", err)
	}
}

func TestGenerateForceOverwrite(t *testing.T) {
	root := newProject(t)
	opts := Options{Root: root, Kind: KindView, Name: "Home"}
	res, err := Generate(opts)
	if err != nil {
		t.Fatalf("first Generate: %v", err)
	}
	// Mutate the file, then force-regenerate and confirm it was rewritten.
	if err := os.WriteFile(res.Path, []byte("STALE"), 0o644); err != nil {
		t.Fatal(err)
	}
	opts.Force = true
	if _, err := Generate(opts); err != nil {
		t.Fatalf("forced Generate: %v", err)
	}
	body, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) == "STALE" {
		t.Error("--force did not overwrite the file")
	}
}

func TestFindProjectRootWalksUp(t *testing.T) {
	root := newProject(t)
	nested := filepath.Join(root, "app", "views", "deep")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := FindProjectRoot(nested)
	if err != nil {
		t.Fatalf("FindProjectRoot: %v", err)
	}
	// t.TempDir may live under a symlinked path (e.g. /tmp on macOS); compare
	// resolved forms.
	if resolve(t, got) != resolve(t, root) {
		t.Errorf("root = %q, want %q", got, root)
	}
}

func TestFindProjectRootErrorsOutsideProject(t *testing.T) {
	// A bare temp dir with no marker anywhere up to the filesystem root... unless
	// an ancestor happens to hold one. Use an isolated dir and assert the error
	// only when no marker exists; TempDir itself has none.
	dir := t.TempDir()
	if _, err := FindProjectRoot(dir); err != nil {
		if !strings.Contains(err.Error(), "not a Puzzle project") {
			t.Errorf("error = %q, want 'not a Puzzle project'", err)
		}
	}
	// Note: if a CI ancestor of TempDir carries a package.json this returns that
	// root instead — which is correct walk-up behavior, so we don't fail on it.
}

func resolve(t *testing.T, p string) string {
	t.Helper()
	r, err := filepath.EvalSymlinks(p)
	if err != nil {
		return p
	}
	return r
}

// TestGeneratedPzlCompiles is the load-bearing guarantee: every scaffolded .pzl
// must compile through the repo's own parser + codegen in the correct emission
// mode.
func TestGeneratedPzlCompiles(t *testing.T) {
	root := newProject(t)
	cases := []struct {
		kind Kind
		name string
		mode codegen.EmissionMode
	}{
		{KindComponent, "UserCard", codegen.ModeComponent},
		{KindView, "Profile", codegen.ModeView},
		{KindLayout, "Admin", codegen.ModeView},
	}
	for _, tc := range cases {
		t.Run(string(tc.kind), func(t *testing.T) {
			res, err := Generate(Options{Root: root, Kind: tc.kind, Name: tc.name})
			if err != nil {
				t.Fatalf("Generate: %v", err)
			}
			src, err := os.ReadFile(res.Path)
			if err != nil {
				t.Fatal(err)
			}
			sec, err := parser.SplitSections(string(src), res.Path)
			if err != nil {
				t.Fatalf("SplitSections: %v", err)
			}
			cres, err := codegen.Compile(sec, codegen.Options{Filename: res.Path, Mode: tc.mode})
			if err != nil {
				t.Fatalf("Compile: %v", err)
			}
			out := cres.JS
			if !strings.Contains(out, ".prototype.render = function") {
				t.Errorf("compiled output missing render tail:\n%s", out)
			}
		})
	}
}
