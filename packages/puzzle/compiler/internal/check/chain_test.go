package check

import (
	"strings"
	"testing"
)

// D173 V1: a pipe is a formatter in brace-only attributes, props and marker
// arguments, so puzzle check must type-check those positions as formatter calls
// — the same `__puzzle_check_formatter(name, value, ...args)` wrapping a text
// interpolation gets — rather than as a bitwise OR, and each piece must still
// map back to its own .pzl bytes. Condition headers take no chain, so they are
// checked as the plain JavaScript they are.
func TestChainedValuePositionsAreChecked(t *testing.T) {
	source := []byte(`<puzzle-view>
  <a title={ price | currency('USD') } data-n={ count | round }>x</a>
  {#if tags || others}<b>a</b>{:else if a || b}<b>b</b>{/if}
  {#unless user || guest}<b>c</b>{/unless}
  {#case status || 'none'}{:when 'a'}<b>d</b>{/case}
  <p class="x {#if on || off}on{/if}">y</p>
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
	for _, want := range []string{
		`void (__puzzle_check_formatter("currency", __d.price, 'USD'));`,
		`void (__puzzle_check_formatter("round", __d.count));`,
		`if (__d.tags || __d.others) {`,
		`if (__d.a || __d.b) {`,
		`if (!(__d.user || __d.guest)) {`,
		`switch (__d.status || 'none') {`,
		`if (__d.on || __d.off) {`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("generated wrapper is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "__d.price | ") || strings.Contains(got, "__d.count | ") {
		t.Errorf("a chain was checked as a bitwise OR:\n%s", got)
	}
}
