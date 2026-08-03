package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

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

func TestDetectAutoBind(t *testing.T) {
	t.Parallel()

	dynamic := func(name, expr string) parser.Attr {
		return &parser.DynamicAttr{Name: name, Expr: expr}
	}
	static := func(name, value string) parser.Attr {
		return &parser.StaticAttr{Name: name, Value: value}
	}
	bare := func(name string) parser.Attr {
		return &parser.StaticAttr{Name: name, Valueless: true}
	}
	event := func(name string, modifiers ...string) parser.Attr {
		return &parser.EventAttr{Name: name, Modifiers: modifiers, Expr: "handler"}
	}
	want := func(event, target, field, spec string) *autoBind {
		return &autoBind{event: event, target: target, field: field, spec: spec}
	}
	loopScope := map[string]bool{"todo": true}

	tests := []struct {
		name  string
		tag   string
		attrs []parser.Attr
		scope map[string]bool
		want  *autoBind
	}{
		{
			name: "input absent type",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft")},
			want: want("input", "", "draft", "v"),
		},
		{
			name: "input number",
			tag:  "input", attrs: []parser.Attr{static("type", "number"), dynamic("value", "age")},
			want: want("change", "", "age", "vn"),
		},
		{
			name: "input range",
			tag:  "input", attrs: []parser.Attr{static("type", "range"), dynamic("value", "volume")},
			want: want("input", "", "volume", "vn"),
		},
		{
			name: "input checkbox scoped member",
			tag:  "input", attrs: []parser.Attr{static("type", "checkbox"), dynamic("checked", "todo.completed")},
			scope: loopScope, want: want("change", "todo", "completed", "c"),
		},
		{
			name: "input date member",
			tag:  "input", attrs: []parser.Attr{static("type", "date"), dynamic("value", "profile.birthday")},
			want: want("change", "profile", "birthday", "v"),
		},
		{
			name: "textarea",
			tag:  "textarea", attrs: []parser.Attr{dynamic("value", "notes")},
			want: want("input", "", "notes", "v"),
		},
		{
			name: "select",
			tag:  "select", attrs: []parser.Attr{dynamic("value", "sort")},
			want: want("change", "", "sort", "v"),
		},
		{
			name: "tag matching is case insensitive",
			tag:  "INPUT", attrs: []parser.Attr{static("type", "TEXT"), dynamic("value", "draft")},
			want: want("input", "", "draft", "v"),
		},
		{
			name: "author input suppresses",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft"), event("input")},
		},
		{
			name: "author change with modifier suppresses",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft"), event("change", "prevent")},
		},
		{
			name: "event name base before colon suppresses",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft"), event("change:prevent")},
		},
		{
			name: "other author event does not suppress",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft"), event("keydown", "enter")},
			want: want("input", "", "draft", "v"),
		},
		{
			name: "static readonly suppresses",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft"), bare("readonly")},
		},
		{
			name: "static disabled suppresses",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft"), bare("disabled")},
		},
		{
			name: "dynamic readonly does not suppress",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft"), dynamic("readonly", "locked")},
			want: want("input", "", "draft", "v"),
		},
		{
			name: "dynamic type skips",
			tag:  "input", attrs: []parser.Attr{dynamic("type", "kind"), dynamic("value", "draft")},
		},
		{
			name: "mixed type skips",
			tag:  "input", attrs: []parser.Attr{
				&parser.MixedAttr{Name: "type", Parts: []parser.Part{&parser.StaticPart{Text: "text"}}},
				dynamic("value", "draft"),
			},
		},
		{
			name: "valueless type skips",
			tag:  "input", attrs: []parser.Attr{bare("type"), dynamic("value", "draft")},
		},
		{
			name: "checkbox value skips",
			tag:  "input", attrs: []parser.Attr{static("type", "checkbox"), dynamic("value", "submitValue")},
		},
		{
			name: "checked without checkbox skips",
			tag:  "input", attrs: []parser.Attr{dynamic("checked", "done")},
		},
		{
			name: "select multiple skips",
			tag:  "select", attrs: []parser.Attr{dynamic("value", "choices"), bare("multiple")},
		},
		{
			name: "select dynamic multiple skips",
			tag:  "select", attrs: []parser.Attr{dynamic("value", "choices"), dynamic("multiple", "many")},
		},
		{
			name: "component skips",
			tag:  "Foo", attrs: []parser.Attr{dynamic("value", "draft")},
		},
		{
			name: "computed expression skips",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "draft.trim()")},
		},
		{
			name: "bare loop variable skips",
			tag:  "input", attrs: []parser.Attr{dynamic("value", "todo")},
			scope: loopScope,
		},
		{
			name: "static value skips",
			tag:  "input", attrs: []parser.Attr{static("value", "draft")},
		},
	}

	for _, inputType := range []string{"text", "search", "email", "password", "url", "tel", "color"} {
		tests = append(tests, struct {
			name  string
			tag   string
			attrs []parser.Attr
			scope map[string]bool
			want  *autoBind
		}{
			name:  "text-ish " + inputType,
			tag:   "input",
			attrs: []parser.Attr{static("type", inputType), dynamic("value", "draft")},
			want:  want("input", "", "draft", "v"),
		})
	}
	for _, inputType := range []string{"date", "time", "month", "week", "datetime-local"} {
		tests = append(tests, struct {
			name  string
			tag   string
			attrs []parser.Attr
			scope map[string]bool
			want  *autoBind
		}{
			name:  "date-ish " + inputType,
			tag:   "input",
			attrs: []parser.Attr{static("type", inputType), dynamic("value", "when")},
			want:  want("change", "", "when", "v"),
		})
	}
	for _, inputType := range []string{"file", "radio", "submit", "button", "reset", "image", "hidden", ""} {
		tests = append(tests, struct {
			name  string
			tag   string
			attrs []parser.Attr
			scope map[string]bool
			want  *autoBind
		}{
			name:  "excluded type " + inputType,
			tag:   "input",
			attrs: []parser.Attr{static("type", inputType), dynamic("value", "draft")},
		})
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := detectAutoBind(tt.tag, tt.attrs, tt.scope)
			if tt.want == nil {
				if got != nil {
					t.Fatalf("detectAutoBind() = %#v, want nil", got)
				}
				return
			}
			if got == nil || *got != *tt.want {
				t.Fatalf("detectAutoBind() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

func TestAutoBindWidthTrialDoesNotConsumeHandlerSite(t *testing.T) {
	src := viewSrc(
		"  <button @click={ a }>A</button>\n"+
			"  <input value={ draft } />\n"+
			"  <button @click={ b }>B</button>\n"+
			"  <button @click={ c }>C</button>",
		plainScripts,
	)
	got := compileSrc(t, src)

	if !strings.Contains(got, "'@input:bind': this.__bind(null, 'draft', 'v')") {
		t.Fatalf("compiled output missing synthesized bind handler:\n%s", got)
	}
	for i, handler := range []string{"a", "b", "c"} {
		want := "(this.__h ??= {})[" + itoa(i) + "] ??= (event) => this.events." + handler + "(event)"
		if !strings.Contains(got, want) {
			t.Errorf("cached handler site %d missing or shifted:\n%s", i, got)
		}
	}
	if strings.Count(got, "(this.__h ??= {})[") != 3 {
		t.Errorf("auto-bind must consume no cached-handler site:\n%s", got)
	}
}
