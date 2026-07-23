package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// emptyattr_test.go — bare vs explicit-empty static attributes. attrKV keys the
// boolean-attr emission on StaticAttr.Valueless: a BARE attr (autofocus) is
// `true`, an EXPLICIT empty value (value="") is `''`. Keying on Value == ""
// conflated the two — value="" compiled to `value: true`, so the runtime set the
// literal string "true" on inputs and passed true instead of '' as a component
// prop.

// compileSrc splits + compiles an in-memory .pzl in view mode.
func compileSrc(t *testing.T, src string) string {
	t.Helper()
	sec, err := parser.SplitSections(src, "T.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res.JS
}

func TestEmptyValueAttrEmission(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <input value="" placeholder="name" autofocus />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, "value: '',") {
		t.Errorf("value=\"\" should emit value: '' (explicit empty string)\n%s", got)
	}
	if !strings.Contains(got, "autofocus: true,") {
		t.Errorf("bare autofocus should emit autofocus: true\n%s", got)
	}
	if strings.Contains(got, "value: true") {
		t.Errorf("value=\"\" must NOT emit value: true (the runtime would set the string \"true\")\n%s", got)
	}
}

// TestEmptyValueComponentProp asserts component props ride the same attrKV path:
// <Child label="" /> passes '' — not true — to the child.
func TestEmptyValueComponentProp(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <Child label="" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Child from './Child.pzl';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, "new ViewNode(Child, { label: '' }, [])") {
		t.Errorf("label=\"\" component prop should pass '', got:\n%s", got)
	}
}
