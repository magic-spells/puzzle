package build

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

// PUZZLE_RUNTIME (RuntimeEnvVar) points '@magic-spells/puzzle' at an explicit
// checkout so a working-tree COMPILER can be run against a working-tree RUNTIME
// in a project that lives outside this repo. These tests pin the precedence and
// the alias fan-out; the end-to-end bundling is already covered by alias_test.go.

// writeFakeRuntime creates the minimal shape envRuntime accepts: a package root
// named "@magic-spells/puzzle" holding client-runtime/index.js.
func writeFakeRuntime(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "client-runtime"), 0o755); err != nil {
		t.Fatalf("mkdir client-runtime: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "client-runtime", "index.js"), []byte("export {};\n"), 0o644); err != nil {
		t.Fatalf("write index.js: %v", err)
	}
	pkg := `{"name":"@magic-spells/puzzle","version":"0.0.0-test"}`
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(pkg), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	return root
}

func configureWithEnv(t *testing.T, runtimeRoot, appRoot string) map[string]string {
	t.Helper()
	if runtimeRoot != "" {
		t.Setenv(RuntimeEnvVar, runtimeRoot)
	}
	opts := &api.BuildOptions{}
	configureRuntime(appRoot, opts, &plugin.Plugin{})
	return opts.Alias
}

// The bare specifier and every subpath export must point INTO the named
// checkout. A partial fan-out is the dangerous case: the app would bundle a
// working-tree core alongside a published /adapter or /router-modes.
func TestRuntimeEnvAliasesEverySubpath(t *testing.T) {
	runtimeRoot := writeFakeRuntime(t)
	alias := configureWithEnv(t, runtimeRoot, t.TempDir())

	want := filepath.Join(runtimeRoot, "client-runtime")
	for _, spec := range []string{
		"@magic-spells/puzzle",
		"@magic-spells/puzzle/adapter",
		"@magic-spells/puzzle/morph",
		"@magic-spells/puzzle/router-modes",
		"@magic-spells/puzzle/ssg",
		"@magic-spells/puzzle/static",
		"@magic-spells/puzzle/fixtures",
	} {
		got, ok := alias[spec]
		if !ok {
			t.Errorf("%s was not aliased — it would resolve through node_modules instead", spec)
			continue
		}
		if rel, err := filepath.Rel(want, got); err != nil || rel == ".." || filepath.IsAbs(rel) {
			t.Errorf("%s aliased outside the named checkout: %s", spec, got)
		}
	}
}

// The env var must beat the in-repo walk, so `PUZZLE_RUNTIME=… puzzle dev` from
// inside this repo still tests the checkout you named rather than this one.
func TestRuntimeEnvBeatsInRepoWalk(t *testing.T) {
	runtimeRoot := writeFakeRuntime(t)
	// An app root nested under a DIFFERENT fake checkout, which is what
	// FindRuntime would otherwise discover by walking up.
	inRepo := writeFakeRuntime(t)
	appRoot := filepath.Join(inRepo, "examples", "app")
	if err := os.MkdirAll(appRoot, 0o755); err != nil {
		t.Fatalf("mkdir app: %v", err)
	}
	if found := FindRuntime(appRoot); found == "" {
		t.Fatal("fixture is wrong: FindRuntime should discover the enclosing checkout")
	}

	alias := configureWithEnv(t, runtimeRoot, appRoot)

	got := alias["@magic-spells/puzzle"]
	if want := filepath.Join(runtimeRoot, "client-runtime", "index.js"); got != want {
		t.Errorf("env var lost to the in-repo walk\n got: %s\nwant: %s", got, want)
	}
}

// Unset must change nothing: an app outside this repo keeps resolving through
// node_modules, with no alias entry at all.
func TestRuntimeEnvUnsetLeavesNodeResolution(t *testing.T) {
	t.Setenv(RuntimeEnvVar, "")
	alias := configureWithEnv(t, "", t.TempDir())

	if got, ok := alias["@magic-spells/puzzle"]; ok {
		t.Errorf("unset %s still aliased the runtime to %s", RuntimeEnvVar, got)
	}
}
