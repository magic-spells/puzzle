package styles

import (
	"os"
	"path/filepath"
	"testing"
)

// fakeNodeModules lays down a node_modules tree under root per the flags.
func fakeNodeModules(t *testing.T, root string, v4, v3 bool) {
	t.Helper()
	if v4 {
		cliDir := filepath.Join(root, "node_modules", "@tailwindcss", "cli")
		distDir := filepath.Join(cliDir, "dist")
		if err := os.MkdirAll(distDir, 0o755); err != nil {
			t.Fatal(err)
		}
		pkg := `{"name":"@tailwindcss/cli","bin":{"tailwindcss":"./dist/index.mjs"}}`
		if err := os.WriteFile(filepath.Join(cliDir, "package.json"), []byte(pkg), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(distDir, "index.mjs"), []byte("// fake cli\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if v3 {
		binDir := filepath.Join(root, "node_modules", ".bin")
		if err := os.MkdirAll(binDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(binDir, "tailwindcss"), []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func TestResolveCLIs(t *testing.T) {
	t.Run("v4 direct then npx", func(t *testing.T) {
		root := t.TempDir()
		fakeNodeModules(t, root, true, false)
		clis := resolveCLIs(root)
		// First: direct v4 via node. Then two npx fallbacks.
		if len(clis) != 3 {
			t.Fatalf("want 3 CLIs (v4 direct + 2 npx), got %d: %+v", len(clis), clis)
		}
		if clis[0].Exec != "node" {
			t.Errorf("first CLI exec = %q, want node", clis[0].Exec)
		}
		wantScript := filepath.Join(root, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs")
		if len(clis[0].Args) != 1 || clis[0].Args[0] != wantScript {
			t.Errorf("first CLI args = %v, want [%s]", clis[0].Args, wantScript)
		}
		if clis[1].Exec != "npx" || clis[2].Exec != "npx" {
			t.Errorf("expected npx fallbacks after direct, got %+v", clis[1:])
		}
	})

	t.Run("v3 direct then npx", func(t *testing.T) {
		root := t.TempDir()
		fakeNodeModules(t, root, false, true)
		clis := resolveCLIs(root)
		if len(clis) != 3 {
			t.Fatalf("want 3 CLIs (v3 direct + 2 npx), got %d: %+v", len(clis), clis)
		}
		wantBin := filepath.Join(root, "node_modules", ".bin", "tailwindcss")
		if clis[0].Exec != wantBin {
			t.Errorf("first CLI exec = %q, want %s", clis[0].Exec, wantBin)
		}
		if len(clis[0].Args) != 0 {
			t.Errorf("v3 .bin CLI should take no leading args, got %v", clis[0].Args)
		}
	})

	t.Run("both v4 and v3 direct, v4 first", func(t *testing.T) {
		root := t.TempDir()
		fakeNodeModules(t, root, true, true)
		clis := resolveCLIs(root)
		if len(clis) != 4 {
			t.Fatalf("want 4 CLIs (v4 + v3 + 2 npx), got %d: %+v", len(clis), clis)
		}
		if clis[0].Exec != "node" {
			t.Errorf("v4 direct must come first, got %+v", clis[0])
		}
		if clis[1].Exec == "npx" {
			t.Errorf("v3 direct must precede npx, got %+v", clis[1])
		}
	})

	t.Run("none installed: npx only", func(t *testing.T) {
		root := t.TempDir()
		clis := resolveCLIs(root)
		if len(clis) != 2 {
			t.Fatalf("want 2 npx CLIs, got %d: %+v", len(clis), clis)
		}
		for _, c := range clis {
			if c.Exec != "npx" {
				t.Errorf("expected only npx fallbacks, got %+v", c)
			}
		}
	})

	t.Run("walks up to a parent node_modules", func(t *testing.T) {
		root := t.TempDir()
		fakeNodeModules(t, root, true, false)
		// Resolve from a nested app dir; the install lives at the ancestor.
		nested := filepath.Join(root, "packages", "app")
		if err := os.MkdirAll(nested, 0o755); err != nil {
			t.Fatal(err)
		}
		clis := resolveCLIs(nested)
		if clis[0].Exec != "node" {
			t.Fatalf("expected walk-up to resolve the parent's v4 CLI, got %+v", clis[0])
		}
	})

	t.Run("bin as a bare string", func(t *testing.T) {
		root := t.TempDir()
		cliDir := filepath.Join(root, "node_modules", "@tailwindcss", "cli")
		distDir := filepath.Join(cliDir, "dist")
		if err := os.MkdirAll(distDir, 0o755); err != nil {
			t.Fatal(err)
		}
		pkg := `{"name":"@tailwindcss/cli","bin":"./dist/index.mjs"}`
		if err := os.WriteFile(filepath.Join(cliDir, "package.json"), []byte(pkg), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(distDir, "index.mjs"), []byte("// fake\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		clis := resolveCLIs(root)
		if clis[0].Exec != "node" || filepath.Base(clis[0].Args[0]) != "index.mjs" {
			t.Errorf("string-form bin not resolved, got %+v", clis[0])
		}
	})

	t.Run("bin points at a missing script: skip direct", func(t *testing.T) {
		root := t.TempDir()
		cliDir := filepath.Join(root, "node_modules", "@tailwindcss", "cli")
		if err := os.MkdirAll(cliDir, 0o755); err != nil {
			t.Fatal(err)
		}
		// package.json declares a bin that does not exist on disk.
		pkg := `{"name":"@tailwindcss/cli","bin":{"tailwindcss":"./dist/index.mjs"}}`
		if err := os.WriteFile(filepath.Join(cliDir, "package.json"), []byte(pkg), 0o644); err != nil {
			t.Fatal(err)
		}
		clis := resolveCLIs(root)
		if len(clis) != 2 || clis[0].Exec != "npx" {
			t.Errorf("missing bin script should be skipped, leaving npx only; got %+v", clis)
		}
	})
}
