package check

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "regenerate golden files")

func TestGoldens(t *testing.T) {
	inputs, err := filepath.Glob("testdata/*.pzl")
	if err != nil {
		t.Fatal(err)
	}
	if len(inputs) == 0 {
		t.Fatal("no testdata/*.pzl golden inputs found")
	}
	for _, input := range inputs {
		input := input
		name := strings.TrimSuffix(filepath.Base(input), ".pzl")
		t.Run(name, func(t *testing.T) {
			source, err := os.ReadFile(input)
			if err != nil {
				t.Fatal(err)
			}
			sourcePath := "app/views/" + name + ".pzl"
			if strings.HasPrefix(name, "component_") {
				sourcePath = "app/components/" + strings.TrimPrefix(name, "component_") + ".pzl"
			}
			files, err := emitFiles(source, sourcePath, ".puzzle/check/src/"+name+".pzl", "testdata/assets")
			if err != nil {
				t.Fatal(err)
			}
			for _, file := range files {
				ext := filepath.Ext(file.GeneratedPath)
				golden := "testdata/" + name + ".golden" + ext
				if *update {
					if err := os.WriteFile(golden, file.Contents, 0o644); err != nil {
						t.Fatal(err)
					}
					continue
				}
				want, err := os.ReadFile(golden)
				if err != nil {
					t.Fatalf("read golden (run -update?): %v", err)
				}
				if string(file.Contents) != string(want) {
					t.Fatalf("golden mismatch for %s%s\nwant:\n%s\ngot:\n%s", name, ext, want, file.Contents)
				}
			}
		})
	}
}

