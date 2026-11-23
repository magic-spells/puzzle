package build

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/version"
)

func writePreflightRuntime(t *testing.T, root string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, "client-runtime"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "client-runtime", "index.js"), []byte("export {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"name":"@magic-spells/puzzle"}`), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeInstalledPreflightRuntime(t *testing.T, root string) {
	t.Helper()
	writePreflightRuntime(t, filepath.Join(root, "node_modules", "@magic-spells", "puzzle"))
}

func TestPreflightRuntimeMissingUsesLockfileManager(t *testing.T) {
	root := t.TempDir()
	t.Setenv(RuntimeEnvVar, "")
	if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), nil, 0o644); err != nil {
		t.Fatal(err)
	}

	err := PreflightRuntime(root)
	if err == nil {
		t.Fatal("PreflightRuntime succeeded without a runtime")
	}
	want := "puzzle: @magic-spells/puzzle is not installed in this project.\nRun `pnpm install` and try again."
	if err.Error() != want {
		t.Fatalf("error = %q, want %q", err, want)
	}
}

func TestPreflightRuntimeMissingUsesParentLockfile(t *testing.T) {
	t.Setenv(RuntimeEnvVar, "")
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "yarn.lock"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(workspace, "apps", "site")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	err := PreflightRuntime(root)
	if err == nil {
		t.Fatal("expected preflight error")
	}
	want := "puzzle: @magic-spells/puzzle is not installed in this project.\nRun `yarn install` and try again."
	if err.Error() != want {
		t.Fatalf("unexpected error:\n%s", err.Error())
	}
}

func TestPreflightRuntimeInstalledPackagePasses(t *testing.T) {
	root := t.TempDir()
	t.Setenv(RuntimeEnvVar, "")
	writeInstalledPreflightRuntime(t, root)

	if err := PreflightRuntime(root); err != nil {
		t.Fatalf("PreflightRuntime: %v", err)
	}
}

func TestPreflightRuntimeEnvOverridePasses(t *testing.T) {
	root := t.TempDir()
	runtimeRoot := t.TempDir()
	writePreflightRuntime(t, runtimeRoot)
	t.Setenv(RuntimeEnvVar, runtimeRoot)

	if err := PreflightRuntime(root); err != nil {
		t.Fatalf("PreflightRuntime: %v", err)
	}
}

func TestPreflightRuntimeInRepoExamplePasses(t *testing.T) {
	t.Setenv(RuntimeEnvVar, "")
	root := filepath.Join(repoRoot(t), "examples", "todos")

	if err := PreflightRuntime(root); err != nil {
		t.Fatalf("PreflightRuntime(%q): %v", root, err)
	}
}

func TestPreflightRuntimeGenericMessageIsShort(t *testing.T) {
	root := t.TempDir()
	t.Setenv(RuntimeEnvVar, "")

	err := PreflightRuntime(root)
	if err == nil || !strings.Contains(err.Error(), "Run `npm install` (or your package manager's install)") {
		t.Fatalf("error = %v, want generic install guidance", err)
	}
}

func TestPreflightRuntimeMissingDir(t *testing.T) {
	root := filepath.Join(t.TempDir(), "typo-dir")
	// An env runtime must not paper over the typo either.
	runtimeRoot := t.TempDir()
	writePreflightRuntime(t, runtimeRoot)
	t.Setenv(RuntimeEnvVar, runtimeRoot)
	err := PreflightRuntime(root)
	if err == nil || err.Error() != "puzzle: directory not found: "+root {
		t.Fatalf("error = %v, want a directory-not-found error", err)
	}

	file := filepath.Join(t.TempDir(), "app.js")
	if err := os.WriteFile(file, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := PreflightRuntime(file); err == nil || err.Error() != "puzzle: "+file+" is not a directory" {
		t.Fatalf("error = %v, want a not-a-directory error", err)
	}
}

// installRuntimeVersion installs a runtime under root whose package.json carries v.
func installRuntimeVersion(t *testing.T, root, v string) {
	t.Helper()
	pkg := filepath.Join(root, "node_modules", "@magic-spells", "puzzle")
	writePreflightRuntime(t, pkg)
	if err := os.WriteFile(filepath.Join(pkg, "package.json"), []byte(`{"name":"@magic-spells/puzzle","version":"`+v+`"}`), 0o644); err != nil {
		t.Fatal(err)
	}
}

// cliVersion stands in for the version a release stamps into the binary.
func cliVersion(t *testing.T, v string) {
	t.Helper()
	previous := version.Version
	version.Version = v
	t.Cleanup(func() { version.Version = previous })
}

// An installed runtime on the other side of a breaking release from this CLI
// stops the command, naming both versions and which one to upgrade. A patch
// difference is no mismatch.
func TestPreflightRuntimeVersionPair(t *testing.T) {
	t.Setenv(RuntimeEnvVar, "")
	cliVersion(t, "0.10.2")
	use := "\n  Use the project's own CLI:  npm run dev, npm run build, or npx puzzle <command>\n"
	for installed, want := range map[string]string{
		"0.10.2": "",
		"0.10.1": "",
		"0.9.0":  "This project has Puzzle 0.9.0 installed, and this CLI is 0.10.2." + use + "  Or upgrade the project:     puzzle upgrade",
		"0.11.0": "This project has Puzzle 0.11.0 installed, and this CLI is 0.10.2." + use + "  Or upgrade this CLI:        puzzle upgrade",
	} {
		root := t.TempDir()
		installRuntimeVersion(t, root, installed)
		got := ""
		if err := PreflightRuntime(root); err != nil {
			got = err.Error()
		}
		if got != want {
			t.Errorf("installed %s: error = %q, want %q", installed, got, want)
		}
	}
}

// The two development sources win over node_modules, so an installed runtime
// they shadow is never compared.
func TestPreflightRuntimeVersionPairSkipsDevelopmentSources(t *testing.T) {
	cliVersion(t, "0.10.0")

	app := t.TempDir()
	installRuntimeVersion(t, app, "0.9.0")
	checkout := t.TempDir()
	writePreflightRuntime(t, checkout)
	t.Setenv(RuntimeEnvVar, checkout)
	if err := PreflightRuntime(app); err != nil {
		t.Errorf("%s set: %v", RuntimeEnvVar, err)
	}

	t.Setenv(RuntimeEnvVar, "")
	repo := t.TempDir()
	writePreflightRuntime(t, repo)
	example := filepath.Join(repo, "examples", "todos")
	installRuntimeVersion(t, example, "0.9.0")
	if err := PreflightRuntime(example); err != nil {
		t.Errorf("in-repo app: %v", err)
	}
}
