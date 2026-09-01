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

func TestGenerateRejectsDestinationThroughEscapingSymlink(t *testing.T) {
	root := newProject(t)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "linked")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	_, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Escape", Dir: "linked"})
	if err == nil {
		t.Fatal("expected an escaping destination symlink to be refused")
	}
	if !strings.Contains(err.Error(), "refusing to write outside the project root") {
		t.Fatalf("error = %q, want the existing outside-project refusal", err)
	}
	if _, err := os.Stat(filepath.Join(outside, "Escape.pzl")); !os.IsNotExist(err) {
		t.Errorf("generated file escaped through the destination symlink (err=%v)", err)
	}
}

func TestGenerateAllowsContainedDestinationSymlink(t *testing.T) {
	root := newProject(t)
	target := filepath.Join(root, "app", "components", "shared")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "linked")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	if _, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Linked", Dir: "linked"}); err != nil {
		t.Fatalf("contained destination symlink should be allowed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "Linked.pzl")); err != nil {
		t.Errorf("expected generated file through contained symlink: %v", err)
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
		{KindComponent, "Slot"},      // reserved composition marker (D134)
		{KindComponent, "Children"},  // reserved composition marker (D134)
		{KindComponent, "Snippet"},   // reserved composition marker (D134)
		{KindComponent, "Portal"},    // reserved composition marker (D134)
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

// TestGenerateFamily covers the D167 family scaffold: a directory named after the
// root component holding one .pzl per member plus the index.js barrel.
func TestGenerateFamily(t *testing.T) {
	root := newProject(t)
	res, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Wrapper", "Content"}})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if res.Rel != "app/components/Frame" {
		t.Errorf("Rel = %q, want app/components/Frame", res.Rel)
	}
	wantFiles := []string{
		"app/components/Frame/Frame.pzl",
		"app/components/Frame/Wrapper.pzl",
		"app/components/Frame/Content.pzl",
		"app/components/Frame/index.js",
	}
	if len(res.Files) != len(wantFiles) {
		t.Fatalf("Files = %v, want %v", res.Files, wantFiles)
	}
	for i, want := range wantFiles {
		if res.Files[i] != want {
			t.Errorf("Files[%d] = %q, want %q", i, res.Files[i], want)
		}
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(want))); err != nil {
			t.Errorf("expected %s on disk: %v", want, err)
		}
	}

	// Each member .pzl is the ordinary component stub named for that member.
	for _, name := range []string{"Frame", "Wrapper", "Content"} {
		body, err := os.ReadFile(filepath.Join(root, "app", "components", "Frame", name+".pzl"))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), "class "+name+" extends PuzzleView") {
			t.Errorf("%s.pzl is not the component stub for %s:\n%s", name, name, body)
		}
		// Every family member — the root included — must forward its children, or
		// the nesting the family exists for renders nothing.
		if !strings.Contains(string(body), "<Children/>") {
			t.Errorf("%s.pzl must carry <Children/> so family nesting renders:\n%s", name, body)
		}
	}

	barrel, err := os.ReadFile(filepath.Join(root, "app", "components", "Frame", "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	want := `import Frame from './Frame.pzl';
import Wrapper from './Wrapper.pzl';
import Content from './Content.pzl';

export { Frame, Wrapper, Content };
export default Object.assign(Frame, { Wrapper, Content });
`
	if string(barrel) != want {
		t.Errorf("index.js barrel:\ngot:\n%s\nwant:\n%s", barrel, want)
	}
	if !strings.Contains(res.Hint, "<Frame><Frame.Wrapper>") {
		t.Errorf("family hint missing the dot-notation example: %q", res.Hint)
	}
}

func TestGenerateFamilyPathOverride(t *testing.T) {
	root := newProject(t)
	res, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Frame", Dir: "app/components/ui", Family: []string{"Wrapper"}})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if res.Rel != "app/components/ui/Frame" {
		t.Errorf("Rel = %q, want app/components/ui/Frame", res.Rel)
	}
	if _, err := os.Stat(filepath.Join(root, "app", "components", "ui", "Frame", "index.js")); err != nil {
		t.Errorf("expected barrel under the overridden path: %v", err)
	}
}

func TestGenerateFamilyRejectsPathOutsideRoot(t *testing.T) {
	root := newProject(t)
	_, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Frame", Dir: filepath.Join("..", "..", ".."), Family: []string{"Wrapper"}})
	if err == nil {
		t.Fatal("expected an escaping --path to be refused")
	}
	if !strings.Contains(err.Error(), "outside the project root") {
		t.Errorf("error = %q, want 'outside the project root'", err)
	}
}

func TestGenerateFamilyValidation(t *testing.T) {
	root := newProject(t)
	cases := []struct {
		name       string
		opts       Options
		wantSubstr string
	}{
		{
			name:       "non-component kind",
			opts:       Options{Root: root, Kind: KindView, Name: "Frame", Family: []string{"Wrapper"}},
			wantSubstr: "--family is only valid for a component",
		},
		{
			name:       "lower-case member",
			opts:       Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"wrapper"}},
			wantSubstr: "must be PascalCase",
		},
		{
			name:       "dashed member",
			opts:       Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Wrap-per"}},
			wantSubstr: "must be PascalCase",
		},
		{
			name:       "empty member",
			opts:       Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Wrapper", ""}},
			wantSubstr: "empty family member name",
		},
		{
			name:       "member collides with root",
			opts:       Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Frame"}},
			wantSubstr: "collides with the family root",
		},
		{
			name:       "duplicate members",
			opts:       Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Wrapper", "Wrapper"}},
			wantSubstr: "duplicate family member",
		},
		{
			name:       "reserved marker member",
			opts:       Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Slot"}},
			wantSubstr: "reserved composition marker",
		},
		{
			name:       "reserved marker root",
			opts:       Options{Root: root, Kind: KindComponent, Name: "Portal", Family: []string{"Layer"}},
			wantSubstr: "reserved composition marker",
		},
		{
			name:       "non-PascalCase root",
			opts:       Options{Root: root, Kind: KindComponent, Name: "frame", Family: []string{"Wrapper"}},
			wantSubstr: "must be PascalCase",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Generate(tc.opts)
			if err == nil {
				t.Fatal("expected a validation error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Errorf("error = %q, want it to contain %q", err, tc.wantSubstr)
			}
		})
	}
}

// TestGenerateFamilyCollisionIsAllOrNothing pins the --force semantics: without
// it a family whose ANY destination exists is refused and NOTHING is written;
// with it the family's own files are rewritten and unrelated files in the
// directory survive.
func TestGenerateFamilyCollisionIsAllOrNothing(t *testing.T) {
	root := newProject(t)
	opts := Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Wrapper", "Content"}}
	if _, err := Generate(opts); err != nil {
		t.Fatalf("first Generate: %v", err)
	}

	dir := filepath.Join(root, "app", "components", "Frame")
	// A hand-written sibling that is not part of the family.
	keep := filepath.Join(dir, "Frame.css")
	if err := os.WriteFile(keep, []byte(".frame {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Remove one member so only SOME destinations collide, then confirm the
	// refusal writes nothing back.
	if err := os.Remove(filepath.Join(dir, "Content.pzl")); err != nil {
		t.Fatal(err)
	}
	if _, err := Generate(opts); err == nil {
		t.Fatal("expected refusal on an existing family file, got nil")
	} else if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("error = %q, want 'already exists'", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "Content.pzl")); !os.IsNotExist(err) {
		t.Errorf("a refused family must write nothing (Content.pzl reappeared: %v)", err)
	}

	// --force rewrites the family's own files...
	if err := os.WriteFile(filepath.Join(dir, "Wrapper.pzl"), []byte("STALE"), 0o644); err != nil {
		t.Fatal(err)
	}
	opts.Force = true
	if _, err := Generate(opts); err != nil {
		t.Fatalf("forced Generate: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "Wrapper.pzl"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) == "STALE" {
		t.Error("--force did not overwrite an existing family member")
	}
	if _, err := os.Stat(filepath.Join(dir, "Content.pzl")); err != nil {
		t.Errorf("--force should restore the missing member: %v", err)
	}
	// ...and leaves everything else in the directory alone.
	if _, err := os.Stat(keep); err != nil {
		t.Errorf("--force removed an unrelated file in the family directory: %v", err)
	}
}

// TestGeneratedFamilyCompiles is the family half of the compile guarantee: every
// scaffolded member compiles in component mode, and a template invoking the
// family with dot notation compiles to member-expression ViewNode tags.
func TestGeneratedFamilyCompiles(t *testing.T) {
	root := newProject(t)
	res, err := Generate(Options{Root: root, Kind: KindComponent, Name: "Frame", Family: []string{"Wrapper", "Content"}})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	for _, rel := range res.Files {
		if !strings.HasSuffix(rel, ".pzl") {
			continue
		}
		path := filepath.Join(root, filepath.FromSlash(rel))
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sec, err := parser.SplitSections(string(src), path)
		if err != nil {
			t.Fatalf("SplitSections %s: %v", rel, err)
		}
		if _, err := codegen.Compile(sec, codegen.Options{Filename: path, Mode: codegen.ModeComponent}); err != nil {
			t.Fatalf("Compile %s: %v", rel, err)
		}
	}

	caller := `<puzzle-view>
  <Frame>
    <Frame.Wrapper>
      <Frame.Content>hi</Frame.Content>
    </Frame.Wrapper>
  </Frame>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Frame from './components/Frame';

export default class Page extends PuzzleView {
  data() { return {}; }
}
</script>
`
	sec, err := parser.SplitSections(caller, "Page.pzl")
	if err != nil {
		t.Fatalf("SplitSections caller: %v", err)
	}
	out, err := codegen.Compile(sec, codegen.Options{Filename: "Page.pzl", Mode: codegen.ModeView})
	if err != nil {
		t.Fatalf("Compile caller: %v", err)
	}
	for _, want := range []string{"new ViewNode(Frame,", "new ViewNode(Frame.Wrapper,", "new ViewNode(Frame.Content,"} {
		if !strings.Contains(out.JS, want) {
			t.Errorf("caller output missing %q\n%s", want, out.JS)
		}
	}
}

// TestGenerateRejectsMarkerComponentNames pins the D134 guard on the PLAIN
// component scaffold: the compiler matches a marker tag before it resolves a
// component, so a component scaffolded at a marker name could never be invoked.
// Views and layouts are routed by class, never written as tags, so they keep
// the name.
func TestGenerateRejectsMarkerComponentNames(t *testing.T) {
	root := newProject(t)
	for _, name := range []string{"Children", "Slot", "Snippet", "Portal"} {
		t.Run(name, func(t *testing.T) {
			_, err := Generate(Options{Root: root, Kind: KindComponent, Name: name})
			if err == nil {
				t.Fatalf("expected %q to be refused as a component name", name)
			}
			if !strings.Contains(err.Error(), "reserved composition marker") {
				t.Errorf("error = %q, want 'reserved composition marker'", err)
			}
			if _, serr := os.Stat(filepath.Join(root, "app", "components", name+".pzl")); !os.IsNotExist(serr) {
				t.Errorf("a refused marker name must write nothing (err=%v)", serr)
			}
		})
	}
	if _, err := Generate(Options{Root: root, Kind: KindView, Name: "Portal"}); err != nil {
		t.Errorf("a VIEW named Portal is routed by class, not by tag, and must still scaffold: %v", err)
	}
}

// TestGenerateFamilyHintFollowsPath pins the import specifier the hint prints:
// `@` is the alias for the project's app/ directory, so a family under app/ is
// advertised at its real alias path — not the default one — and a family placed
// outside app/ falls back to the project-relative directory instead of an alias
// path that resolves to nothing.
func TestGenerateFamilyHintFollowsPath(t *testing.T) {
	cases := []struct {
		name       string
		dir        string
		root       string
		wantImport string
		wantLead   string
	}{
		{
			name:       "default directory",
			dir:        "",
			root:       "Frame",
			wantImport: "import Frame from '@/components/Frame';",
			wantLead:   "Import the family as one unit:",
		},
		{
			name:       "nested under app",
			dir:        "app/components/ui",
			root:       "Card",
			wantImport: "import Card from '@/components/ui/Card';",
			wantLead:   "Import the family as one unit:",
		},
		{
			name:       "outside app",
			dir:        "lib/widgets",
			root:       "Panel",
			wantImport: "import Panel from 'lib/widgets/Panel';",
			wantLead:   "Import the family as one unit (path shown from the project root):",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			project := newProject(t)
			res, err := Generate(Options{Root: project, Kind: KindComponent, Name: tc.root, Dir: tc.dir, Family: []string{"Body"}})
			if err != nil {
				t.Fatalf("Generate: %v", err)
			}
			if !strings.Contains(res.Hint, tc.wantImport) {
				t.Errorf("hint missing %q:\n%s", tc.wantImport, res.Hint)
			}
			if !strings.Contains(res.Hint, tc.wantLead) {
				t.Errorf("hint missing lead %q:\n%s", tc.wantLead, res.Hint)
			}
			// The default-directory path is the only one the old hardcoded
			// '@/components/<Root>' got right; the others must not print it.
			if tc.dir != "" && strings.Contains(res.Hint, "'@/components/"+tc.root+"'") {
				t.Errorf("hint printed the default alias path for --path %s:\n%s", tc.dir, res.Hint)
			}
		})
	}
}
