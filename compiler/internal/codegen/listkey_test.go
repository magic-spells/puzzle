package codegen

import (
	"strings"
	"testing"
)

// listkey_test.go — D58 list keying. Item-form {#for} rows get a synthetic
// `key: ViewNode.keyOf(<item>)`; an explicit `key` on the body root (element or
// component, static or dynamic, item or range form) suppresses the synthetic
// prepend and the author's expression stands verbatim. Range form without an
// explicit key keeps its number key, byte-identical to pre-v1.26.

func TestForKeyAutoKeyOf(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <ul>{#for item in items}<li>{ item.name }</li>{/for}</ul>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</script>
`)
	if !strings.Contains(got, "key: ViewNode.keyOf(item)") {
		t.Errorf("item-form root without explicit key must emit ViewNode.keyOf(item):\n%s", got)
	}
}

func TestForExplicitKeySuppressesElementRoot(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <ul>{#for item in items}<li key={ item.slug }>{ item.name }</li>{/for}</ul>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</script>
`)
	if strings.Contains(got, "ViewNode.keyOf") {
		t.Errorf("explicit key on element root must suppress the synthetic keyOf:\n%s", got)
	}
	if !strings.Contains(got, "key: item.slug") {
		t.Errorf("author's explicit key expression must stand verbatim:\n%s", got)
	}
	if strings.Count(got, "key:") != 1 {
		t.Errorf("explicit key must not double the key property:\n%s", got)
	}
}

func TestForExplicitStaticKeySuppresses(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <ul>{#for item in items}<li key="row">{ item.name }</li>{/for}</ul>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</script>
`)
	if strings.Contains(got, "ViewNode.keyOf") {
		t.Errorf("explicit static key must suppress the synthetic keyOf:\n%s", got)
	}
	if !strings.Contains(got, "key: 'row'") {
		t.Errorf("explicit static key must stand verbatim:\n%s", got)
	}
}

func TestForExplicitMixedKeySuppresses(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <ul>{#for item in items}<li key="row-{ item.id }">{ item.name }</li>{/for}</ul>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</script>
`)
	// A mixed (template-literal) key is an explicit key too — it must suppress the
	// synthetic keyOf and must not double the key property (D58 / hasKeyAttr).
	if strings.Contains(got, "ViewNode.keyOf") {
		t.Errorf("explicit mixed key must suppress the synthetic keyOf:\n%s", got)
	}
	if strings.Count(got, "key:") != 1 {
		t.Errorf("explicit mixed key must not double the key property:\n%s", got)
	}
	if !strings.Contains(got, "key: `row-${__s(item.id,") {
		t.Errorf("author's mixed key must stand as a template literal:\n%s", got)
	}
}

func TestForExplicitKeySuppressesComponentRoot(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for item in items}<Row key={ item.slug } item={ item } />{/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Row from './Row.pzl';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</script>
`)
	if strings.Contains(got, "ViewNode.keyOf") {
		t.Errorf("explicit key on component root must suppress the synthetic keyOf:\n%s", got)
	}
	if !strings.Contains(got, "key: item.slug") {
		t.Errorf("author's explicit key on component root must stand verbatim:\n%s", got)
	}
	if strings.Count(got, "key:") != 1 {
		t.Errorf("explicit key must not double the key property:\n%s", got)
	}
}

func TestForExplicitKeySuppressesRangeRoot(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for 1...count, n}<span key={ n }>{ n }</span>{/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { count: 3 }; } }
</script>
`)
	// The author's explicit key replaces the synthetic `key: n`; assert no doubling.
	if strings.Count(got, "key:") != 1 {
		t.Errorf("explicit key on range-form root must suppress the synthetic key (no doubling):\n%s", got)
	}
	if strings.Contains(got, "ViewNode.keyOf") {
		t.Errorf("range form never uses keyOf:\n%s", got)
	}
}

// TestRangeFormKeysByValue: the counterless range form keys by the GENERATED
// NUMBER (`<from> + __i`), the same identity the counter form uses — never by
// the 0-based __i. Keying by __i reuses 0,1,2 across a moved window, so sliding
// `5...7` to `6...8` would let the reconciler patch each row in place and carry
// stale per-row state onto a different number (D58: range keys are the generated
// numbers, unique by construction).
func TestRangeFormKeysByValue(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for 1...count}<span class="dot"></span>{/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { count: 3 }; } }
</script>
`)
	if !strings.Contains(got, "key: (1) + __i") {
		t.Errorf("counterless range must key by the generated value, not the index:\n%s", got)
	}
	if strings.Contains(got, "key: __i") {
		t.Errorf("counterless range must not key by the bare loop index:\n%s", got)
	}
	if strings.Contains(got, "ViewNode.keyOf") {
		t.Errorf("range form must not call keyOf:\n%s", got)
	}
}

// TestRangeFormValueKeyResolvesFromBoundOnce: a data-driven from-bound is
// resolved EXACTLY once on its way into the key. The key expression is handed to
// the attribute emitter as raw source, and that emitter runs resolveExpr itself
// — pre-resolving it here would emit `__d.__d.start`. Also pins that a composite
// bound stays parenthesized, so `start + 1 ... end` keys by `(start + 1) + __i`
// and not the mis-associated `start + 1 + __i` arithmetic of an unparenthesized
// splice.
func TestRangeFormValueKeyResolvesFromBoundOnce(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for start + 1...end}<span class="dot"></span>{/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { start: 4, end: 9 }; } }
</script>
`)
	if !strings.Contains(got, "key: (__d.start + 1) + __i") {
		t.Errorf("range key must resolve the from-bound once and parenthesize it:\n%s", got)
	}
	if strings.Contains(got, "__d.__d") {
		t.Errorf("range key double-resolved the from-bound:\n%s", got)
	}
	// The row VALUE the counter form would bind and the row KEY must be the same
	// expression — a counterless range is the counter form minus the binding.
	if strings.Count(got, "(__d.start + 1) + __i") != 1 {
		t.Errorf("counterless range must not also emit a .map() value pass:\n%s", got)
	}
}
