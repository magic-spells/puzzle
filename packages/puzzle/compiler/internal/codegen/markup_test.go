package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// markup_test.go — the D174 markup functions at the codegen boundary: a text
// interpolation whose outermost call is `raw` or `newline_to_br` lowers to the
// live-HTML vnode, and every other placement is a positioned compile error.

const markupScript = `
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`

func compileMarkup(t *testing.T, template string, mode EmissionMode) (string, error) {
	t.Helper()
	sec, err := parser.SplitSections(template+"\n"+markupScript, "T.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: mode})
	if err != nil {
		return "", err
	}
	return res.JS, nil
}

func TestMarkupInterpolationLowersToLiveHTML(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view>
  <p>Before { lead } { raw(truncate(body, 40)) } after</p>
  <p>{ newline_to_br(note) }</p>
</puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		// The markup call's argument compiles as a text interpolation's value
		// does; the markup function itself never reaches the registry.
		`new ViewNode('#html', { value: __s((__f["truncate"] || __f.__missing("truncate"))(__d.body, 40), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'raw(truncate(body, 40))' : 0) })`,
		`new ViewNode('#html', { value: __s(__d.note, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'newline_to_br(note)' : 0), br: true })`,
		// The markup node splits the coalesced text run the way an element does.
		`new ViewNode('text', { value: 'Before ' + __s(__d.lead, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'lead' : 0) + ' ' })`,
		`new ViewNode('text', { value: ' after' })`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in:\n%s", want, got)
		}
	}
	for _, forbidden := range []string{`__f["raw"]`, `__f["newline_to_br"]`, `"raw"`} {
		if strings.Contains(got, forbidden) {
			t.Errorf("markup function reached the registry (%s):\n%s", forbidden, got)
		}
	}
}

// A markup-only call reads nothing through the registry, so the file needs no
// `__f` binding at all.
func TestMarkupInterpolationNeedsNoFunctionRegistry(t *testing.T) {
	got, err := compileMarkup(t, "<puzzle-view>\n  <div>{ raw(html) }</div>\n</puzzle-view>", ModeView)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "this.ctx.formatters") {
		t.Errorf("markup-only template read the function registry:\n%s", got)
	}
}

// In a lowered {#for} row and an {#if} branch the node is an ordinary item.
func TestMarkupInterpolationInLoopsAndConditionals(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view>
  <ul>{#for c in comments}<li>{ c.author }: { raw(c.html) }</li>{/for}</ul>
  <div>{#if flag}{ raw(a) }{:else}plain{/if}</div>
</puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`__l(this, this, 0, __d.comments`,
		`new ViewNode('#html', { value: __s(s.item?.html`,
		`new ViewNode('#html', { value: __s(__d.a`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in:\n%s", want, got)
		}
	}
}

