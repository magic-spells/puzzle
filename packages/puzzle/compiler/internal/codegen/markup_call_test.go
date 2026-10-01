package codegen

import (
	"strings"
	"testing"
)

// markup_call_test.go — the call form of the D174 markup functions
// (DESIGN-expr-v2 §6): `raw`/`newline_to_br` as the outermost call of a text
// interpolation lowers to the live-HTML vnode, and every other placement is a
// positioned compile error.

func TestMarkupCallLowersToLiveHTML(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view>
  <p>Before { raw(truncate(body, 40)) } after</p>
  <p>{ newline_to_br(note) }</p>
  <ul>{#for c in comments}<li>{ raw(c.html) }</li>{/for}</ul>
</puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`new ViewNode('#html', { value: __s((__f["truncate"] || __f.__missing("truncate"))(__d.body, 40), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'raw(truncate(body, 40))' : 0) })`,
		`new ViewNode('#html', { value: __s(__d.note, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'newline_to_br(note)' : 0), br: true })`,
		`new ViewNode('#html', { value: __s(s.item?.html,`,
		`new ViewNode('text', { value: 'Before ' })`,
		`new ViewNode('text', { value: ' after' })`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{`__f["raw"]`, `__f["newline_to_br"]`} {
		if strings.Contains(got, forbidden) {
			t.Errorf("markup function reached the registry (%s):\n%s", forbidden, got)
		}
	}
}

func TestMarkupCallPlacementErrors(t *testing.T) {
	for _, tt := range []struct {
		name, template, want string
	}{
		{"inside another call", `<puzzle-view><p>{ truncate(raw(body), 5) }</p></puzzle-view>`, "T.pzl:1:28: `raw` must be the outermost call of a text interpolation"},
		{"an operand", `<puzzle-view><p>{ raw(body) + 'x' }</p></puzzle-view>`, "T.pzl:1:19: `raw` must be the outermost call"},
		{"inside its own argument", `<puzzle-view><p>{ raw(newline_to_br(body)) }</p></puzzle-view>`, "`newline_to_br` must be the outermost call"},
		{"brace-only attribute", `<puzzle-view><p title={ raw(body) }>x</p></puzzle-view>`, "not an attribute value"},
		{"quoted attribute", `<puzzle-view><p title="a { raw(body) }">x</p></puzzle-view>`, "not an attribute value"},
		{"inline if condition", `<puzzle-view><p class="{#if raw(on)}a{/if}">x</p></puzzle-view>`, "not an attribute value"},
		{"component prop", `<puzzle-view><Card body={ newline_to_br(body) } /></puzzle-view>`, "not a component prop"},
		{"if condition", `<puzzle-view>{#if raw(body)}<p>x</p>{/if}</puzzle-view>`, "not an {#if} condition"},
		{"when value", `<puzzle-view>{#case kind}{:when raw(a)}<p>a</p>{/case}</puzzle-view>`, "not a {:when} value"},
		{"for header", `<puzzle-view>{#for c in raw(cs)}<p>a</p>{/for}</puzzle-view>`, "not a {#for} header"},
		{"handler argument", `<puzzle-view><button @click={ save(raw(body)) }>x</button></puzzle-view>`, "not an event handler"},
		{"no argument", `<puzzle-view><p>{ raw() }</p></puzzle-view>`, "`raw` takes one argument"},
		{"two arguments", `<puzzle-view><p>{ newline_to_br(a, b) }</p></puzzle-view>`, "`newline_to_br` takes one argument"},
		{"inside textarea", `<puzzle-view><textarea>{ raw(body) }</textarea></puzzle-view>`, "cannot render inside <textarea>"},
		{"inside svg", `<puzzle-view><svg>{ raw(body) }</svg></puzzle-view>`, "cannot render inside <svg>"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := compileMarkup(t, tt.template, ModeView)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want it to contain %q", err, tt.want)
			}
			if !strings.Contains(err.Error(), "T.pzl:") {
				t.Errorf("error is not positioned: %v", err)
			}
		})
	}
	// A view handler named raw is the view's, not the markup function (§9 c).
	got, err := compileMarkup(t, `<puzzle-view><button @click={ raw(body) }>x</button></puzzle-view>`, ModeView)
	if err != nil {
		t.Fatalf("a handler named raw must compile: %v", err)
	}
	if !strings.Contains(got, "this.events.raw(__d.body)") {
		t.Errorf("missing the view handler call:\n%s", got)
	}
}
