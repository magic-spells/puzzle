package generate

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

var update = flag.Bool("update", false, "regenerate golden files")

// goldenScaffolds generates every scaffold kind into a fresh project of the
// given flavor and returns each written file (plus each printed hint) keyed by
// its golden name. The five requests are the same for both flavors, so a JS and
// a TS golden set line up file for file.
func goldenScaffolds(t *testing.T, typescript bool) map[string]string {
	t.Helper()
	root := newProject(t)
	if typescript {
		if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte("{}\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	out := map[string]string{}
	requests := []Options{
		{Kind: KindComponent, Name: "UserCard"},
		{Kind: KindView, Name: "Profile"},
		{Kind: KindLayout, Name: "Admin"},
		{Kind: KindModel, Name: "user"},
		{Kind: KindComponent, Name: "Frame", Family: []string{"Wrapper", "Content"}},
	}
	for _, opts := range requests {
		opts.Root = root
		res, err := Generate(opts)
		if err != nil {
			t.Fatalf("Generate(%s %s): %v", opts.Kind, opts.Name, err)
		}
		for _, rel := range res.Files {
			body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
			if err != nil {
				t.Fatal(err)
			}
			out[strings.ReplaceAll(rel, "/", "__")] = string(body)
		}
		if res.Hint != "" {
			out[string(opts.Kind)+"-"+opts.Name+".hint"] = res.Hint + "\n"
		}
	}
	return out
}

// checkGoldens compares got against testdata/<dir>/ exactly — the file set and
// every byte. -update rewrites the directory.
func checkGoldens(t *testing.T, dir string, got map[string]string) {
	t.Helper()
	goldenDir := filepath.Join("testdata", dir)
	if *update {
		if err := os.RemoveAll(goldenDir); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(goldenDir, 0o755); err != nil {
			t.Fatal(err)
		}
		for name, body := range got {
			if err := os.WriteFile(filepath.Join(goldenDir, name+".golden"), []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		return
	}
	entries, err := os.ReadDir(goldenDir)
	if err != nil {
		t.Fatalf("reading %s (run with -update to create it): %v", goldenDir, err)
	}
	want := map[string]string{}
	for _, e := range entries {
		body, err := os.ReadFile(filepath.Join(goldenDir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		want[strings.TrimSuffix(e.Name(), ".golden")] = string(body)
	}
	for name, body := range want {
		g, ok := got[name]
		if !ok {
			t.Errorf("%s: expected %s, not generated", dir, name)
			continue
		}
		if g != body {
			t.Errorf("%s: %s differs from its golden\n--- got ---\n%s\n--- want ---\n%s", dir, name, g, body)
		}
	}
	for name := range got {
		if _, ok := want[name]; !ok {
			t.Errorf("%s: generated %s, which has no golden", dir, name)
		}
	}
}

// TestGenerateJavaScriptGolden pins a JavaScript app's scaffolds byte for byte:
// the TypeScript mode must never change what a JS app gets.
func TestGenerateJavaScriptGolden(t *testing.T) {
	checkGoldens(t, "js", goldenScaffolds(t, false))
}

// TestGenerateTypeScriptGolden pins what a TypeScript app (tsconfig.json at the
// root) gets: .pzl stubs with <script lang="ts">, app/models/user.ts, and an
// index.ts family barrel, with the hints naming the .ts registry.
func TestGenerateTypeScriptGolden(t *testing.T) {
	got := goldenScaffolds(t, true)
	checkGoldens(t, "ts", got)

	js := goldenScaffolds(t, false)
	for name, body := range got {
		if !strings.HasSuffix(name, ".pzl") {
			continue
		}
		// Only the script is ported: the markup and style match the JS stub.
		if !strings.Contains(body, "\n<script lang=\"ts\">\n") {
			t.Errorf("%s is not a <script lang=\"ts\"> stub", name)
		}
		if strings.Contains(body, "any") {
			t.Errorf("%s types something as any", name)
		}
		markup := func(s string) string { return s[:strings.Index(s, "\n<script")] }
		style := func(s string) string { return s[strings.Index(s, "\n<style>"):] }
		if markup(body) != markup(js[name]) || style(body) != style(js[name]) {
			t.Errorf("%s markup or style differs from the JavaScript stub", name)
		}
	}
	if _, ok := got["app__models__user.ts"]; !ok {
		t.Error("a TypeScript app's model must be app/models/user.ts")
	}
	if _, ok := got["app__components__Frame__index.ts"]; !ok {
		t.Error("a TypeScript app's family barrel must be index.ts")
	}
	if hint := got["model-user.hint"]; !strings.Contains(hint, "app/models/index.ts") {
		t.Errorf("the model hint must point at app/models/index.ts:\n%s", hint)
	}
}

// Every TypeScript .pzl stub compiles through the repo's own parser+codegen in
// its emission mode — components (family members included) inline, views and
// layouts as views. puzzle check over them runs in cmd/puzzle.
func TestGeneratedTypeScriptPzlCompiles(t *testing.T) {
	for name, body := range goldenScaffolds(t, true) {
		if !strings.HasSuffix(name, ".pzl") {
			continue
		}
		mode := codegen.ModeView
		if strings.HasPrefix(name, "app__components__") {
			mode = codegen.ModeComponent
		}
		sec, err := parser.SplitSections(body, name)
		if err != nil {
			t.Fatalf("SplitSections %s: %v", name, err)
		}
		out, err := codegen.Compile(sec, codegen.Options{Filename: name, Mode: mode})
		if err != nil {
			t.Fatalf("Compile %s: %v", name, err)
		}
		if !strings.Contains(out.JS, ".prototype.render = function") {
			t.Errorf("%s: compiled output missing render tail", name)
		}
	}
}

// IsTypeScriptApp is the one rule: a tsconfig.json file at the project root.
func TestIsTypeScriptApp(t *testing.T) {
	root := newProject(t)
	if IsTypeScriptApp(root) {
		t.Error("a project with no tsconfig.json is not a TypeScript app")
	}
	if err := os.WriteFile(filepath.Join(root, "jsconfig.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsTypeScriptApp(root) {
		t.Error("jsconfig.json marks a JavaScript app")
	}
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !IsTypeScriptApp(root) {
		t.Error("tsconfig.json at the root marks a TypeScript app")
	}
}
