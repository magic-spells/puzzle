package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// compileEventPZL compiles an in-memory .pzl view and syntax-checks the emitted
// module as .mjs. The .mjs suffix is intentional: Node 25 can accept ESM syntax
// in a checked .js file without actually parsing it as a module.
func compileEventPZL(t *testing.T, body string) string {
	t.Helper()
	got := compileSrc(t, viewSrc(body, plainScripts))
	nodeCheck(t, got)
	return got
}

// `event` is the DOM event of a handler and never a name a template binds
// (the expression language's one binding-name rule), so a loop item or
// counter named `event` is a positioned parse error before codegen runs:
// there is no loop binding for the DOM event parameter to shadow.
func TestEventHandlerLoopBindingNamedEventIsRejected(t *testing.T) {
	for _, body := range []string{
		"  {#for event in events}\n    <button @click={ select(event) }>select</button>\n  {/for}",
		"  {#for item in items, event}\n    <button @click={ select(event) }>select</button>\n  {/for}",
		"  {#for event in rows}\n    <button @click={ pick(event.id) }>pick</button>\n  {/for}",
	} {
		_, err := compileSrcOpts(t, viewSrc(body, plainScripts), Options{Mode: ModeView})
		pe, ok := err.(*parser.ParseError)
		if !ok {
			t.Fatalf("%q: got %v, want a ParseError", body, err)
		}
		if pe.Line != 2 || pe.Message != `loop variable "event" is the DOM event of an event handler and cannot name a binding` {
			t.Errorf("%q: got %d:%d %s", body, pe.Line, pe.Col, pe.Message)
		}
	}
}

func TestEventHandlerGlobalNamedLoopVarNotCached(t *testing.T) {
	got := compileEventPZL(t,
		"  {#for document in documents}\n"+
			"    <button @click={ open(document) }>open</button>\n"+
			"  {/for}",
	)
	if !strings.Contains(got, "__l(this, this, 0, __d.documents, (s) =>") {
		t.Fatalf("document loop item was not lowered to a list block:\n%s", got)
	}
	// A loop binding SHADOWS the same-named JS global: the handler must read the
	// row's item, never window.document.
	if !strings.Contains(got, "'@click': (s.h0 ??= (event) => this.events.open(s.item))") {
		t.Errorf("a jsGlobals-named loop item must resolve to the row scope:\n%s", got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("handler capturing a jsGlobals-named loop item must not use the per-instance cache:\n%s", got)
	}
}

func TestEventHandlerNullEmitsNoHandler(t *testing.T) {
	got := compileEventPZL(t, "  <button @click={ null }>disabled</button>")
	if !strings.Contains(got, "'@click': null") {
		t.Errorf("literal null must emit no handler:\n%s", got)
	}
	if strings.Contains(got, "this.events.null") || strings.Contains(got, "this.__h") {
		t.Errorf("literal null must not emit or cache an events.null call:\n%s", got)
	}
}

func TestOutsideNullToggleCompiles(t *testing.T) {
	got := compileEventPZL(t,
		"  <div @pointerdown:outside={ menuOpen ? closeMenu : null }>menu</div>",
	)
	want := "'@pointerdown:outside': (__d.menuOpen) ? (event) => this.events.closeMenu(event) : null"
	if !strings.Contains(got, want) {
		t.Errorf("documented :outside null-toggle missing %q:\n%s", want, got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("a function/null conditional must not be cached:\n%s", got)
	}
}

// The condition of a handler-valued conditional is evaluated during render, so
// it is a value position: member steps are guarded (D173 V4) and a missing
// `user` binds no handler instead of throwing. The handler branches stay
// fire-time code, unguarded.
func TestEventHandlerConditionalConditionIsGuarded(t *testing.T) {
	got := compileEventPZL(t,
		"  <button @click={ user.profile.admin ? promote(user.profile.id) : null }>go</button>\n"+
			"  {#for todo in todos}<li @click={ todo.done ? undo(todo.meta.id) : null }>x</li>{/for}",
	)
	for _, want := range []string{
		"'@click': (__d.user?.profile?.admin) ? (event) => this.events.promote(__d.user.profile.id) : null",
		"'@click': (s.item?.done) ? (event) => this.events.undo(s.item.meta.id) : null",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q:\n%s", want, got)
		}
	}
}

func TestEventHandlerRejectedFormsRemainPositionedErrors(t *testing.T) {
	cases := []struct {
		name    string
		expr    string
		message string
	}{
		{"binary expression", "a + b", "event handler must be a bare method name or a single call expression"},
		// Rejected by the expression grammar while parsing, at the arrow.
		{"arrow function", "(e) => close(e)", "arrow functions are only available as a call argument"},
		{"this member", "this.close", dataThisMsg},
		{"member expression", "handlers.close", "event handler must be a bare method name or a single call expression"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			src := viewSrc("  <button @click={ "+tc.expr+" }>x</button>", plainScripts)
			sec, err := parser.SplitSections(src, "T.pzl")
			if err != nil {
				t.Fatalf("split: %v", err)
			}
			_, err = Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
			if err == nil {
				t.Fatalf("@click={ %s } compiled successfully, want error", tc.expr)
			}
			pe, ok := err.(*parser.ParseError)
			if !ok {
				t.Fatalf("error type = %T, want *parser.ParseError: %v", err, err)
			}
			if pe.File != "T.pzl" || pe.Line != 2 || pe.Col <= 0 {
				t.Errorf("error is not positioned at the event attribute: %+v", *pe)
			}
			if !strings.Contains(pe.Message, tc.message) {
				t.Errorf("error message = %q, want it to contain %q", pe.Message, tc.message)
			}
		})
	}
}
