package codegen

import (
	"strings"
	"testing"
)

// TestRawBlockEmission pins D150 at the codegen boundary: captured bodies are
// JS string literals, HTML remains vnode structure, and raw @-attributes use
// the runtime-private literal-name escape instead of compiling as handlers.
func TestRawBlockEmission(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <script type="application/json">{#raw}{ "loop": true, "html": "</script><b>x</b>" }{/raw}</script>
  {#raw}<b @click={ handler }>hi { name }</b>{/raw}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	for _, want := range []string{
		`'{ "loop": true, "html": "</script><b>x</b>" }'`,
		`new ViewNode('b'`,
		`'@@click': '{ handler }'`,
		`'hi { name }'`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("compiled raw block missing %q:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"__d.loop", "__d.handler", "__d.name", "this.events.handler"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("raw body reached expression/event codegen (%q):\n%s", forbidden, got)
		}
	}
}