func TestMarkupFunctionPlacementErrors(t *testing.T) {
	for _, tt := range []struct {
		name, template, want string
		mode                 EmissionMode
	}{
		{"a method on the markup", `<puzzle-view><p>{ raw(body).trim() }</p></puzzle-view>`, "`raw` must be the outermost call", ModeView},
		{"escape around raw", `<puzzle-view><p>{ escape(raw(body)) }</p></puzzle-view>`, "`raw` must be the outermost call", ModeView},
		{"newline_to_br inside truncate", `<puzzle-view><p>{ truncate(newline_to_br(body), 5) }</p></puzzle-view>`, "`newline_to_br` must be the outermost call", ModeView},
		{"brace-only attribute", `<puzzle-view><p title={ raw(body) }>x</p></puzzle-view>`, "not an attribute value", ModeView},
		{"quoted attribute", `<puzzle-view><p title="a { raw(body) }">x</p></puzzle-view>`, "not an attribute value", ModeView},
		{"inline if attribute", `<puzzle-view><p class="{#if on}{ raw(a) }{/if}">x</p></puzzle-view>`, "not an attribute value", ModeView},
		{"inline if condition", `<puzzle-view><p class="{#if raw(on)}a{/if}">x</p></puzzle-view>`, "not an attribute value", ModeView},
		{"component prop", `<puzzle-view><Card body={ raw(body) } /></puzzle-view>`, "not a component prop", ModeView},
		{"marker argument", `<puzzle-view><Slot name="row" text={ newline_to_br(body) } /></puzzle-view>`, "not a marker argument", ModeComponent},
		{"if subject", `<puzzle-view>{#if raw(body)}<p>x</p>{/if}</puzzle-view>`, "not an {#if} condition", ModeView},
		{"case subject", `<puzzle-view>{#case raw(body)}{:when 'a'}<p>a</p>{/case}</puzzle-view>`, "not a {#case} expression", ModeView},
		{"arguments", `<puzzle-view><p>{ raw(body, 1) }</p></puzzle-view>`, "`raw` takes one argument", ModeView},
		{"inside textarea", `<puzzle-view><textarea>{ raw(body) }</textarea></puzzle-view>`, "cannot render inside <textarea>", ModeView},
		{"inside script", `<puzzle-view><script type="text/plain">{ raw(body) }</script></puzzle-view>`, "cannot render inside <script>", ModeView},
		{"inside noscript", `<puzzle-view><noscript>{ raw(body) }</noscript></puzzle-view>`, "cannot render inside <noscript>", ModeView},
		{"inside xmp", `<puzzle-view><xmp>{ newline_to_br(body) }</xmp></puzzle-view>`, "cannot render inside <xmp>", ModeView},
		{"inside iframe", `<puzzle-view><iframe>{ raw(body) }</iframe></puzzle-view>`, "cannot render inside <iframe>", ModeView},
		{"component root", `<puzzle-view>{ raw(body) }</puzzle-view>`, "root must be an element or component", ModeComponent},
		{"for body root", `<puzzle-view><ul>{#for c in cs}{ raw(c) }{/for}</ul></puzzle-view>`, "{#for} body root must be an element or component", ModeView},
		{"skeleton", "<puzzle-view><p>x</p></puzzle-view>\n<puzzle-skeleton><p title={ raw(a) }>x</p></puzzle-skeleton>", "not an attribute value", ModeView},
		// The <puzzle-view> root's own attributes are checked like any element's.
		{"root brace-only attribute", `<puzzle-view title={ raw(x) }><p>x</p></puzzle-view>`, "not an attribute value", ModeView},
		// Foreign content: the prerender would parse the markup as SVG/MathML.
		{"inside svg", `<puzzle-view><svg>{ raw(body) }</svg></puzzle-view>`, "cannot render inside <svg>", ModeView},
		{"nested in svg", `<puzzle-view><svg><g><text>{#if on}{ raw(body) }{/if}</text></g></svg></puzzle-view>`, "cannot render inside <svg>", ModeView},
		{"inside math", `<puzzle-view><math><mi>{ newline_to_br(body) }</mi></math></puzzle-view>`, "cannot render inside <math>", ModeView},
		// A component renders inline, so its children and snippet bodies keep the
		// surrounding element's context.
		{"component child in script", `<puzzle-view><script type="text/plain"><Card>{ raw(body) }</Card></script></puzzle-view>`, "cannot render inside <script>", ModeView},
		{"snippet body in textarea", `<puzzle-view><textarea><Card><Snippet fits="row">{ raw(body) }</Snippet></Card></textarea></puzzle-view>`, "cannot render inside <textarea>", ModeView},
		{"component child in svg", `<puzzle-view><svg><Icon>{ raw(body) }</Icon></svg></puzzle-view>`, "cannot render inside <svg>", ModeView},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := compileMarkup(t, tt.template, tt.mode)
			if err == nil {
				t.Fatalf("expected a compile error containing %q", tt.want)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want it to contain %q", err, tt.want)
			}
			// Positioned: the parser error format carries file:line:col.
			if !strings.Contains(err.Error(), "T.pzl:") {
				t.Errorf("error is not positioned: %v", err)
			}
		})
	}
}

// An SVG <foreignObject> hosts HTML again (the runtime's namespace rule and
// the HTML parser's integration point agree), so a markup interpolation there
// is legal; a <Portal> body renders at the framework outlet, not inside the
// element around it.
func TestMarkupInterpolationAllowedOutsideForeignContent(t *testing.T) {
	for _, template := range []string{
		`<puzzle-view><svg><foreignObject><div>{ raw(body) }</div></foreignObject></svg></puzzle-view>`,
		`<puzzle-view><svg><foreignObject>{ raw(body) }</foreignObject></svg></puzzle-view>`,
		`<puzzle-view><Card><Snippet fits="row"><p>{ raw(body) }</p></Snippet></Card></puzzle-view>`,
		`<puzzle-view><textarea><Portal><div>{ raw(body) }</div></Portal></textarea></puzzle-view>`,
	} {
		got, err := compileMarkup(t, template, ModeView)
		if err != nil {
			t.Errorf("%s: unexpected error %v", template, err)
			continue
		}
		if !strings.Contains(got, "new ViewNode('#html'") {
			t.Errorf("%s: expected the live-HTML node:\n%s", template, got)
		}
	}
}

// A markup interpolation is a non-text sibling under the D168 whitespace rule,
// exactly like an element: text wrapped onto the lines next to it keeps one
// space on each side instead of gluing to the markup, and indentation at the
// parent's edges is still dropped.
func TestMarkupInterpolationWhitespaceMatchesElement(t *testing.T) {
	const wrapped = `<puzzle-view>
  <p>
    Read the
    %s
    before you start.
  </p>
</puzzle-view>`
	markup, err := compileMarkup(t, strings.Replace(wrapped, "%s", "{ raw(intro) }", 1), ModeView)
	if err != nil {
		t.Fatal(err)
	}
	element, err := compileMarkup(t, strings.Replace(wrapped, "%s", "<b>intro</b>", 1), ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`new ViewNode('text', { value: 'Read the ' })`,
		`new ViewNode('text', { value: ' before you start.' })`,
	} {
		if !strings.Contains(markup, want) {
			t.Errorf("markup interpolation: missing %s in:\n%s", want, markup)
		}
		if !strings.Contains(element, want) {
			t.Errorf("element control: missing %s in:\n%s", want, element)
		}
	}
	// Same-line neighbours keep their literal single space too.
	inline, err := compileMarkup(t, "<puzzle-view><p>a { raw(x) } b</p></puzzle-view>", ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`new ViewNode('text', { value: 'a ' })`, `new ViewNode('text', { value: ' b' })`} {
		if !strings.Contains(inline, want) {
			t.Errorf("missing %s in:\n%s", want, inline)
		}
	}
}
