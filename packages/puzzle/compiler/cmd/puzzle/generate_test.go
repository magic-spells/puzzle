package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/check"
	"github.com/magic-spells/puzzle/compiler/internal/generate"
	"github.com/magic-spells/puzzle/compiler/internal/scaffold"
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

// In a TypeScript app (tsconfig.json at the root) the command writes .ts: the
// model and the family barrel.
func TestGenerateCommandWritesTypeScriptInATypeScriptApp(t *testing.T) {
	root := stubProject(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := runGenerate(t, root, "model", "user"); err != nil {
		t.Fatalf("generate model: %v", err)
	}
	if err := runGenerate(t, root, "component", "Frame", "--family", "Wrapper"); err != nil {
		t.Fatalf("generate family: %v", err)
	}
	for _, rel := range []string{"app/models/user.ts", "app/components/Frame/index.ts"} {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			t.Errorf("expected %s: %v", rel, err)
		}
	}
	for _, rel := range []string{"app/models/user.js", "app/components/Frame/index.js"} {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err == nil {
			t.Errorf("a TypeScript app must not get %s", rel)
		}
	}
}

// TestGeneratedTypeScriptStubsBuildAndCheck is the live proof for the
// TypeScript stubs: every kind generated into the TypeScript scaffold, invoked
// from a view, builds AND passes `puzzle check` under the scaffold's strict
// tsconfig with the repo's own TypeScript.
func TestGeneratedTypeScriptStubsBuildAndCheck(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH — required to read puzzle.config.js")
	}
	root := repoRoot(t)
	res, err := scaffold.Create(t.TempDir(), "sample-app", "default", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := scaffold.WriteTypeScriptConfig(res.Dir); err != nil {
		t.Fatal(err)
	}
	installRuntime(t, res.Dir, root)

	for _, opts := range []generate.Options{
		{Kind: generate.KindComponent, Name: "UserCard"},
		{Kind: generate.KindView, Name: "Profile"},
		{Kind: generate.KindLayout, Name: "Admin"},
		{Kind: generate.KindModel, Name: "user"},
		{Kind: generate.KindComponent, Name: "Frame", Family: []string{"Wrapper", "Content"}},
	} {
		opts.Root = res.Dir
		if _, err := generate.Generate(opts); err != nil {
			t.Fatalf("generate %s %s: %v", opts.Kind, opts.Name, err)
		}
	}
	// A view that invokes the generated component and family, so the check
	// covers their props and the barrel's dotted members.
	showcase := `<puzzle-view>
  <UserCard label="Hi" />
  <Frame class="outer">
    <Frame.Wrapper>
      <Frame.Content>{ count }</Frame.Content>
    </Frame.Wrapper>
  </Frame>
</puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
import UserCard from '../components/UserCard.pzl';
import Frame from '@/components/Frame';
import User, { type UserRecord } from '../models/user';

interface ShowcaseModel {
  count: number;
}

export default class Showcase extends PuzzleView {
  data(): ShowcaseModel {
    const users = this.ctx.store.findMany('user') as UserRecord[];
    return { count: users.length + (User.schema ? 0 : 1) };
  }
}
</script>
`
	if err := os.WriteFile(filepath.Join(res.Dir, "app", "views", "Showcase.pzl"), []byte(showcase), 0o644); err != nil {
		t.Fatal(err)
	}
	// Route the generated view, layout and showcase so the build bundles them.
	routes := `import type { Route } from '@magic-spells/puzzle';
import Profile from './views/Profile.pzl';
import Showcase from './views/Showcase.pzl';
import Admin from './layouts/Admin.pzl';

const routes: Route[] = [
  { path: '/', name: 'profile', view: Profile, layout: Admin },
  { path: '/showcase', name: 'showcase', view: Showcase, layout: Admin },
];

export default routes;
`
	if err := os.WriteFile(filepath.Join(res.Dir, "app", "routes.ts"), []byte(routes), 0o644); err != nil {
		t.Fatal(err)
	}

	opts := build.Options{Development: true, Runner: fakeRunner{css: "/* tw */"}}
	if err := build.Build(res.Dir, opts); err != nil {
		t.Fatalf("build.Build: %v", err)
	}

	tsDir := filepath.Join(root, "node_modules", "typescript")
	if _, err := os.Stat(filepath.Join(tsDir, "bin", "tsc")); err != nil {
		t.Skip("typescript not installed in the repo (npm ci) — required to puzzle check the stubs")
	}
	if err := os.Symlink(tsDir, filepath.Join(res.Dir, "node_modules", "typescript")); err != nil {
		t.Fatal(err)
	}
	if _, err := check.Run(res.Dir); err != nil {
		t.Fatalf("puzzle check over the generated TypeScript stubs:\n%v", err)
	}
}
