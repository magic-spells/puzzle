package codegen

import (
	"strings"
	"testing"
)

// row_facts_test.go — which reads reach a list block's render facts (D170).
// A value handed to a formatter is opaque whether it is the pipe base or an
// argument; a handler argument is read at fire time off the live row scope and
// records no render fact at all.

// A whole record passed as a formatter ARGUMENT reaches whatever the formatter
// reads off it (`byline` reading post.author.name), exactly as the pipe base
// does, so the site must be conservative — in every value position that takes a
// chain.
func TestRowFactsFormatterArgumentIsOpaque(t *testing.T) {
	cases := []struct {
		name     string
		body     string
		wantDeep bool
	}{
		{"text interpolation", "<p>{ 'by' | byline(post) }</p>", true},
		{"brace-only attribute", "<p title={ 'by' | byline(post) }>x</p>", true},
		{"quoted attribute", `<p title="a { 'by' | byline(post) }">x</p>`, true},
		{"inline if condition", `<p class="{#if on | owns(post)}mine{/if}">x</p>`, true},
		{"component prop", "<Row label={ 'by' | byline(post) } />", true},
		{"if subject", "{#if on | owns(post)}<p>x</p>{:else}<p>y</p>{/if}", true},
		{"case subject", "{#case kind | of(post)}{:when 'a'}<p>a</p>{:else}<p>b</p>{/case}", true},
		{"markup chain", "<p>{ 'by' | byline(post) | raw }</p>", true},
		// A depth-one member as an argument stays a field read.
		{"member argument", "<p>{ 'by' | byline(post.title) }</p>", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, listSrc("  {#for post in posts}<div>"+tc.body+"</div>{/for}"))
			if strings.Contains(got, "deep: true") != tc.wantDeep {
				t.Errorf("deep: true = %v, want %v:\n%s", !tc.wantDeep, tc.wantDeep, got)
			}
		})
	}
}

// Handler arguments are evaluated when the event fires, against `s.item`/`s.i`,
// which listRows refreshes on a cached row too — so they add no field, no
// `deep` and no counter read. Without this a handler reading
// `todo.author.id` rebuilt every row every render, and one reading a field the
// schema does not declare turned the whole site conservative.
func TestRowFactsHandlerArgumentsAreFireTime(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos, i}<li @click={ remove(todo.id, todo.author.id, i) }>{ todo.text }</li>{/for}",
	))
	if !strings.Contains(got, "const __L0 = { key: (todo) => ViewNode.keyOf(todo), fields: ['text'] };") {
		t.Errorf("handler-argument reads must not reach the site meta:\n%s", got)
	}
	if !strings.Contains(got, "(s.h0 ??= (event) => this.events.remove(s.item.id, s.item.author.id, s.i))") {
		t.Errorf("the handler must stay row-cached and read the live row scope:\n%s", got)
	}

	// A render-time read of the same members still counts.
	render := compileSrc(t, listSrc(
		"  {#for todo in todos, i}<li @click={ remove(todo.id) }>{ todo.author.id } { i }</li>{/for}",
	))
	if !strings.Contains(render, "counter: true") || !strings.Contains(render, "deep: true") {
		t.Errorf("render-time reads must still reach the site meta:\n%s", render)
	}

	// The condition of a handler-valued conditional IS a render read.
	cond := compileSrc(t, listSrc(
		"  {#for todo in todos}<li @click={ todo.done ? undo(todo.id) : null }>x</li>{/for}",
	))
	if !strings.Contains(cond, "fields: ['done']") {
		t.Errorf("a conditional handler's condition is a render read:\n%s", cond)
	}
}
