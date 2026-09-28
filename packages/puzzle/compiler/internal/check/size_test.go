package check

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// size_test.go — D176: a template `.size` is emitted as `__z(value)`, declared
// in the check shim, and a diagnostic after the rewritten step still lands on
// its authored bytes.

func TestSizeStepIsMappedAroundTheHelper(t *testing.T) {
	source := `<puzzle-view><p>{ file?.size.upper }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	files, err := emitFiles([]byte(source), "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	v := virtualFileWithExtension(t, files, ".ts")
	if !strings.Contains(string(v.Contents), "void (__z(__d.file).upper);") {
		t.Fatalf("expected the .size step lowered to __z:\n%s", v.Contents)
	}
	at := strings.LastIndex(string(v.Contents), "upper")
	line, column := utf16LineColumn(v.Contents, at)
	pos, ok := v.Table.Remap(line, column)
	if !ok {
		t.Fatal("the member after .size is unmapped")
	}
	wantLine, wantCol := pzlPosition(t, source, "upper")
	if pos.Line != wantLine || pos.Column != wantCol {
		t.Fatalf("remapped to %d:%d, want %d:%d", pos.Line, pos.Column, wantLine, wantCol)
	}
}

func TestSizeTypeChecksWithLiveTSC(t *testing.T) {
	root := liveTSCApp(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	// A list's and a string's count is a number; an object's size is its field.
	writeLiveView(t, root, `<puzzle-view>
  {#if items.size > 0}<p>{ items.size - 1 } { name.size + 1 } { file.size.toFixed }</p>{/if}
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  items = [1, 2];
  name = 'ab';
  file = { size: 3 };
}
</script>
`)
	if _, err := Run(root); err != nil {
		t.Fatalf(".size must type-check clean under strict: %v", err)
	}

	bad := `<puzzle-view><p>{ file.size.upper }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { file = { size: 3 }; }
</script>
`
	writeLiveView(t, root, bad)
	line, col := pzlPosition(t, bad, "upper")
	_, err := Run(root)
	if err == nil {
		t.Fatal("expected a type error on the member after .size")
	}
	want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'upper' does not exist on type 'number'.", line, col)
	if got := err.Error(); got != want {
		t.Fatalf("diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
	}
}
