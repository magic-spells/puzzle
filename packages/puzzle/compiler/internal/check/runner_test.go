package check

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

func TestFabricatedTSCOutputRemapsExactly(t *testing.T) {
	source := []byte(`<puzzle-view>
  <p>{ person.name.toUpperCase() }</p>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  person = { name: 123 };
}
</script>
`)
	root := t.TempDir()
	generatedPath := ".puzzle/check/src/views/Home.pzl.ts"
	files, err := emitFiles(source, "app/views/Home.pzl", strings.TrimSuffix(generatedPath, ".ts"), filepath.Join(root, "app", "assets"))
	if err != nil {
		t.Fatal(err)
	}
	virtual := virtualFileWithExtension(t, files, ".ts")
	offset := strings.LastIndex(string(virtual.Contents), "toUpperCase")
	if offset < 0 {
		t.Fatal("generated output missing toUpperCase")
	}
	line, column := utf16LineColumn(virtual.Contents, offset)
	tables := map[string]*SegmentTable{
		filepath.Join(root, filepath.FromSlash(generatedPath)): virtual.Table,
	}
	input := filepath.ToSlash(generatedPath) + "(" + strconv.Itoa(line) + "," + strconv.Itoa(column) + "): error TS2339: Property 'toUpperCase' does not exist on type 'number'.\n" +
		"app/models/user.ts(4,2): error TS2322: Type 'number' is not assignable to type 'string'.\n"
	got := remapTSCOutput(root, input, tables)
	want := "app/views/Home.pzl:2:20: Property 'toUpperCase' does not exist on type 'number'.\n" +
		"app/models/user.ts(4,2): error TS2322: Type 'number' is not assignable to type 'string'.\n"
	if got != want {
		t.Fatalf("remapped output mismatch\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func TestFabricatedJSMirrorOutputRemapsExactly(t *testing.T) {
	source := []byte(`<puzzle-view><p>{ title }</p></puzzle-view>
<script>
export default class Home extends Object {
  suspicious() {
    const value = 1;
    return value.toUpperCase();
  }
}
</script>
`)
	root := t.TempDir()
	files, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", filepath.Join(root, "app", "assets"))
	if err != nil {
		t.Fatal(err)
	}
	mirror := virtualFileWithExtension(t, files, ".js")
	offset := strings.Index(string(mirror.Contents), "toUpperCase")
	if offset < 0 {
		t.Fatal("JS mirror missing toUpperCase")
	}
	line, column := utf16LineColumn(mirror.Contents, offset)
	tables := map[string]*SegmentTable{
		filepath.Join(root, filepath.FromSlash(mirror.GeneratedPath)): mirror.Table,
	}
	input := mirror.GeneratedPath + "(" + strconv.Itoa(line) + "," + strconv.Itoa(column) + "): error TS2339: fabricated JS diagnostic\n"
	got := remapTSCOutput(root, input, tables)
	want := "app/views/Home.pzl:6:18: fabricated JS diagnostic\n"
	if got != want {
		t.Fatalf("remapped JS output mismatch\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func TestMissingTSCMessage(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "app"), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := Run(root)
	if err == nil {
		t.Fatal("expected missing TypeScript error")
	}
	if got := err.Error(); got != missingTypeScriptMessage {
		t.Fatalf("error = %q, want %q", got, missingTypeScriptMessage)
	}
}

func TestOutsideProjectMessage(t *testing.T) {
	_, err := Run(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "no app/ directory") {
		t.Fatalf("error = %v, want the not-a-Puzzle-project message", err)
	}
}

func TestRunWithLiveTSC(t *testing.T) {
	root := liveTSCApp(t)
	viewDir := filepath.Join(root, "app", "views")
	if err := os.MkdirAll(viewDir, 0o755); err != nil {
		t.Fatal(err)
	}
	source := `<puzzle-view><p>{ value.toUpperCase() }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { value = 123; }
</script>
`
	if err := os.WriteFile(filepath.Join(viewDir, "Home.pzl"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := Run(root)
	if err == nil {
		t.Fatal("expected template type error")
	}
	want := "app/views/Home.pzl:1:25: Property 'toUpperCase' does not exist on type 'number'."
	if got := err.Error(); got != want {
		t.Fatalf("live tsc output mismatch\nwant: %s\ngot:  %s", want, got)
	}
}

func TestPlainJSScriptUncheckedByDefault(t *testing.T) {
	root := liveTSCApp(t)
	writeLiveView(t, root, plainJSComponent("value.toFixed(0)"))

	if _, err := Run(root); err != nil {
		t.Fatalf("type-suspicious legal JavaScript must remain unchecked by default: %v", err)
	}
}

func TestPlainJSTemplateErrorsAreReported(t *testing.T) {
	root := liveTSCApp(t)
	writeLiveView(t, root, plainJSComponent("value.toUpperCase()"))

	_, err := Run(root)
	if err == nil {
		t.Fatal("expected checked template expression to fail")
	}
	want := "app/views/Home.pzl:1:25: Property 'toUpperCase' does not exist on type 'number'."
	if got := err.Error(); got != want {
		t.Fatalf("plain-JS template diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
	}
}

func liveTSCApp(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the local-bin symlink fixture is Unix-only")
	}
	tsc, err := exec.LookPath("tsc")
	if err != nil {
		t.Skip("tsc not available on PATH")
	}
	root := t.TempDir()
	binDir := filepath.Join(root, "node_modules", ".bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	wrapper := fmt.Sprintf("#!/bin/sh\nexec %q \"$@\"\n", tsc)
	if err := os.WriteFile(filepath.Join(binDir, "tsc"), []byte(wrapper), 0o755); err != nil {
		t.Fatal(err)
	}
	packageRoot, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	moduleDir := filepath.Join(root, "node_modules", "@magic-spells")
	if err := os.MkdirAll(moduleDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(packageRoot, filepath.Join(moduleDir, "puzzle")); err != nil {
		t.Fatal(err)
	}
	return root
}

func writeLiveView(t *testing.T, root, source string) {
	t.Helper()
	viewDir := filepath.Join(root, "app", "views")
	if err := os.MkdirAll(viewDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(viewDir, "Home.pzl"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
}

func plainJSComponent(templateExpression string) string {
	return `<puzzle-view><p>{ ` + templateExpression + ` }</p></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  value = 123;

  suspiciousButLegalJS() {
    const value = 1;
    return value.toUpperCase();
  }
}
</script>
`
}

// tsc prints an absolute path whenever the file is not under the cwd it was
// invoked with; the remapper must recognize it the same as the relative form.
func TestRemapTSCOutputAbsolutePath(t *testing.T) {
	root := t.TempDir()
	source := []byte("<puzzle-view><p>{ a }</p></puzzle-view>\n<script lang=\"ts\">\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\n" +
		"export default class Home extends PuzzleView {}\n" +
		"const x = broken;\n</script>\n")
	generatedBase := ".puzzle/check/src/views/Home.pzl"
	files, err := emitFiles(source, "app/views/Home.pzl", generatedBase, "")
	if err != nil {
		t.Fatal(err)
	}
	v := files[0]
	v.Table.generatedBytes = v.Contents
	v.Table.sourceBytes = source
	abs := filepath.Join(root, filepath.FromSlash(generatedBase+".ts"))
	tables := map[string]*SegmentTable{filepath.Clean(abs): v.Table}

	line, column := utf16LineColumn(v.Contents, strings.Index(string(v.Contents), "broken"))
	in := abs + "(" + strconv.Itoa(line) + "," + strconv.Itoa(column) + "): error TS2304: Cannot find name 'broken'.\n"
	got := remapTSCOutput(root, in, tables)
	want := "app/views/Home.pzl:5:11: Cannot find name 'broken'.\n"
	if got != want {
		t.Fatalf("absolute-path diagnostic not remapped\nwant: %q\ngot:  %q", want, got)
	}
}

// A Windows path carries a drive-letter colon inside the file field; the
// diagnostic pattern must still split it correctly (WS1 runs this suite there).
func TestWindowsDriveLetterDiagnosticParses(t *testing.T) {
	line := `C:\proj\.puzzle\check\src\views\Home.pzl.ts(3,11): error TS2304: Cannot find name 'broken'.`
	m := tscDiagnosticRE.FindStringSubmatch(line)
	if m == nil {
		t.Fatal("Windows drive-letter diagnostic did not parse")
	}
	if m[1] != `C:\proj\.puzzle\check\src\views\Home.pzl.ts` || m[2] != "3" || m[3] != "11" {
		t.Fatalf("path/line/col = %q %q %q", m[1], m[2], m[3])
	}
	if m[4] != "Cannot find name 'broken'." {
		t.Fatalf("message = %q", m[4])
	}
}

// The generated tsconfig extends the app's, so any option the app sets reaches
// the check. Each case here made a clean app report failures before the
// generated config started pinning the option down.
func TestAppTsconfigVariantsDoNotBreakTheCheck(t *testing.T) {
	cases := []struct {
		name string
		cfg  string
	}{
		// ".puzzle" in the app's exclude list is rewritten relative to the
		// generated config and would exclude the whole virtual workspace.
		{"exclude-puzzle", `{"compilerOptions":{"strict":true},"exclude":[".puzzle","node_modules"]}`},
		{"composite", `{"compilerOptions":{"composite":true,"strict":true}}`},
		// An app rootDir puts every emitted file outside it (TS6059).
		{"rootDir", `{"compilerOptions":{"rootDir":"app","strict":true}}`},
		{"files", `{"files":["app/other.ts"],"compilerOptions":{"strict":true}}`},
		// Synthetic loop bindings are not authored code.
		{"noUnused", `{"compilerOptions":{"noUnusedLocals":true,"noUnusedParameters":true,"strict":true}}`},
		{"include-only-app", `{"include":["app"],"compilerOptions":{"strict":true}}`},
		{"outDir-dist", `{"compilerOptions":{"outDir":"dist","noEmit":false,"strict":true}}`},
		// A sparse config leaves target/moduleResolution at their ancient
		// defaults, which reports errors inside the framework's own .d.ts files.
		{"sparse", `{"compilerOptions":{"strict":true}}`},
		// TypeScript 7 rejects all three legacy settings. The generated config
		// must replace inherited paths as well as clearing baseUrl and node10.
		{"legacy-resolution", `{"compilerOptions":{"baseUrl":".","module":"CommonJS","moduleResolution":"node","paths":{"@/*":["app/*"],"legacy/*":["app/*"]},"strict":true}}`},
	}
	clean := `<puzzle-view><p>{ value }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { value = 1; }
</script>
`
	unusedLoopBinding := `<puzzle-view>{#for item in items}<p>ok</p>{/for}</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { items = [1, 2]; }
</script>
`
	aliasImport := `<puzzle-view><p>{ value }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
import { value } from '@/models/value';
export default class Home extends PuzzleView { value = value; }
</script>
`
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			root := liveTSCApp(t)
			view := clean
			if tc.name == "noUnused" {
				view = unusedLoopBinding
			} else if tc.name == "legacy-resolution" {
				view = aliasImport
				models := filepath.Join(root, "app", "models")
				if err := os.MkdirAll(models, 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(models, "value.ts"), []byte("export const value = 1;\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			writeLiveView(t, root, view)
			if tc.name == "files" {
				if err := os.WriteFile(filepath.Join(root, "app", "other.ts"), []byte("export const other = 1;\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(tc.cfg), 0o644); err != nil {
				t.Fatal(err)
			}
			if _, err := Run(root); err != nil {
				t.Errorf("a clean app failed under the %s tsconfig:\n%v", tc.name, err)
			}
		})
	}
}
