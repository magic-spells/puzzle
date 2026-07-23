package codegen

import (
	"strings"
	"testing"
)

// refs_test.go — element refs (v1.39, D72). A valid static `ref="name"` is a
// framework-owned attr: attrKV emits it as `ref: this.__ref("name")` (a
// per-instance cached setter the runtime supplies) INSTEAD of a normal
// `ref: 'name'` DOM attribute. Parser validation guarantees a non-empty
// bare-identifier name, so codegen emits it unescaped.

func TestRefEmission(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <canvas ref="chart"></canvas>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, `ref: this.__ref("chart")`) {
		t.Errorf("ref should emit `ref: this.__ref(\"chart\")`\n%s", got)
	}
	// It must NOT ALSO ride through as a plain static DOM attribute.
	if strings.Contains(got, "ref: 'chart'") || strings.Contains(got, `ref: "chart"`) {
		t.Errorf("ref must not emit a plain static attribute\n%s", got)
	}
}

// TestRefWithIsland pins the headline combo: ref + island on the same element.
// ref becomes the setter call; island still rides through as `island: true`
// (the runtime keys freezing on its presence), both in one attrs object.
func TestRefWithIsland(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <div ref="grid" island><span>seed</span></div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, `ref: this.__ref("grid")`) {
		t.Errorf("ref emission missing\n%s", got)
	}
	if !strings.Contains(got, "island: true") {
		t.Errorf("island should still emit island: true alongside ref\n%s", got)
	}
}

// TestRefWithDynamicAttrsAndEvents pins ref coexisting with a dynamic attr and
// an event listener on the same element — each attr compiles independently.
func TestRefWithDynamicAttrsAndEvents(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <div ref="box" class={ cls } @click={ onClick }></div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, `ref: this.__ref("box")`) {
		t.Errorf("ref emission missing\n%s", got)
	}
	if !strings.Contains(got, "class: __d.cls") {
		t.Errorf("dynamic class attr should still compile\n%s", got)
	}
	if !strings.Contains(got, "'@click'") {
		t.Errorf("event listener should still compile\n%s", got)
	}
}

// TestRefEscaping pins that the emitted name is a double-quoted literal matching
// the exact contract shape, and a '$'-prefixed identifier survives verbatim.
func TestRefEscaping(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <div ref="$el"></div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, `ref: this.__ref("$el")`) {
		t.Errorf("ref name should emit verbatim as a double-quoted literal\n%s", got)
	}
}

// TestRefFreeByteIdentity pins that a template WITHOUT any ref compiles with no
// trace of the ref machinery — the ref feature is strictly additive.
func TestRefFreeByteIdentity(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <div class="card"><h2>{ title }</h2></div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if strings.Contains(got, "__ref") {
		t.Errorf("a ref-free template must not emit any __ref call\n%s", got)
	}
	if !strings.Contains(got, "new ViewNode('div', { class: 'card' }, [") {
		t.Errorf("ref-free element emission changed unexpectedly\n%s", got)
	}
}
