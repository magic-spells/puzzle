package codegen

import (
	"strings"
	"testing"
)

// for_item_ident_test.go — the {#for} loop variable is validated as a bare JS
// identifier (parser reuses isBareIdent). A '$'-prefixed name is a legal
// identifier and must compile: the lambda param stays intact and body references
// resolve against the loop scope, not the data model. A name like "todo-item" is
// rejected in the parser (see parser package tests) and never reaches codegen.

func TestForItemDollarIdentifier(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <ul>{#for $foo in items}<li>{ $foo }</li>{/for}</ul>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</script>
`)
	// Collection resolves against the model; the lambda param is the intact
	// identifier (not split on any character).
	if !strings.Contains(got, "__l(this, this, 0, __d.items, (s) =>") {
		t.Errorf("expected the item-form loop to lower to a list block, got:\n%s", got)
	}
	// The identifier survives intact in the site meta's key arrow, which is
	// where the loop variable is still spelled out (D170 emission contract).
	if !strings.Contains(got, "const __L0 = { key: ($foo) => ViewNode.keyOf($foo) };") {
		t.Errorf("expected the key arrow to keep the intact identifier, got:\n%s", got)
	}
	// The loop variable is in scope inside the body: a bare `{ $foo }` reads the
	// row scope — never rewritten to `__d.$foo` and never mangled.
	if !strings.Contains(got, "__s(s.item,") {
		t.Errorf("expected body reference `__s(s.item, …)` (loop var in scope), got:\n%s", got)
	}
	if strings.Contains(got, "__d.$foo") || strings.Contains(got, "__d.foo") {
		t.Errorf("loop variable `$foo` must not be rewritten to the data model:\n%s", got)
	}
}

func TestForAllowedIdentifiersCompile(t *testing.T) {
	tests := []struct {
		name    string
		item    string
		counter string
	}{
		{name: "dollar-prefixed", item: "$foo", counter: "i"},
		{name: "single underscore", item: "_x", counter: "index"},
		{name: "normal names", item: "item", counter: "count"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, `<puzzle-view>{#for `+tc.item+` in items, `+tc.counter+`}<div>{ `+tc.item+` }</div>{/for}</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</script>`)
			// A lowered loop spells the identifiers in the site meta's key arrow;
			// the body reads them off the row scope.
			if !strings.Contains(got, "key: ("+tc.item+") => ViewNode.keyOf("+tc.item+")") {
				t.Errorf("allowed loop identifiers did not compile intact:\n%s", got)
			}
			if !strings.Contains(got, "__l(this, this, 0, __d.items, (s) =>") {
				t.Errorf("allowed loop identifiers did not lower to a list block:\n%s", got)
			}
		})
	}
}
