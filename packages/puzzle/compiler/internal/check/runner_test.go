package check

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
	input := filepath.ToSlash(generatedPath) + "(" + itoa(line) + "," + itoa(column) + "): error TS2339: Property 'toUpperCase' does not exist on type 'number'.\n" +
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
	input := mirror.GeneratedPath + "(" + itoa(line) + "," + itoa(column) + "): error TS2339: fabricated JS diagnostic\n"
	got := remapTSCOutput(root, input, tables)
	want := "app/views/Home.pzl:6:18: fabricated JS diagnostic\n"
	if got != want {
		t.Fatalf("remapped JS output mismatch\nwant:\n%s\ngot:\n%s", want, got)
	}
}

func TestMissingTSCMessage(t *testing.T) {
	err := Run(t.TempDir())
	if err == nil {
		t.Fatal("expected missing TypeScript error")
	}
	if got := err.Error(); got != missingTypeScriptMessage {
		t.Fatalf("error = %q, want %q", got, missingTypeScriptMessage)
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

	err := Run(root)
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

	if err := Run(root); err != nil {
		t.Fatalf("type-suspicious legal JavaScript must remain unchecked by default: %v", err)
	}
}

func TestPlainJSTemplateErrorsAreReported(t *testing.T) {
	root := liveTSCApp(t)
	writeLiveView(t, root, plainJSComponent("value.toUpperCase()"))

	err := Run(root)
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

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits [20]byte
	i := len(digits)
	for n > 0 {
		i--
		digits[i] = byte('0' + n%10)
		n /= 10
	}
	return string(digits[i:])
}
