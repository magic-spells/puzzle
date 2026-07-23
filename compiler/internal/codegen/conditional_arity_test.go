package codegen

import (
	"strings"
	"testing"
)

// conditional_arity_test.go — a variable-length `{#if}`/`{#case}` branch used to
// shift every trailing sibling's index, so the indexed patcher tag-mismatched and
// DESTROYED + remounted them (toggling `{#if error}…{/if}` next to an <input>
// wiped the input's focus/uncontrolled text). Fixed-occupancy branches are padded
// with `new ViewNode('#')` placeholders; branches containing nullable-key loops
// or 0..N slot expansion stay unpadded. These tests pin that stability gate.

// TestNoElseIfPadsWithPlaceholder: a no-else {#if} whose then-branch has content
// emits placeholders in the else array instead of `: []`, so toggling the
// condition keeps the children-array length constant.
func TestNoElseIfPadsWithPlaceholder(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#if error}<p class="err">Bad</p>{/if}
  <input placeholder="name" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, ": []),") {
		t.Errorf("no-else {#if} with content must NOT emit an empty else array (index-shift bug)\n%s", got)
	}
	if !strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("no-else {#if} with content must pad its else branch with a placeholder\n%s", got)
	}
}

// TestNoElseIfEmptyBranchStaysEmpty: a no-else {#if} whose only child is a {#for}
// has static length 0 but unstable occupancy (item-form keyOf can return null),
// so nothing is padded — the else stays `: []`.
func TestNoElseIfEmptyBranchStaysEmpty(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#if items.length}{#for x in items}<li>{ x }</li>{/for}{/if}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, ": []),") {
		t.Errorf("a {#for}-only {#if} branch has static length 0 — the else must stay empty (no placeholder)\n%s", got)
	}
	if strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("an item-form {#for}-only {#if} branch must not pad (its rows may be unkeyed)\n%s", got)
	}
}

// TestItemForDisablesIfPadding: item-form rows can be positional when keyOf
// returns null, so a static sibling in the same branch must not trigger padding
// that could pair a placeholder against the trailing input.
func TestItemForDisablesIfPadding(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#if show}
    <p>fixed</p>
    {#for x in items}<span>{ x }</span>{/for}
  {/if}
  <input placeholder="name" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("an item-form loop makes its {#if} branch unstable; emit no padding placeholders\n%s", got)
	}
	if !strings.Contains(got, ": []),") {
		t.Errorf("an unstable no-else {#if} must keep the original empty else array\n%s", got)
	}
}

// TestSlotDisablesCasePadding: a slot marker expands to 0..N runtime nodes, so
// one unstable clause disables padding across the whole case.
func TestSlotDisablesCasePadding(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#case state}
    {:when 'full'}<children/><span>fixed</span>
    {:when 'short'}<span>short</span>
  {/case}
  <input placeholder="name" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("a slot marker makes its {#case} branch unstable; emit every clause unpadded\n%s", got)
	}
	if !strings.Contains(got, ": [])(") {
		t.Errorf("an unstable no-else {#case} must keep the original implicit empty branch\n%s", got)
	}
}

// TestRangeForKeepsIfPadding: generated range keys are never null, so the loop
// contributes zero static slots without making the branch unstable. The static
// paragraph still requires one placeholder in the implicit else.
func TestRangeForKeepsIfPadding(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#if show}
    {#for 1...3, i}<span>{ i }</span>{/for}
    <p>fixed</p>
  {/if}
  <input placeholder="name" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if n := strings.Count(got, "new ViewNode('#')"); n != 1 {
		t.Errorf("a generated-key range loop must preserve padding for the static imbalance (want 1 placeholder, got %d)\n%s", n, got)
	}
}

// TestExplicitKeyRangeForDisablesIfPadding: an author key expression can return
// null even in range form, so the generated-key proof no longer applies.
func TestExplicitKeyRangeForDisablesIfPadding(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#if show}
    {#for 1...3, i}<span key={ null }>{ i }</span>{/for}
    <p>fixed</p>
  {/if}
  <input placeholder="name" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("an explicit range-row key makes the {#if} branch unstable; emit no padding placeholders\n%s", got)
	}
	if !strings.Contains(got, ": []),") {
		t.Errorf("an unstable no-else {#if} must keep the original empty else array\n%s", got)
	}
}

// TestNestedItemForMakesOuterIfUnstable: instability propagates through nested
// conditionals so the outer branch is not padded either.
func TestNestedItemForMakesOuterIfUnstable(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#if outer}
    {#if inner}
      <p>fixed</p>
      {#for x in items}<span>{ x }</span>{/for}
    {/if}
    <strong>outer</strong>
  {/if}
  <input placeholder="name" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("an item-form loop must make both its nested {#if} and the outer {#if} unpadded\n%s", got)
	}
}

// TestCaseUnevenBranchesPad: a {#case} whose clause bodies differ in length pads
// every branch — including the implicit no-match `[]` — up to the longest, so any
// matched clause (or none) contributes the same static count. The 2-item clause
// stays unpadded; the 1-item clause, the else, and the no-match default each gain
// one placeholder.
func TestCaseUnevenBranchesPad(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#case status}
    {:when 'a'}<span>one</span><span>two</span>
    {:when 'b'}<span>solo</span>
    {:else}<span>fallback</span>
  {/case}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	// maxLen is 2 (the 'a' clause). The 'b' clause and the {:else} (the no-match
	// fallback) are each short by one → two placeholders total.
	if n := strings.Count(got, "new ViewNode('#')"); n != 2 {
		t.Errorf("uneven {#case} branches must pad to a common arity (want 2 placeholders, got %d)\n%s", n, got)
	}
	// No branch may emit a bare empty array — every branch is padded to length 2.
	if strings.Contains(got, ": []),") {
		t.Errorf("uneven {#case} must not leave an empty (unpadded) branch\n%s", got)
	}
}

// TestNoElseCasePadsImplicitDefault: a {#case} with no {:else} pads its implicit
// no-match `[]` default up to the longest clause, so an unmatched value still
// contributes the same static count as any matched clause.
func TestNoElseCasePadsImplicitDefault(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#case status}
    {:when 'a'}<span>one</span>
  {/case}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, ": []),") {
		t.Errorf("no-else {#case} with a content clause must pad its implicit default (no empty array)\n%s", got)
	}
	if !strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("no-else {#case} must pad the implicit no-match default with a placeholder\n%s", got)
	}
}

// TestBalancedCaseNoPad: when every clause + else already has equal static
// length, padding adds nothing — emission is byte-identical to before the fix.
func TestBalancedCaseNoPad(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#case status}
    {:when 'a'}<span>one</span>
    {:when 'b'}<span>two</span>
    {:else}<span>three</span>
  {/case}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, "new ViewNode('#')") {
		t.Errorf("a balanced {#case} must not emit any placeholder\n%s", got)
	}
}
