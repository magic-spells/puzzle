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
	// The synthetic key is hoisted into the site meta; the row root carries the
	// block's resolved key (D170 emission contract). The RESOLVER is unchanged.
	if !strings.Contains(got, "const __L0 = { key: (item) => ViewNode.keyOf(item)") {
		t.Errorf("item-form site meta must carry ViewNode.keyOf(item):\n%s", got)
	}
	if !strings.Contains(got, "new ViewNode('li', { key: s.k }") {
		t.Errorf("item-form row root's first attr must be the block key:\n%s", got)
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
	// The author's expression MOVES into the site meta with the loop local left
	// bare; the row root carries `key: s.k` (D170 emission contract).
	if !strings.Contains(got, "const __L0 = { key: (item) => item?.slug") {
		t.Errorf("author's explicit key expression must stand verbatim in the meta:\n%s", got)
	}
	if !strings.Contains(got, "new ViewNode('li', { key: s.k }") {
		t.Errorf("lowered row root must carry the block key:\n%s", got)
	}
	if strings.Count(got, "key:") != 2 {
		t.Errorf("explicit key must not double the key property on the row root:\n%s", got)
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
	if !strings.Contains(got, "const __L0 = { key: (item) => 'row'") {
		t.Errorf("explicit static key must stand verbatim in the meta:\n%s", got)
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
	if strings.Count(got, "key:") != 2 {
		t.Errorf("explicit mixed key must not double the key property on the row root:\n%s", got)
	}
	if !strings.Contains(got, "key: (item) => `row-${__s(item?.id,") {
		t.Errorf("author's mixed key must stand as a template literal in the meta:\n%s", got)
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
	if !strings.Contains(got, "const __L0 = { key: (item) => item?.slug") {
		t.Errorf("author's explicit key on component root must stand verbatim in the meta:\n%s", got)
	}
	if strings.Count(got, "key:") != 2 {
		t.Errorf("explicit key must not double the key property on the row root:\n%s", got)
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
// NUMBER, the same identity the counter form uses — never by its 0-based
// position. Keying by position reuses 0,1,2 across a moved window, so sliding
// `5...7` to `6...8` would let the reconciler patch each row in place and carry
// stale per-row state onto a different number (D58: range keys are the generated
// numbers, unique by construction). loopRange (`__r`, D173 V12) hands the body
// the numbers themselves, so the compiler-private `__i` IS the value.
func TestRangeFormKeysByValue(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for 1...count}<span class="dot"></span>{/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { count: 3 }; } }
</script>
`)
	if !strings.Contains(got, "__r(1, __d.count).map((__i) =>") {
		t.Errorf("counterless range must map the generated numbers:\n%s", got)
	}
	if !strings.Contains(got, "key: __i,") {
		t.Errorf("counterless range must key by the generated value:\n%s", got)
	}
	if strings.Contains(got, "ViewNode.keyOf") {
		t.Errorf("range form must not call keyOf:\n%s", got)
	}
}

// TestRangeFormValueKeyResolvesFromBoundOnce: a data-driven from-bound is
// resolved EXACTLY once — it is an argument to loopRange, and the key is the
// generated value, so nothing re-splices the bound's source.
func TestRangeFormValueKeyResolvesFromBoundOnce(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#for start + 1...end}<span class="dot"></span>{/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { start: 4, end: 9 }; } }
</script>
`)
	if !strings.Contains(got, "__r(__d.start + 1, __d.end).map((__i) =>") {
		t.Errorf("range must pass both bounds to loopRange:\n%s", got)
	}
	if strings.Contains(got, "__d.__d") {
		t.Errorf("range bound double-resolved:\n%s", got)
	}
	if strings.Count(got, "__d.start + 1") != 1 {
		t.Errorf("the from-bound must be evaluated once:\n%s", got)
	}
}
