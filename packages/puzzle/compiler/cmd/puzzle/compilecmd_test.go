package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
)

// writeApp lays out files (slash paths → contents) under a temp project root,
// marked by its package.json, and returns that root.
func writeApp(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	files["package.json"] = "{}"
	for p, body := range files {
		dest := filepath.Join(root, filepath.FromSlash(p))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(dest, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// the vitest plugin (d194) leans on `puzzle compile` choosing the same emission
// mode the build does: views and layouts get a <puzzle-view> root, everything
// else renders its own single root.
func TestCompileOneFollowsTheDirectoryRule(t *testing.T) {
	body := "<puzzle-view>\n  <p>{ msg }</p>\n</puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class X extends PuzzleView {\n  data() { return { msg: 'hi' }; }\n}\n</script>\n"
	root := writeApp(t, map[string]string{
		"app/views/Page.pzl":      body,
		"app/views/app/Page.pzl":  body,
		"app/layouts/Shell.pzl":   body,
		"app/components/Chip.pzl": body,
	})
	null, _ := os.Open(os.DevNull)
	defer null.Close()

	for _, tc := range []struct {
		path     string
		viewRoot bool
	}{
		{"app/views/Page.pzl", true},
		{"app/views/app/Page.pzl", true},
		{"app/layouts/Shell.pzl", true},
		{"app/components/Chip.pzl", false},
	} {
		js, err := compileOne(filepath.Join(root, filepath.FromSlash(tc.path)), null)
		if err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
		if !strings.Contains(js, "export default class X extends PuzzleView") {
			t.Errorf("%s: the script is not in the module:\n%s", tc.path, js)
		}
		if got := strings.Contains(js, "new ViewNode('puzzle-view'"); got != tc.viewRoot {
			t.Errorf("%s: puzzle-view root = %v, want %v:\n%s", tc.path, got, tc.viewRoot, js)
		}
	}
}

// a lang="ts" script has no bundler behind it here, so its types must be gone
// from what the plugin hands vitest; {#svg} inlines from the nearest app/assets.
func TestCompileOneStripsTypesAndInlinesSVG(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/assets/dot.svg": `<svg viewBox="0 0 2 2"><circle cx="1" cy="1" r="1"/></svg>`,
		"app/components/Dot.pzl": "<puzzle-view>\n  <span>{#svg 'dot.svg'}{ n }</span>\n</puzzle-view>\n\n<script lang=\"ts\">\n" +
			"import { PuzzleView } from '@magic-spells/puzzle';\ninterface Model { n: number }\n" +
			"export default class Dot extends PuzzleView {\n  data(): Model { return { n: 1 }; }\n}\n</script>\n",
	})
	null, _ := os.Open(os.DevNull)
	defer null.Close()

	js, err := compileOne(filepath.Join(root, "app", "components", "Dot.pzl"), null)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(js, "interface Model") || strings.Contains(js, "): Model") {
		t.Errorf("type annotations survived:\n%s", js)
	}
	if !strings.Contains(js, "circle") {
		t.Errorf("the {#svg} asset was not inlined:\n%s", js)
	}
}

// a <style scoped> root stamp is keyed on the file's path from the project
// root, the name the build compiles it under, never the checkout's absolute
// path, so a test sees the markup the build ships on every machine (d59).
func TestCompileOneStampsTheBuildScopeID(t *testing.T) {
	chip := "<puzzle-view>\n  <b>hi</b>\n</puzzle-view>\n\n<style scoped>\nb { color: red; }\n</style>\n"
	root := writeApp(t, map[string]string{
		"app/components/Chip.pzl":     chip,
		"app/components/app/Chip.pzl": chip,
	})
	null, _ := os.Open(os.DevNull)
	defer null.Close()

	for _, name := range []string{"app/components/Chip.pzl", "app/components/app/Chip.pzl"} {
		js, err := compileOne(filepath.Join(root, filepath.FromSlash(name)), null)
		if err != nil {
			t.Fatal(err)
		}
		if want := "data-" + codegen.ScopeID(name); !strings.Contains(js, want) {
			t.Errorf("%s: root stamp is not %s:\n%s", name, want, js)
		}
	}
}

// a broken template fails with the positioned error vitest shows on the import.
func TestCompileOneReportsPositionedErrors(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/components/Bad.pzl": "<puzzle-view>\n  <p>{ msg </p>\n</puzzle-view>\n",
	})
	null, _ := os.Open(os.DevNull)
	defer null.Close()

	path := filepath.Join(root, "app", "components", "Bad.pzl")
	_, err := compileOne(path, null)
	if err == nil {
		t.Fatal("compileOne succeeded on an unclosed interpolation")
	}
	if !strings.Contains(err.Error(), "Bad.pzl:2:") {
		t.Errorf("error is not positioned at the .pzl line: %v", err)
	}
}

// a throw inside a .pzl script names its .pzl line in a test: a js script sits
// at its source line, and a lang="ts" module, which esbuild reprints, carries
// an inline source map back to it. a ts syntax error names the .pzl line too.
func TestCompileOneKeepsScriptLines(t *testing.T) {
	src := "<puzzle-view>\n  <p>{ n }</p>\n</puzzle-view>\n\n<script%s>\nimport { PuzzleView } from '@magic-spells/puzzle';\n" +
		"export default class C extends PuzzleView {\n  data() { return { n: %s }; }\n}\n</script>\n"
	root := writeApp(t, map[string]string{
		"app/components/Js.pzl":  fmt.Sprintf(src, "", "1"),
		"app/components/Ts.pzl":  fmt.Sprintf(src, ` lang="ts"`, "1 as number"),
		"app/components/Bad.pzl": fmt.Sprintf(src, ` lang="ts"`, "1 as"),
	})
	null, _ := os.Open(os.DevNull)
	defer null.Close()
	compile := func(name string) (string, error) {
		return compileOne(filepath.Join(root, "app", "components", name), null)
	}

	js, err := compile("Js.pzl")
	if err != nil {
		t.Fatal(err)
	}
	if line := 1 + strings.Count(js[:strings.Index(js, "export default class C")], "\n"); line != 7 {
		t.Errorf("the class is on module line %d, want its .pzl line 7:\n%s", line, js)
	}
	ts, err := compile("Ts.pzl")
	if err != nil {
		t.Fatal(err)
	}
	// the map names the .pzl the module stands in for, beside it
	_, b64, _ := strings.Cut(ts, "\n//# sourceMappingURL=data:application/json;base64,")
	if m, _ := base64.StdEncoding.DecodeString(strings.TrimSpace(b64)); !strings.Contains(string(m), `"sources": ["Ts.pzl"]`) {
		t.Errorf("the ts module carries no inline source map to Ts.pzl:\n%s", ts)
	}
	if _, err := compile("Bad.pzl"); err == nil || !strings.Contains(err.Error(), "Bad.pzl:8:") {
		t.Errorf("the ts syntax error is not on .pzl line 8: %v", err)
	}
}

// the command exists for the plugin only, so it stays out of `puzzle --help`.
func TestCompileCommandIsHidden(t *testing.T) {
	cmd, _, err := rootCmd.Find([]string{"compile"})
	if err != nil || cmd.Name() != "compile" {
		t.Fatalf("compile command not registered: %v", err)
	}
	if !cmd.Hidden {
		t.Error("compile should be hidden from help")
	}
}
