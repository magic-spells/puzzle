package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// markup_test.go — the D174 markup formatters at the codegen boundary: a text
// interpolation whose chain ends in `raw` or `newline_to_br` lowers to the
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
  <p>Before { lead } { body | truncate(40) | raw } after</p>
  <p>{ note | newline_to_br }</p>
</puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		// The chain before the markup formatter compiles as a text chain does; the
		// markup formatter itself never reaches the registry.
		`new ViewNode('#html', { value: __s((__f["truncate"] || __f.__missing("truncate"))(__d.body, 40), typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'body' : 0) })`,
		`new ViewNode('#html', { value: __s(__d.note, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'note' : 0), br: true })`,
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
			t.Errorf("markup formatter reached the registry (%s):\n%s", forbidden, got)
		}
	}
}

// A markup-only chain reads nothing through the registry, so the file needs no
// `__f` binding at all.
func TestMarkupInterpolationNeedsNoFormatterRegistry(t *testing.T) {
	got, err := compileMarkup(t, "<puzzle-view>\n  <div>{ html | raw }</div>\n</puzzle-view>", ModeView)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "this.ctx.formatters") {
		t.Errorf("markup-only template read the formatter registry:\n%s", got)
	}
}

// In a lowered {#for} row and an {#if} branch the node is an ordinary item.
func TestMarkupInterpolationInLoopsAndConditionals(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view>
  <ul>{#for c in comments}<li>{ c.author }: { c.html | raw }</li>{/for}</ul>
  <div>{#if flag}{ a | raw }{:else}plain{/if}</div>
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

func TestMarkupFormatterPlacementErrors(t *testing.T) {
	for _, tt := range []struct {
		name, template, want string
		mode                 EmissionMode
	}{
		{"mid-chain", `<puzzle-view><p>{ body | raw | upcase }</p></puzzle-view>`, "`raw` must be the last formatter in the chain", ModeView},
		{"escape after raw", `<puzzle-view><p>{ body | raw | escape }</p></puzzle-view>`, "`raw` must be the last formatter in the chain", ModeView},
		{"newline_to_br mid-chain", `<puzzle-view><p>{ body | newline_to_br | truncate(5) }</p></puzzle-view>`, "`newline_to_br` must be the last formatter", ModeView},
		{"brace-only attribute", `<puzzle-view><p title={ body | raw }>x</p></puzzle-view>`, "not an attribute value", ModeView},
		{"quoted attribute", `<puzzle-view><p title="a { body | raw }">x</p></puzzle-view>`, "not an attribute value", ModeView},
		{"inline if attribute", `<puzzle-view><p class="{#if on}{ a | raw }{/if}">x</p></puzzle-view>`, "not an attribute value", ModeView},
		{"inline if condition", `<puzzle-view><p class="{#if on | raw}a{/if}">x</p></puzzle-view>`, "not an inline {#if} condition", ModeView},
		{"component prop", `<puzzle-view><Card body={ body | raw } /></puzzle-view>`, "not a component prop", ModeView},
		{"marker argument", `<puzzle-view><Slot name="row" text={ body | newline_to_br } /></puzzle-view>`, "not a marker argument", ModeComponent},
		{"if subject", `<puzzle-view>{#if body | raw}<p>x</p>{/if}</puzzle-view>`, "not an {#if} subject", ModeView},
		{"case subject", `<puzzle-view>{#case body | raw}{:when 'a'}<p>a</p>{/case}</puzzle-view>`, "not a {#case} subject", ModeView},
		{"arguments", `<puzzle-view><p>{ body | raw(1) }</p></puzzle-view>`, "`raw` takes no arguments", ModeView},
		{"inside textarea", `<puzzle-view><textarea>{ body | raw }</textarea></puzzle-view>`, "cannot render inside <textarea>", ModeView},
		{"inside script", `<puzzle-view><script type="text/plain">{ body | raw }</script></puzzle-view>`, "cannot render inside <script>", ModeView},
		{"inside noscript", `<puzzle-view><noscript>{ body | raw }</noscript></puzzle-view>`, "cannot render inside <noscript>", ModeView},
		{"inside xmp", `<puzzle-view><xmp>{ body | newline_to_br }</xmp></puzzle-view>`, "cannot render inside <xmp>", ModeView},
		{"inside iframe", `<puzzle-view><iframe>{ body | raw }</iframe></puzzle-view>`, "cannot render inside <iframe>", ModeView},
		{"component root", `<puzzle-view>{ body | raw }</puzzle-view>`, "root must be an element or component", ModeComponent},
		{"for body root", `<puzzle-view><ul>{#for c in cs}{ c | raw }{/for}</ul></puzzle-view>`, "{#for} body root must be an element or component", ModeView},
		{"skeleton", "<puzzle-view><p>x</p></puzzle-view>\n<puzzle-skeleton><p title={ a | raw }>x</p></puzzle-skeleton>", "not an attribute value", ModeView},
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
	markup, err := compileMarkup(t, strings.Replace(wrapped, "%s", "{ intro | raw }", 1), ModeView)
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
	inline, err := compileMarkup(t, "<puzzle-view><p>a { x | raw } b</p></puzzle-view>", ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`new ViewNode('text', { value: 'a ' })`, `new ViewNode('text', { value: ' b' })`} {
		if !strings.Contains(inline, want) {
			t.Errorf("missing %s in:\n%s", want, inline)
		}
	}
}
