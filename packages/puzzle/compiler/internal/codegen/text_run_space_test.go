package codegen

import (
	"strings"
	"testing"
)

// A newline BETWEEN members of one text run separates words — it is not source
// indentation — so exactly one space survives at that boundary. Run edges keep
// the strip, and members with no whitespace between them stay adjacent.
func TestTextRunInternalNewlineKeepsOneSpace(t *testing.T) {
	cases := []struct {
		name     string
		template string
		want     string
		notWant  string
	}{
		{
			name:     "text to interpolation across a newline",
			template: "<p>— you have { count } new\n    { count === 1 ? 'message' : 'messages' }.</p>",
			want:     "' new ' + __s(",
			notWant:  "' new' + __s(",
		},
		{
			name:     "interpolation to interpolation across a dropped whitespace-only node",
			template: "<p>{ user.first }\n   { user.last }</p>",
			want:     " + ' ' + __s(__d.user?.last",
		},
		{
			name:     "interpolation to text across a newline",
			template: "<p>a { x }\nb</p>",
			want:     " + ' b' }",
			notWant:  " + 'b' }",
		},
		{
			name:     "adjacent interpolations stay adjacent",
			template: "<p>{ a }{ b }</p>",
			want:     "0) + __s(__d.b",
			notWant:  "+ ' ' +",
		},
		{
			name:     "run edges still strip their indentation",
			template: "<ul><li>\n  { item }\n</li></ul>",
			want:     "value: __s(__d.item",
			notWant:  "' '",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, "<puzzle-view>\n"+tc.template+"\n</puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n")
			if !strings.Contains(got, tc.want) {
				t.Errorf("compiled output missing %q:\n%s", tc.want, got)
			}
			if tc.notWant != "" && strings.Contains(got, tc.notWant) {
				t.Errorf("compiled output must not contain %q:\n%s", tc.notWant, got)
			}
		})
	}
}

// A control-flow block breaks the coalesced run but not the line of prose, so a
// newline between a text run and an adjacent {#if}/{#for}/{#case} sibling keeps
// exactly one space — the same rule as a run-internal boundary. No space is
// invented at the parent's edge.
func TestTextRunControlFlowBoundaryKeepsOneSpace(t *testing.T) {
	cases := []struct {
		name     string
		template string
		want     []string
		notWant  []string
	}{
		{
			name:     "text run to {#if} across a newline",
			template: "<p>\n  you have { n } new\n  {#if x}message{/if}\n</p>",
			want:     []string{"+ ' new ' }"},
			notWant:  []string{"+ ' new' }"},
		},
		{
			name:     "{#if} to text run across a newline",
			template: "<p>\n  {#if x}message{/if}\n  is waiting\n</p>",
			want:     []string{"value: ' is waiting'"},
			notWant:  []string{"value: 'is waiting'"},
		},
		{
			name:     "interpolations on both sides pad as standalone spaces",
			template: "<p>{ a }\n{#if x}b{/if}\n{ c }</p>",
			want:     []string{"0) + ' ' }", "value: ' ' + __s(__d.c"},
		},
		{
			name:     "{#for} to text run across a newline",
			template: "<p>\n  {#for w in words}<b>{ w }</b>{/for}\n  done\n</p>",
			want:     []string{"value: ' done'"},
			notWant:  []string{"value: 'done'"},
		},
		{
			name:     "{#case} pads both of its boundaries",
			template: "<p>\n  hi\n  {#case n}{:when 1}one{:else}many{/case}\n  there\n</p>",
			want:     []string{"value: 'hi '", "value: ' there'"},
		},
		{
			name:     "a nested block pads inside its parent branch",
			template: "<p>\n  {#if a}\n    outer\n    {#if b}inner{/if}\n  {/if}\n</p>",
			want:     []string{"value: 'outer '", "value: 'inner'"},
		},
		{
			name:     "{:else} branch text pads against a following block",
			template: "<p>\n  {#if x}yes{:else}no\n  {#if y}maybe{/if}{/if}\n</p>",
			want:     []string{"value: 'no '"},
		},
		{
			name:     "a block body's own edges keep the element-boundary strip",
			template: "<p>\n  a\n  {#if x}\n    b\n  {/if}\n</p>",
			want:     []string{"value: 'a '", "value: 'b'"},
			notWant:  []string{"value: ' b'", "value: 'b '"},
		},
		{
			name:     "a block at an element edge invents no space",
			template: "<p>\n  {#if x}a{/if}\n</p>",
			notWant:  []string{"' '"},
		},
		{
			name:     "no whitespace at the boundary stays adjacent",
			template: "<p>{#if x}a{/if}{ b }</p>",
			notWant:  []string{"' ' + __s(__d.b"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, "<puzzle-view>\n"+tc.template+"\n</puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n")
			for _, w := range tc.want {
				if !strings.Contains(got, w) {
					t.Errorf("compiled output missing %q:\n%s", w, got)
				}
			}
			for _, nw := range tc.notWant {
				if strings.Contains(got, nw) {
					t.Errorf("compiled output must not contain %q:\n%s", nw, got)
				}
			}
		})
	}
}

func compileWSView(t *testing.T, template string) string {
	t.Helper()
	return compileSrc(t, "<puzzle-view>\n"+template+"\n</puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n")
}

type wsCase struct {
	name     string
	template string
	want     []string
	notWant  []string
}

