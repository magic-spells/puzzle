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

// Raw text bypasses the ordinary template whitespace policy byte-for-byte,
// including the single-text-node RAWTEXT path for script/style and whitespace-
// only segments coalesced beside ordinary text.
func TestRawTextPreservesLiteralBytes(t *testing.T) {
	src := `<puzzle-view>
  <script type="application/json">{#raw}{
  "name": "Puzzle",
  "enabled": true
}{/raw}</script>
  {#raw}<pre>const a = 1;
const b = 2;
// note
const c = 3;</pre>{/raw}
  <p>before{#raw}
` + "  \t\n" + `{/raw}after</p>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`
	got := compileSrc(t, src)

	for _, want := range []string{
		`'{\n  "name": "Puzzle",\n  "enabled": true\n}'`,
		`'const a = 1;\nconst b = 2;\n// note\nconst c = 3;'`,
		`'before' + '\n  \t\n' + 'after'`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("compiled raw text did not preserve %q:\n%s", want, got)
		}
	}
}

// TestRawDirectiveAttrsStayLiteral pins the other half of D150's literal-name
// rule: `ref`/`island`/`key`/`flip` inside a raw body are authored markup, so
// none of them may reach a directive path. The four names the runtime reserves
// are dropped from the vnode entirely (dropReservedLiteralAttrs); every other
// literal attribute — including the compile ERROR shapes a live template would
// reject — is emitted as authored, and the @-only vnode-key escape must not
// spread to ordinary names.
func TestRawDirectiveAttrsStayLiteral(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#raw}<li ref="my-chart" island key="row-1" flip class="row" bind:value="v">x</li>{/raw}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	for _, want := range []string{
		`class: 'row'`,
		`'bind:value': 'v'`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("raw literal attr missing %q:\n%s", want, got)
		}
	}
	// No directive wiring, no escape leaking onto non-@ names, and no reserved
	// name reaching the vnode where the runtime would act on it.
	for _, forbidden := range []string{
		"this.__ref(", "'@ref'", "'@island'", "'@key'", "'@class'",
		"ref:", "island:", "key:", "flip:",
	} {
		if strings.Contains(got, forbidden) {
			t.Errorf("raw attr reached a directive/escape path (%q):\n%s", forbidden, got)
		}
	}
}

// A `key` shown inside a raw body is not the author's explicit key override, so
// the {#for} row still gets its synthetic key (D58) — and gets it exactly once,
// which is why the literal one is dropped rather than emitted alongside it.
func TestRawKeyDoesNotSuppressSyntheticKey(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <ul>
    {#for row in rows}{#raw}<li key="literal">k</li>{/raw}{/for}
  </ul>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, "keyOf(") {
		t.Errorf("synthetic {#for} key was suppressed by a literal raw key:\n%s", got)
	}
	if strings.Count(got, "key:") != 1 {
		t.Errorf("expected exactly one emitted `key:` property, got %d:\n%s", strings.Count(got, "key:"), got)
	}
}
