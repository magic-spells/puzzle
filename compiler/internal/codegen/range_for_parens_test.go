package codegen

import (
	"strings"
	"testing"
)

// range_for_parens_test.go — range {#for} bounds are spliced textually into the
// emitted `Array.from({ length: <to> - <from> + 1 }, …)` and `<from> + __i`, so a
// composite from/to must be parenthesized. Without parens, `start + 1 ... end`
// would emit `end - start + 1 + 1` (length off by the `+ 1`) and `start + 1 + __i`
// binds fine but `a - 2 ... b` would emit `b - a - 2 + 1` — left-associative minus
// does not distribute. Parens make each bound a single operand.

func TestRangeForParenthesizesBounds(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for start + 1...end, n}
    <span>{ n }</span>
  {/for}
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {
  data() { return { start: 0, end: 5 }; }
}
</scripts>
`)
	// length: (end) - (start + 1) + 1
	if !strings.Contains(got, "Array.from({ length: (__d.end) - (__d.start + 1) + 1 }") {
		t.Errorf("range length must parenthesize both bounds:\n%s", got)
	}
	// loop value: (start + 1) + __i
	if !strings.Contains(got, "(__d.start + 1) + __i") {
		t.Errorf("range loop value must parenthesize the from bound:\n%s", got)
	}
}
