package codegen

import (
	"strings"
	"testing"
)

func TestDisplayValueCodegenCoversEveryStringifyingInterpolationPath(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <p>{ bare }</p>
  <p>Hello { concat }!</p>
  <input class="quoted" value="{ quoted }" />
  <input class="brace" value={ brace } />
  <div data-branch="{#if ok}{ branch }{:else}{ fallback }{/if}"></div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)

	for _, want := range []string{
		"import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';",
		"__s(__d.bare, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'bare' : 0)",
		"__s(__d.concat, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'concat' : 0)",
		"__s(__d.quoted, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'quoted' : 0)",
		"__s(__d.branch, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'branch' : 0)",
		"__s(__d.fallback, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'fallback' : 0)",
		"value: __d.brace",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("compiled output missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "String(") {
		t.Errorf("compiler-owned display coercion must not use hardcoded String calls:\n%s", got)
	}
}

func TestDisplayValueImportIsOmittedWithoutStringifyingInterpolations(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <div class="static" data-count={ count }>No stringifying interpolation</div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)

	if strings.Contains(got, "displayValue") || strings.Contains(got, "__s(") {
		t.Fatalf("module with only a raw vnode attribute must not import the display helper:\n%s", got)
	}
	if !strings.Contains(got, "import { ViewNode } from '@magic-spells/puzzle';") {
		t.Fatalf("static compiler import changed unexpectedly:\n%s", got)
	}
}
