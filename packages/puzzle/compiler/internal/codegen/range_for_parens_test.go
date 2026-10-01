package codegen

import (
	"strings"
	"testing"
)

// range_for_parens_test.go — range {#for} bounds are ARGUMENTS to the runtime's
// loopRange (`__r(<from>, <to>)`, D173 V12), so a composite from/to
// (`start + 1`, `a || b`, a ternary) binds as one operand without the
// parenthesization the old textual `Array.from({ length: <to> - <from> + 1 })`
// splice needed — left-associative minus does not distribute, and that splice
// once miscounted `a - 2 ... b`.

func TestRangeForParenthesizesBounds(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for start + 1...end - 2, n}
    <span>{ n }</span>
  {/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {
  data() { return { start: 0, end: 5 }; }
}
</script>
`)
	if !strings.Contains(got, "__r(__d.start + 1, __d.end - 2).map((n) =>") {
		t.Errorf("composite range bounds must reach loopRange as whole arguments:\n%s", got)
	}
	if !strings.Contains(got, "loopRange as __r") {
		t.Errorf("a range loop must import loopRange:\n%s", got)
	}
}
