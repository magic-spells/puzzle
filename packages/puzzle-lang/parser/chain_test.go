package parser

import (
	"strings"
	"testing"
)

// chain_test.go — D173 V1: a top-level single `|` is a formatter pipe in every
// template value position (brace-only attributes, component props, marker
// arguments, and the {#if}/{:else if}/{#unless}/{#case} subjects, plus an
// attribute value's inline {#if}), exactly as in text interpolation. A pipe in a
// {#for} header is a positioned error.

func fmtNames(fmts []FormatterCall) string {
	names := make([]string, len(fmts))
	for i, f := range fmts {
		names[i] = f.Name
		if len(f.Args) > 0 {
			names[i] += "(" + strings.Join(f.Args, ", ") + ")"
		}
	}
	return strings.Join(names, " | ")
}

func dynamicAttr(t *testing.T, attrs []Attr, name string) *DynamicAttr {
	t.Helper()
	for _, a := range attrs {
		if d, ok := a.(*DynamicAttr); ok && d.Name == name {
			return d
		}
	}
	t.Fatalf("no dynamic attr %q", name)
	return nil
}

func TestChainInBraceOnlyAttribute(t *testing.T) {
	root := parseContent(t, `<a title={ price | currency } data-x={ a || b } data-r={ /a|b/.test(s) } data-s={ 'a|b' } data-c={ f(a | b) }>x</a>`)
	el := elementChildren(root.Children)[0].(*Element)

	title := dynamicAttr(t, el.Attrs, "title")
	if title.Expr != "price" || fmtNames(title.Formatters) != "currency" {
		t.Errorf("title: got %q | %q", title.Expr, fmtNames(title.Formatters))
	}
	// `||`, a regex, a string and a parenthesized `|` are not pipes.
	for name, want := range map[string]string{
		"data-x": "a || b",
		"data-r": "/a|b/.test(s)",
		"data-s": "'a|b'",
		"data-c": "f(a | b)",
	} {
		d := dynamicAttr(t, el.Attrs, name)
		if d.Expr != want || len(d.Formatters) != 0 {
			t.Errorf("%s: got %q with chain %q, want %q and no chain", name, d.Expr, fmtNames(d.Formatters), want)
		}
	}
}

func TestChainInComponentPropAndMarkerArg(t *testing.T) {
	root := parseContent(t, `<Card items={ list | join(', ') | truncate(20) }><Children item={ row | default({ id: 1 }) }/></Card>`)
	card := elementChildren(root.Children)[0].(*Component)
	items := dynamicAttr(t, card.Props, "items")
	if items.Expr != "list" || fmtNames(items.Formatters) != "join(', ') | truncate(20)" {
		t.Errorf("prop: got %q | %q", items.Expr, fmtNames(items.Formatters))
	}
	slot := elementChildren(card.Children)[0].(*Slot)
	arg := dynamicAttr(t, slot.Args, "item")
	if arg.Expr != "row" || fmtNames(arg.Formatters) != "default({ id: 1 })" {
		t.Errorf("marker arg: got %q | %q", arg.Expr, fmtNames(arg.Formatters))
	}
}

