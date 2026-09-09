package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
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

func TestEventHandlerLoopItemNamedEvent(t *testing.T) {
	got := compileEventPZL(t,
		"  {#for event in events}\n"+
			"    <button @click={ select(event) }>select</button>\n"+
			"  {/for}",
	)
	if !strings.Contains(got, "__d.events.map((event) =>") {
		t.Fatalf("loop item event was not emitted as the row binding:\n%s", got)
	}
	if !strings.Contains(got, "'@click': (__ev) => this.events.select(event)") {
		t.Errorf("DOM event parameter must not shadow the loop item:\n%s", got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("handler capturing the loop item event must not be cached:\n%s", got)
	}
}

func TestEventHandlerLoopCounterNamedEvent(t *testing.T) {
	got := compileEventPZL(t,
		"  {#for item in items, event}\n"+
			"    <button @click={ select(event) }>select</button>\n"+
			"  {/for}",
	)
	if !strings.Contains(got, "__d.items.map((item, event) =>") {
		t.Fatalf("loop counter event was not emitted as the row binding:\n%s", got)
	}
	if !strings.Contains(got, "'@click': (__ev) => this.events.select(event)") {
		t.Errorf("DOM event parameter must not shadow the loop counter:\n%s", got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("handler capturing the loop counter event must not be cached:\n%s", got)
	}
}

func TestEventHandlerGlobalNamedLoopVarNotCached(t *testing.T) {
	got := compileEventPZL(t,
		"  {#for document in documents}\n"+
			"    <button @click={ open(document) }>open</button>\n"+
			"  {/for}",
	)
	if !strings.Contains(got, "__d.documents.map((document) =>") {
		t.Fatalf("document loop item was not emitted as the row binding:\n%s", got)
	}
	if !strings.Contains(got, "'@click': (event) => this.events.open(document)") {
		t.Errorf("each row must emit a fresh closure over its own document value:\n%s", got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("handler capturing a jsGlobals-named loop item must not be cached:\n%s", got)
	}
}

func TestEventHandlerLoopEventMemberAccess(t *testing.T) {
	got := compileEventPZL(t,
		"  {#for event in rows}\n"+
			"    <button @click={ pick(event.id) }>pick</button>\n"+
			"  {/for}",
	)
	if !strings.Contains(got, "'@click': (__ev) => this.events.pick(event.id)") {
		t.Errorf("member access must resolve against the loop item, not the DOM event:\n%s", got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("handler capturing event.id must not be cached:\n%s", got)
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

func TestEventHandlerRejectedFormsRemainPositionedErrors(t *testing.T) {
	cases := []struct {
		name    string
		expr    string
		message string
	}{
		{"binary expression", "a + b", "event handler must be a bare method name or a single call expression"},
		{"arrow function", "(e) => close(e)", "event handler callee must be a plain method name"},
		{"this member", "this.close", "event handler must be a bare method name or a single call expression"},
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