func runWSCases(t *testing.T, cases []wsCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileWSView(t, tc.template)
			for _, w := range tc.want {
				if !strings.Contains(got, w) {
					t.Errorf("compiled output missing %q:\n%s", w, got)
				}
			}
			for _, nw := range tc.notWant {
				if strings.Contains(got, nw) {
					t.Errorf("compiled output must not contain %q:\n%s", nw, got)
				}
			}
		})
	}
}

// D168 rule 4: between text or an interpolation and an element (component,
// marker, {#svg} included), in either order, newline-bearing whitespace
// collapses to one space. Rule 3 (element to element: dropped) and rule 2
// (parent edges: dropped) stand.
func TestTextElementBoundaryKeepsOneSpace(t *testing.T) {
	runWSCases(t, []wsCase{
		{
			name:     "the glued-prose bug: text and inline elements across newlines",
			template: "<p>\n  tokens —\n  <code>a</code>,\n  <code>b</code>\n  and more\n</p>",
			want:     []string{"value: 'tokens — '", "value: ', '", "value: ' and more'"},
			notWant:  []string{"value: 'tokens —'", "value: ','", "value: 'and more'"},
		},
		{
			name:     "element then interpolation text",
			template: "<p><b>{ user.name }</b>\n({ user.email })</p>",
			want:     []string{"value: ' (' + __s(__d.user?.email"},
		},
		{
			name:     "element then a whitespace-only newline before an interpolation",
			template: "<p><b>x</b>\n{ y }</p>",
			want:     []string{"value: ' ' + __s(__d.y"},
		},
		{
			name:     "interpolation then an element",
			template: "<p>{ y }\n<b>x</b></p>",
			want:     []string{"0) + ' ' }"},
		},
		{
			name:     "text before a component",
			template: "<p>\n  see\n  <Badge label=\"x\"/>\n</p>",
			want:     []string{"value: 'see '"},
		},
		{
			name:     "text after a marker",
			template: "<p>\n  <Children/>\n  more\n</p>",
			want:     []string{"value: ' more'"},
		},
		{
			name:     "no whitespace in the source invents no space",
			template: "<p><b>x</b>{ y }<i>z</i>tail</p>",
			want:     []string{"value: 'tail'"},
			notWant:  []string{"' '", "' tail'"},
		},
		{
			name:     "element to element across a newline stays dropped",
			template: "<div>\n  <button>a</button>\n  <button>b</button>\n</div>",
			notWant:  []string{"' '", "value: ' "},
		},
		{
			name:     "element to element on one line keeps the space",
			template: "<div><b>a</b> <i>b</i></div>",
			want:     []string{"value: ' '"},
		},
		{
			name:     "parent edges keep the strip",
			template: "<p>\n  hello\n  <b>x</b>\n</p>",
			want:     []string{"value: 'hello '"},
			notWant:  []string{"value: ' hello"},
		},
	})
}

// D168 rule 6: a <pre>/<textarea> body keeps its bytes, subtree included,
// except the one newline HTML's parser drops directly after the start tag.
func TestPreAndTextareaBodiesPreserved(t *testing.T) {
	runWSCases(t, []wsCase{
		{
			name:     "pre keeps indentation and inner newlines, drops the first newline",
			template: "<pre>\n  line one\n    line two\n</pre>",
			want:     []string{`value: '  line one\n    line two\n'`},
		},
		{
			name:     "CRLF after the start tag is the one dropped newline",
			template: "<pre>\r\nx  y</pre>",
			want:     []string{"value: 'x  y'"},
		},
		{
			name:     "only one newline is dropped",
			template: "<pre>\n\nx</pre>",
			want:     []string{`value: '\nx'`},
		},
		{
			name:     "no newline after the start tag drops nothing",
			template: "<pre>  x\n</pre>",
			want:     []string{`value: '  x\n'`},
		},
		{
			name:     "textarea keeps its body",
			template: "<textarea>\n  a\n\n  b  </textarea>",
			want:     []string{`value: '  a\n\n  b  '`},
		},
		{
			name:     "descendants of pre are preserved, whitespace-only text included",
			template: "<pre><code>\n  a</code>\n<b>b</b>  <i>c</i>\n</pre>",
			want:     []string{`value: '\n  a'`, `value: '\n'`, `value: '  '`},
		},
		{
			name:     "interpolations inside pre keep their surrounding bytes",
			template: "<pre>x = { x }\n  y = { y }\n</pre>",
			want:     []string{`value: 'x = ' + __s(__d.x`, `+ '\n  y = ' + __s(__d.y`, `+ '\n' }`},
		},
		{
			name:     "a {#raw} first child keeps its leading newline (D150)",
			template: "<pre>{#raw}\nconst a = 1;\n{/raw}</pre>",
			want:     []string{`value: '\nconst a = 1;\n'`},
		},
		{
			name:     "a {#for} body inside pre still drops its own whitespace",
			template: "<pre>{#for l in lines}\n  <span>{ l }\n</span>\n{/for}</pre>",
			want:     []string{`+ '\n' }`},
		},
		{
			name:     "a sibling of pre is unaffected",
			template: "<div>\n  <pre>  a  </pre>\n  b\n</div>",
			want:     []string{"value: '  a  '", "value: ' b'"},
		},
		{
			name:     "a static pre is still cached, with the preserved text",
			template: "<section>\n  <pre>\n  a\n  </pre>\n  <p>x</p>\n</section>",
			want:     []string{"??= new ViewNode('section'", `value: '  a\n  '`},
		},
	})
}
