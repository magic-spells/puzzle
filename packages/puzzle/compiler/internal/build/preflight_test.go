package build

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
