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

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</scripts>
`)
	// Collection resolves against the model; the lambda param is the intact
	// identifier (not split on any character).
	if !strings.Contains(got, "__d.items.map(($foo) =>") {
		t.Errorf("expected `__d.items.map(($foo) =>`, got:\n%s", got)
	}
	// The loop variable is in scope inside the body: a bare `{ $foo }` stays
	// local — never rewritten to `__d.$foo` and never mangled.
	if !strings.Contains(got, "String($foo)") {
		t.Errorf("expected body reference `String($foo)` (loop var in scope), got:\n%s", got)
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
<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { items: [] }; } }
</scripts>`)
			if !strings.Contains(got, ".map(("+tc.item+", "+tc.counter+") =>") {
				t.Errorf("allowed loop identifiers did not compile intact:\n%s", got)
			}
		})
	}
}
