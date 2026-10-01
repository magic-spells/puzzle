package check

import (
	"strings"
	"testing"
)

// A library call in a brace-only attribute, a prop or a marker argument is
// checked as a call on the shim's function table (`__puzzle_fn.name(…)`), the
// same as in a text interpolation, and condition headers are checked as the
// plain JavaScript they are — `||` stays logical OR.
func TestCallValuePositionsAreChecked(t *testing.T) {
	source := []byte(`<puzzle-view>
  <a title={ currency(price, 'USD') } data-n={ round(count) }>x</a>
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
		`void (__puzzle_fn.currency(__d.price, 'USD'));`,
		`void (__puzzle_fn.round(__d.count));`,
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
}