func TestChainInBlockHeaders(t *testing.T) {
	root := parseContent(t, `{#if post.tags | size}<b>a</b>{:else if other | size}<b>b</b>{/if}`+
		`{#unless user.name | blank}<b>c</b>{/unless}`+
		`{#unless ready}<b>d</b>{/unless}`+
		`{#case status | downcase}{:when 'a'}<b>e</b>{/case}`+
		`{#if a || b}<b>f</b>{/if}`)
	kids := elementChildren(root.Children)

	ifn := kids[0].(*If)
	if ifn.Cond != "post.tags" || fmtNames(ifn.Formatters) != "size" || ifn.Negate {
		t.Errorf("{#if}: got %q | %q negate=%v", ifn.Cond, fmtNames(ifn.Formatters), ifn.Negate)
	}
	elseIf := elementChildren(ifn.Else)[0].(*If)
	if elseIf.Cond != "other" || fmtNames(elseIf.Formatters) != "size" {
		t.Errorf("{:else if}: got %q | %q", elseIf.Cond, fmtNames(elseIf.Formatters))
	}

	// {#unless} with a chain keeps the bare base and sets Negate, so the chain
	// runs before the negation.
	unless := kids[1].(*If)
	if unless.Cond != "user.name" || fmtNames(unless.Formatters) != "blank" || !unless.Negate {
		t.Errorf("{#unless} chain: got %q | %q negate=%v", unless.Cond, fmtNames(unless.Formatters), unless.Negate)
	}
	// Without a chain the negation stays folded into Cond, as it always was.
	plain := kids[2].(*If)
	if plain.Cond != "!(ready)" || plain.Negate || len(plain.Formatters) != 0 {
		t.Errorf("{#unless} plain: got %q negate=%v", plain.Cond, plain.Negate)
	}

	cs := kids[3].(*Case)
	if cs.Expr != "status" || fmtNames(cs.Formatters) != "downcase" {
		t.Errorf("{#case}: got %q | %q", cs.Expr, fmtNames(cs.Formatters))
	}

	or := kids[4].(*If)
	if or.Cond != "a || b" || len(or.Formatters) != 0 {
		t.Errorf("`||` must stay logical OR: got %q | %q", or.Cond, fmtNames(or.Formatters))
	}
}

func TestChainInAttributeInlineIf(t *testing.T) {
	root := parseContent(t, `<p class="x {#if on | truthy}on{/if}">z</p>`)
	el := elementChildren(root.Children)[0].(*Element)
	mixed := el.Attrs[0].(*MixedAttr)
	var inline *InlineIfPart
	for _, p := range mixed.Parts {
		if ip, ok := p.(*InlineIfPart); ok {
			inline = ip
		}
	}
	if inline == nil || inline.Cond != "on" || fmtNames(inline.Formatters) != "truthy" {
		t.Fatalf("inline {#if}: got %+v", inline)
	}
}

func TestChainEmptyPositionsAreErrors(t *testing.T) {
	for _, src := range []string{
		`<a title={ price | }>x</a>`,
		`{#if a | }<b>x</b>{/if}`,
		`{#case | f}{:when 1}<b>x</b>{/case}`,
	} {
		_, err := Parse([]byte("<puzzle-view>"+src+"</puzzle-view>"), "t.pzl")
		if err == nil {
			t.Errorf("expected an error for %s", src)
		}
	}
}

// TestForHeaderPipeIsError: a pipe anywhere in a {#for} header — the
// collection or either range bound — is a positioned error whose fix-it names
// data(). `||` and a `|` nested in parentheses are not pipes.
func TestForHeaderPipeIsError(t *testing.T) {
	for _, header := range []string{
		"item in items | split(',')",
		"item in items | compact_number, i",
		"1...count | round",
		"start | floor...9, n",
	} {
		src := "<puzzle-view>\n  {#for " + header + "}<b>x</b>{/for}</puzzle-view>"
		_, err := Parse([]byte(src), "t.pzl")
		if err == nil {
			t.Errorf("{#for %s}: expected the pipe ban", header)
			continue
		}
		pe, ok := err.(*ParseError)
		if !ok {
			t.Fatalf("{#for %s}: got %T, want *ParseError", header, err)
		}
		if !strings.Contains(pe.Message, "formatter pipes are not allowed in a {#for} header") || !strings.Contains(pe.Message, "data()") {
			t.Errorf("{#for %s}: message %q", header, pe.Message)
		}
		if pe.Line != 2 || pe.Col != 3 {
			t.Errorf("{#for %s}: position %d:%d, want 2:3 (the {#for} opener)", header, pe.Line, pe.Col)
		}
	}
	for _, header := range []string{"item in a || b", "item in pick(a | b)", "1...(a | b)"} {
		src := "<puzzle-view>{#for " + header + "}<b>x</b>{/for}</puzzle-view>"
		if _, err := Parse([]byte(src), "t.pzl"); err != nil {
			t.Errorf("{#for %s}: unexpected error %v", header, err)
		}
	}
}

