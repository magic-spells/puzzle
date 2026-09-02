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
	result, err := Generate(root, 7)
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

	if _, err := Generate(root, 7); err == nil {
		t.Fatal("Generate accepted a symlinked .puzzle")
	} else if !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("error = %v, want it to name the symbolic link", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("Generate cleared a directory outside the app root: %v", err)
	}
}

func TestTsconfigVersionedDefaults(t *testing.T) {
	cases := []struct {
		name             string
		major            int
		baseURL          any
		moduleResolution any
		aliasTarget      string
	}{
		{"typescript-4", 4, "../..", "node", "app/*"},
		{"typescript-7", 7, nil, nil, "../../app/*"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := tsconfig(t.TempDir(), tc.major)
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
			if got := opts["noImplicitAny"]; got != false {
				t.Errorf("noImplicitAny = %v, want false", got)
			}
			if got := opts["allowJs"]; got != true {
				t.Errorf("allowJs = %v, want true", got)
			}
			if got := opts["checkJs"]; got != false {
				t.Errorf("checkJs = %v, want false", got)
			}
			if got, ok := opts["baseUrl"]; !ok || got != tc.baseURL {
				t.Errorf("baseUrl = %v (present %v), want %v", got, ok, tc.baseURL)
			}
			if got, ok := opts["moduleResolution"]; !ok || got != tc.moduleResolution {
				t.Errorf("moduleResolution = %v (present %v), want %v", got, ok, tc.moduleResolution)
			}
			paths := opts["paths"].(map[string]any)
			alias := paths["@/*"].([]any)
			if len(alias) != 1 || alias[0] != tc.aliasTarget {
				t.Errorf("@/* paths = %v, want [%s]", alias, tc.aliasTarget)
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
	source := []byte(`<puzzle-view class={ rootClass } title="Hi { rootName | upper }">
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
	result, err := Generate(root, 7)
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
