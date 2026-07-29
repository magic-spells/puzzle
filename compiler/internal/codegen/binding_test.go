package codegen

import "testing"

func TestClassifyBindExpr(t *testing.T) {
	t.Parallel()

	scopedTodo := map[string]bool{"todo": true}
	tests := []struct {
		name   string
		raw    string
		scope  map[string]bool
		target string
		field  string
		bare   bool
		ok     bool
	}{
		{name: "bare", raw: "draft", field: "draft", bare: true, ok: true},
		{name: "trimmed bare", raw: " draft ", field: "draft", bare: true, ok: true},
		{name: "member", raw: "todo.completed", target: "todo", field: "completed", ok: true},
		{name: "member camel case", raw: "profile.displayName", target: "profile", field: "displayName", ok: true},
		{name: "underscore member", raw: "_x.y", target: "_x", field: "y", ok: true},
		{name: "deep member", raw: "a.b.c"},
		{name: "call", raw: "fmt(x)"},
		{name: "member call", raw: "x.trim()"},
		{name: "addition", raw: "a + b"},
		{name: "nullish", raw: "a ?? ''"},
		{name: "ternary", raw: "a ? b : c"},
		{name: "computed member", raw: "todo[k]"},
		{name: "optional member", raw: "a?.b"},
		{name: "formatter", raw: "x | money"},
		{name: "this root", raw: "this.x"},
		{name: "keyword", raw: "true"},
		{name: "global", raw: "window"},
		{name: "event member", raw: "event.target"},
		{name: "scoped event member", raw: "event.detail", scope: map[string]bool{"event": true}, target: "event", field: "detail", ok: true},
		{name: "quoted empty", raw: "''"},
		{name: "object literal", raw: "{ a: 1 }"},
		{name: "scoped bare", raw: "todo", scope: scopedTodo},
		{name: "scoped member", raw: "todo.completed", scope: scopedTodo, target: "todo", field: "completed", ok: true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			target, field, bare, ok := classifyBindExpr(tt.raw, tt.scope)
			if target != tt.target || field != tt.field || bare != tt.bare || ok != tt.ok {
				t.Fatalf(
					"classifyBindExpr(%q) = (%q, %q, %t, %t), want (%q, %q, %t, %t)",
					tt.raw, target, field, bare, ok,
					tt.target, tt.field, tt.bare, tt.ok,
				)
			}
		})
	}
}