// TestPipeMustNameAFormatter: after a top-level `|`, anything that is not a
// formatter name — a number, an operator, two words — is a positioned error
// steering to a parenthesized bitwise OR, in text interpolation and in every
// chained value position alike.
func TestPipeMustNameAFormatter(t *testing.T) {
	for _, src := range []string{
		"<puzzle-view>\n  <p>{ flags | 4 }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ w / 2 | 0 }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a |= 2 }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | b c }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | 9x(1) }</p></puzzle-view>",
		"<puzzle-view>\n  <a title={ flags | 4 }>x</a></puzzle-view>",
		"<puzzle-view>\n  {#if flags | 4}<b>x</b>{/if}</puzzle-view>",
		"<puzzle-view>\n  <Card n={ a | -1 }/></puzzle-view>",
	} {
		_, err := Parse([]byte(src), "t.pzl")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Errorf("%s: got %v, want a *ParseError", src, err)
			continue
		}
		if !strings.Contains(pe.Message, "is not a formatter name") || !strings.Contains(pe.Message, "(a | b)") {
			t.Errorf("%s: message %q", src, pe.Message)
		}
		if pe.Line != 2 {
			t.Errorf("%s: line %d, want 2", src, pe.Line)
		}
	}
	// Every registry-shaped name still parses, bare or called.
	for _, src := range []string{
		"<p>{ a | upcase }</p>",
		"<p>{ a | strip_html | truncate(20) }</p>",
		"<p>{ a | $fmt }</p>",
		"<p>{ a | _private }</p>",
		"<p>{ a | kebab-name }</p>",
		"<p>{ a | v2 }</p>",
		"<p>{ (a | b) }</p>",
	} {
		if _, err := Parse([]byte("<puzzle-view>"+src+"</puzzle-view>"), "t.pzl"); err != nil {
			t.Errorf("%s: unexpected error %v", src, err)
		}
	}
}

// TestWhenValuePipeIsError: a {:when} value takes no chain, so a top-level
// pipe there is a positioned error rather than a silent bitwise OR.
func TestWhenValuePipeIsError(t *testing.T) {
	src := "<puzzle-view>{#case s}\n  {:when a | b}<b>x</b>{/case}</puzzle-view>"
	_, err := Parse([]byte(src), "t.pzl")
	pe, ok := err.(*ParseError)
	if !ok {
		t.Fatalf("got %v, want a *ParseError", err)
	}
	if !strings.Contains(pe.Message, "not allowed in a {:when} value") || !strings.Contains(pe.Message, "(a | b)") {
		t.Errorf("message %q", pe.Message)
	}
	if pe.Line != 2 {
		t.Errorf("line %d, want 2", pe.Line)
	}
	for _, clause := range []string{"{:when 'a|b'}", "{:when (a | b)}", "{:when a || b}", "{:when 1, 2}"} {
		src := "<puzzle-view>{#case s}" + clause + "<b>x</b>{/case}</puzzle-view>"
		if _, err := Parse([]byte(src), "t.pzl"); err != nil {
			t.Errorf("%s: unexpected error %v", clause, err)
		}
	}
}

