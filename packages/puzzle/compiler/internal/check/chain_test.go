package check

import (
	"strings"
	"testing"
)

// D173 V1: a pipe is a formatter in brace-only attributes, props and block
// subjects, so puzzle check must type-check those positions as formatter calls
// — the same `__puzzle_check_formatter(name, value, ...args)` wrapping a text
// interpolation gets — rather than as a bitwise OR, and each piece must still
// map back to its own .pzl bytes.
func TestChainedValuePositionsAreChecked(t *testing.T) {
	source := []byte(`<puzzle-view>
  <a title={ price | currency('USD') }>x</a>
  {#if tags | size}<b>a</b>{:else if others | size}<b>b</b>{/if}
  {#unless user | blank}<b>c</b>{/unless}
  {#case status | downcase}{:when 'a'}<b>d</b>{/case}
  <p class="x {#if on | truthy}on{/if}">y</p>
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
		`if (__puzzle_check_formatter("size", __d.tags)) {`,
		`if (__puzzle_check_formatter("size", __d.others)) {`,
		`if (!(__puzzle_check_formatter("blank", __d.user))) {`,
		`switch (__puzzle_check_formatter("downcase", __d.status)) {`,
		`if (__puzzle_check_formatter("truthy", __d.on)) {`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("generated wrapper is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "__d.price | ") || strings.Contains(got, "__d.tags | ") {
		t.Errorf("a chain was checked as a bitwise OR:\n%s", got)
	}
}