func TestGenerateWorkspace(t *testing.T) {
	root := t.TempDir()
	view := filepath.Join(root, "app", "nested", "Home.pzl")
	if err := os.MkdirAll(filepath.Dir(view), 0o755); err != nil {
		t.Fatal(err)
	}
	source := `<puzzle-view><div>{ title }</div></puzzle-view>
<script>export default class Home extends Object {}</script>
`
	if err := os.WriteFile(view, []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Generate(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Tables) != 2 {
		t.Fatalf("plain-JS component generated %d segment tables, want 2", len(result.Tables))
	}
	for _, path := range []string{
		filepath.Join(result.Dir, "src", "nested", "Home.pzl.script.js"),
		filepath.Join(result.Dir, "src", "nested", "Home.pzl.script.js.segments.json"),
		filepath.Join(result.Dir, "src", "nested", "Home.pzl.ts"),
		filepath.Join(result.Dir, "src", "nested", "Home.pzl.ts.segments.json"),
		filepath.Join(result.Dir, "puzzle-check.d.ts"),
		filepath.Join(result.Dir, "tsconfig.json"),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Errorf("missing generated file %s: %v", path, err)
		}
	}
	configBytes, err := os.ReadFile(filepath.Join(result.Dir, "tsconfig.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(configBytes, &config); err != nil {
		t.Fatal(err)
	}
	if got := config["extends"]; got != "../../tsconfig.json" {
		t.Errorf("extends = %v, want ../../tsconfig.json", got)
	}
	include := config["include"].([]any)
	for _, want := range []string{"src/**/*.ts", "src/**/*.js"} {
		found := false
		for _, got := range include {
			found = found || got == want
		}
		if !found {
			t.Errorf("include %v is missing %s — both virtual file kinds must reach the program", include, want)
		}
	}
	if config["exclude"] == nil {
		t.Error("exclude must be set to [] so the app's own exclude list cannot drop the virtual workspace")
	}
	shimBytes, err := os.ReadFile(filepath.Join(result.Dir, "puzzle-check.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"puzzle-env", "__puzzle_check_each", "__puzzle_check_snippet"} {
		if !strings.Contains(string(shimBytes), want) {
			t.Errorf("shim missing %q", want)
		}
	}
	// The emitter never writes a marker tag name, so the shim declares none.
	for _, absent := range []string{"const Children", "const Slot", "const Portal", "const Snippet"} {
		if strings.Contains(string(shimBytes), absent) {
			t.Errorf("shim declares %q, which the emitter never names", absent)
		}
	}
}

// Generate clears .puzzle/check wholesale, so a symlinked .puzzle would put
// that RemoveAll outside the app root.
func TestGenerateRejectsSymlinkedScratchRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	marker := filepath.Join(outside, "check", "marker.txt")
	if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("do not delete"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, ".puzzle")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	if _, err := Generate(root); err == nil {
		t.Fatal("Generate accepted a symlinked .puzzle")
	} else if !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("error = %v, want it to name the symbolic link", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("Generate cleared a directory outside the app root: %v", err)
	}
}

// The generated config clears baseUrl and moduleResolution, both removed in
// TypeScript 7, and resolves the @ alias from its own directory. With no app
// tsconfig, strict is off — TypeScript 7 turns it on by default, which
// reported `'__d.stats' is possibly 'undefined'` in a plain-JavaScript app
// (examples/stress).
func TestTsconfigDefaults(t *testing.T) {
	data, err := tsconfig(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if _, ok := config["extends"]; ok {
		t.Fatal("config without app tsconfig must not extend one")
	}
	opts := config["compilerOptions"].(map[string]any)
	for key, want := range map[string]any{
		"noImplicitAny": false,
		"strict":        false,
		"module":        "ESNext",
		"allowJs":       true,
		"checkJs":       false,
	} {
		if got := opts[key]; got != want {
			t.Errorf("%s = %v, want %v", key, got, want)
		}
	}
	for _, key := range []string{"baseUrl", "moduleResolution"} {
		if got, ok := opts[key]; !ok || got != nil {
			t.Errorf("%s = %v (present %v), want an explicit null", key, got, ok)
		}
	}
	paths := opts["paths"].(map[string]any)
	alias := paths["@/*"].([]any)
	if len(alias) != 1 || alias[0] != "../../app/*" {
		t.Errorf("@/* paths = %v, want [../../app/*]", alias)
	}
}

// The generated config writes paths rather than inheriting them, so the app's
// own aliases are merged in, their targets rewritten to resolve from
// .puzzle/check (from the app root, through the app's baseUrl when it set
// one). The @ alias wins a clash, as it does in the build, where esbuild's
// alias beats tsconfig paths. tsconfig's comments and trailing commas are
// tolerated; an unreadable config leaves the @ alias. The app's module and
// allowSyntheticDefaultImports are inherited, not pinned.
func TestTsconfigMergesAppPaths(t *testing.T) {
	jsonc := "\xef\xbb\xbf{\n  // an app alias\n  \"compilerOptions\": {\n    \"module\": \"nodenext\", /* the app's */\n" +
		"    \"paths\": { \"~/*\": [\"./app/*\"], \"http://x/*\": [\"app/x/*\",], },\n  },\n}\n"
	cases := []struct {
		name   string
		config string
		paths  map[string][]string
	}{
		{"jsonc", jsonc, map[string][]string{
			"@/*": {"../../app/*"}, "~/*": {"../../app/*"}, "http://x/*": {"../../app/x/*"},
		}},
		{"baseUrl", `{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["./*"],"lib":["../lib/index.ts"]}}}`, map[string][]string{
			"@/*": {"../../app/*"}, "lib": {"../../lib/index.ts"},
		}},
		{"unparsable", `{"compilerOptions": {"paths": `, map[string][]string{"@/*": {"../../app/*"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(tc.config), 0o644); err != nil {
				t.Fatal(err)
			}
			data, err := tsconfig(root)
			if err != nil {
				t.Fatal(err)
			}
			var config struct {
				Extends         string
				CompilerOptions struct {
					Module    any
					Strict    any
					Synthetic any `json:"allowSyntheticDefaultImports"`
					Paths     map[string][]string
				}
			}
			if err := json.Unmarshal(data, &config); err != nil {
				t.Fatal(err)
			}
			if config.Extends != "../../tsconfig.json" {
				t.Errorf("extends = %q", config.Extends)
			}
			if config.CompilerOptions.Strict != nil {
				t.Errorf("strict = %v, want the app's", config.CompilerOptions.Strict)
			}
			if config.CompilerOptions.Module != nil {
				t.Errorf("module = %v, want the app's", config.CompilerOptions.Module)
			}
			if config.CompilerOptions.Synthetic != nil {
				t.Errorf("allowSyntheticDefaultImports = %v, want the app's", config.CompilerOptions.Synthetic)
			}
			got, _ := json.Marshal(config.CompilerOptions.Paths)
			want, _ := json.Marshal(tc.paths)
			if !bytes.Equal(got, want) {
				t.Errorf("paths = %s, want %s", got, want)
			}
		})
	}
}

func TestEmitJSMirrorPreservesScriptBytes(t *testing.T) {
	script := "\r\nimport { PuzzleView } from '@magic-spells/puzzle';\r\nexport default class CRLF extends PuzzleView {}\r\n"
	source := []byte("<puzzle-view><div>{ title }</div></puzzle-view>\r\n<script>" + script + "</script>\r\n")
	files, err := emitFiles(source, "app/components/CRLF.pzl", ".puzzle/check/src/components/CRLF.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	mirror := virtualFileWithExtension(t, files, ".js")
	if !bytes.Equal(mirror.Contents, []byte(script)) {
		t.Fatalf("JS mirror is not the byte-identical script body\nwant: %q\ngot:  %q", script, mirror.Contents)
	}
	wrapper := virtualFileWithExtension(t, files, ".ts")
	if bytes.Contains(wrapper.Contents, []byte("export default class CRLF")) {
		t.Fatal("checked template wrapper must not contain the JavaScript script body")
	}
	if !bytes.HasPrefix(wrapper.Contents, []byte("import __PuzzleCheckViewClass from \"./CRLF.pzl.script.js\";\n")) {
		t.Fatalf("wrapper import does not point to its JS mirror: %q", wrapper.Contents)
	}
}

func TestEmitPreservesTypeScriptBytes(t *testing.T) {
	script := "\r\nimport { PuzzleView } from '@magic-spells/puzzle';\r\nexport default class CRLF extends PuzzleView {}\r\n"
	source := []byte("<puzzle-view><div>{ title }</div></puzzle-view>\r\n<script lang=\"ts\">" + script + "</script>\r\n")
	files, err := emitFiles(source, "app/components/CRLF.pzl", ".puzzle/check/src/components/CRLF.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatalf("TypeScript component emitted %d files, want 1", len(files))
	}
	if !bytes.HasPrefix(files[0].Contents, []byte(script)) {
		t.Fatalf("virtual file does not begin with the byte-identical script body\nwant prefix: %q\ngot: %q", script, files[0].Contents[:len(script)])
	}
}

// The class name is read back off the compiled render tail; a non-ASCII name
// must come back whole, or the checked wrapper names a class that does not exist.
func TestUnicodeClassNameReachesTheWrapper(t *testing.T) {
	for _, className := range []string{"Übersicht", "概要", "Straßenkarte"} {
		t.Run(className, func(t *testing.T) {
			source := []byte("<puzzle-view><div>{ title }</div></puzzle-view>\n<script lang=\"ts\">\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class " + className + " extends PuzzleView {}\n</script>\n")
			files, err := emitFiles(source, "app/views/V.pzl", ".puzzle/check/src/views/V.pzl", "")
			if err != nil {
				t.Fatal(err)
			}
			if want := "InstanceType<typeof " + className + ">"; !bytes.Contains(files[0].Contents, []byte(want)) {
				t.Fatalf("wrapper does not bind this to %s:\n%s", className, files[0].Contents)
			}
		})
	}
}

func virtualFileWithExtension(t *testing.T, files []virtualFile, ext string) virtualFile {
	t.Helper()
	for _, file := range files {
		if filepath.Ext(file.GeneratedPath) == ext {
			return file
		}
	}
	t.Fatalf("virtual file with extension %s not found", ext)
	return virtualFile{}
}

// The <puzzle-view> tag's own attributes are bindings like any other element's;
// they were silently skipped while only root.Children was walked.
func TestRootAttributeExpressionsAreChecked(t *testing.T) {
	source := []byte(`<puzzle-view class={ rootClass } title="Hi { upper(rootName) }">
  <p>{ body }</p>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`)
	files, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	got := string(files[0].Contents)
	for _, want := range []string{"__d.rootClass", "__d.rootName", "__d.body"} {
		if !strings.Contains(got, want) {
			t.Errorf("generated wrapper is missing %s:\n%s", want, got)
		}
	}
}

// One .pzl the compiler cannot parse must not hide every type error in the rest
// of the app: it is reported as a positioned diagnostic and the walk continues.
func TestUnparsableFileIsReportedAndTheRestStillEmit(t *testing.T) {
	root := t.TempDir()
	views := filepath.Join(root, "app", "views")
	if err := os.MkdirAll(views, 0o755); err != nil {
		t.Fatal(err)
	}
	good := `<puzzle-view><p>{ title }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	if err := os.WriteFile(filepath.Join(views, "Home.pzl"), []byte(good), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(views, "Broken.pzl"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := Generate(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Diagnostics) != 1 || !strings.Contains(result.Diagnostics[0], "Broken.pzl") {
		t.Fatalf("diagnostics = %v, want one positioned error for Broken.pzl", result.Diagnostics)
	}
	if result.Files != 2 {
		t.Errorf("Files = %d, want 2", result.Files)
	}
	if _, err := os.Stat(filepath.Join(result.Dir, "src", "views", "Home.pzl.ts")); err != nil {
		t.Errorf("the parsable view was not emitted: %v", err)
	}
}