// TestFormatterCallMustEndTheSegment: a called formatter's '(' must be matched
// by the segment's last ')'. The parser used to check only for a trailing ')'
// and slice between the first '(' and it, so `{ a | f(1) + g(2) }` became
// f with the single argument `1) + g(2` and compiled silently to
// `f(a, 1) + g(2)`. Anything after the matching ')' is a positioned error.
func TestFormatterCallMustEndTheSegment(t *testing.T) {
	for _, src := range []string{
		"<puzzle-view>\n  <p>{ a | f(1) + g(2) }</p></puzzle-view>",
		"<puzzle-view>\n  {#if x | f(a) && g(b)}<b>x</b>{/if}</puzzle-view>",
		"<puzzle-view>\n  <a title={ a | f(1) g(2) }>x</a></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | f(b)(c) }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | f(1)) }</p></puzzle-view>",
		"<puzzle-view>\n  <Card n={ a | f(1).x }/></puzzle-view>",
	} {
		_, err := Parse([]byte(src), "t.pzl")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Errorf("%s: got %v, want a *ParseError", src, err)
			continue
		}
		if !strings.Contains(pe.Message, "after its closing ')'") {
			t.Errorf("%s: message %q", src, pe.Message)
		}
		if pe.Line != 2 {
			t.Errorf("%s: line %d, want 2", src, pe.Line)
		}
	}
	// An argument list that never closes keeps its own error.
	_, err := Parse([]byte("<puzzle-view><p>{ a | f(1 }</p></puzzle-view>"), "t.pzl")
	if pe, ok := err.(*ParseError); !ok || !strings.Contains(pe.Message, "missing closing ')'") {
		t.Errorf("unclosed call: got %v", err)
	}
	// A ')' inside a string, regex, template or nested group is not the close.
	for src, want := range map[string]string{
		`{ a | replace(')', '(') | upcase }`: `replace(')', '(') | upcase`,
		`{ a | f(/\)/, "x)") }`:              `f(/\)/, "x)")`,
		"{ a | f(`)${ (b) }`) }":             "f(`)${ (b) }`)",
		`{ a | t({ n: (1) }) }`:              `t({ n: (1) })`,
		`{ a | f((1), [2]) }`:                `f((1), [2])`,
		`{ a | f() }`:                        `f`,
	} {
		root := parseContent(t, "<p>"+src+"</p>")
		p := elementChildren(root.Children)[0].(*Element)
		in := p.Children[0].(*Interpolation)
		if got := fmtNames(in.Formatters); got != want {
			t.Errorf("%s: chain %q, want %q", src, got, want)
		}
	}
}

// TestFormatterNameHyphenStartsAWord: a '-' in a formatter name must start a
// kebab segment — a letter follows it — so `{ mask | bit-1 }` is arithmetic
// the author meant as JavaScript, not a lookup of a formatter named `bit-1`
// that would pass the value through silently at runtime.
func TestFormatterNameHyphenStartsAWord(t *testing.T) {
	for _, src := range []string{
		"<puzzle-view>\n  <a title={ mask | bit-1 }>x</a></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | b-2(3) }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | b- }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | b--c }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | b-_c }</p></puzzle-view>",
		// A dotted name is a member expression, not a formatter name (the
		// DOC-LANGUAGE-CORE grammar has no '.').
		"<puzzle-view>\n  <p>{ price | fmt.eur }</p></puzzle-view>",
	} {
		_, err := Parse([]byte(src), "t.pzl")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Errorf("%s: got %v, want a *ParseError", src, err)
			continue
		}
		if !strings.Contains(pe.Message, "is not a formatter name") {
			t.Errorf("%s: message %q", src, pe.Message)
		}
		if pe.Line != 2 {
			t.Errorf("%s: line %d, want 2", src, pe.Line)
		}
	}
	for _, src := range []string{
		"<p>{ a | foo-bar }</p>",
		"<p>{ a | strip-html-v2 }</p>",
		"<p>{ a | a-b-c(1) }</p>",
		"<p>{ a | x2-y_z$ }</p>",
	} {
		if _, err := Parse([]byte("<puzzle-view>"+src+"</puzzle-view>"), "t.pzl"); err != nil {
			t.Errorf("%s: unexpected error %v", src, err)
		}
	}
}
