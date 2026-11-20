package check

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// The count is JavaScript's `.length`, typed by lib.d.ts, and `.size` is an
// ordinary member read with no count helper behind it: on a string it is the
// error TypeScript reports, at its authored bytes.
func TestLengthAndSizeFieldTypeCheckWithLiveTSC(t *testing.T) {
	root := liveTSCApp(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	writeLiveView(t, root, `<puzzle-view>
  {#if items.length > 0}<p>{ items.length - 1 } { truncate(name, 4).length + 1 } { file.size.toFixed(0) }</p>{/if}
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
		t.Fatalf(".length and a size field must type-check clean under strict: %v", err)
	}

	bad := `<puzzle-view><p>{ truncate(name, 4).size }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { name = 'ab'; }
</script>
`
	writeLiveView(t, root, bad)
	line, col := pzlPosition(t, bad, "size")
	_, err := Run(root)
	if err == nil {
		t.Fatal("expected .size on a string to be a type error")
	}
	want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'size' does not exist on type 'string'.", line, col)
	if got := err.Error(); got != want {
		t.Fatalf("diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
	}
}
