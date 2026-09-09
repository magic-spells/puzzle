package codegen

import (
	"strings"
	"testing"
)

// TestComponentFamilyMemberExpression asserts the D167 emission contract
// explicitly: a dotted component tag becomes a bare MEMBER EXPRESSION in the
// ViewNode tag position — `new ViewNode(Frame.Wrapper, …)` — so it resolves
// lexically against module scope exactly like a plain `Frame`. The tag text is
// never quoted (that would make it an element) and never scoped through `__d`.
// component_family.golden.js byte-pins the same output; this guards the
// contract against a blind `-update`.
func TestComponentFamilyMemberExpression(t *testing.T) {
	got := compileFile(t, "testdata/component_family.pzl", ModeView)
	for _, want := range []string{
		"new ViewNode(Frame, { title: __d.title }",
		"new ViewNode(Frame.Wrapper, { tone: 'quiet' }",
		"new ViewNode(Frame.Content, {}",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("compiled output missing %q\n%s", want, got)
		}
	}
	for _, forbidden := range []string{"'Frame.Wrapper'", "__d.Frame"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("compiled output must not contain %q\n%s", forbidden, got)
		}
	}
}

// TestComponentFamilyInForBody covers the second tag-emission site: a {#for}
// body root is re-emitted with a synthetic key, and a dotted member must survive
// that path unquoted too.
func TestComponentFamilyInForBody(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <div>
    {#for row in rows}
    <Frame.Row label={ row.label }/>
    {/for}
  </div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Frame from '../components/Frame';
export default class T extends PuzzleView { data() { return { rows: [] }; } }
</script>
`)
	if !strings.Contains(got, "new ViewNode(Frame.Row, {") {
		t.Errorf("{#for} body root lost the member-expression tag:\n%s", got)
	}
}
