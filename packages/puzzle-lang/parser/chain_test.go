package parser

import (
	"strings"
	"testing"
)

// chain_test.go — D173 V1: a top-level single `|` is a formatter pipe in every
// template value position (brace-only attributes, component props, marker
// arguments), exactly as in text interpolation. A pipe in a condition or
// branching header — {#if}, {:else if}, {#unless}, {#case}, {:when}, {#for}, and
// an attribute value's inline {#if} — is a positioned error.

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

// TestConditionHeaderPipeIsError: formatters are display helpers and stay out of
// branching logic, so a top-level `|` in an {#if}, {:else if}, {#unless} or
// {#case} header, or in an attribute value's inline {#if}, is a positioned error
// whose fix-it moves the computation into data(). It never compiles to a
// bitwise OR.
func TestConditionHeaderPipeIsError(t *testing.T) {
	for _, tc := range []struct {
		src, header string
		line, col   int
	}{
		{"{#if post.tags | size}<b>a</b>{/if}", "an {#if} condition", 2, 3},
		{"{#if flags | 4}<b>a</b>{/if}", "an {#if} condition", 2, 3},
		{"{#if ok}<b>a</b>\n  {:else if other | size}<b>b</b>{/if}", "an {:else if} condition", 3, 3},
		{"{#unless user.name | blank}<b>c</b>{/unless}", "an {#unless} condition", 2, 3},
		{"{#case status | downcase}{:when 'a'}<b>e</b>{/case}", "a {#case} expression", 2, 3},
		{`<p class="x {#if on | truthy}on{/if}">z</p>`, "an {#if} condition in an attribute value", 2, 15},
	} {
		src := "<puzzle-view>\n  " + tc.src + "</puzzle-view>"
		_, err := Parse([]byte(src), "t.pzl")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Errorf("%s: got %v, want a *ParseError", tc.src, err)
			continue
		}
		want := "formatter pipes are not allowed in " + tc.header + " — compute the value in data()"
		if !strings.Contains(pe.Message, want) || !strings.Contains(pe.Message, "||") {
			t.Errorf("%s: message %q, want it to contain %q", tc.src, pe.Message, want)
		}
		if pe.Line != tc.line || pe.Col != tc.col {
			t.Errorf("%s: position %d:%d, want %d:%d", tc.src, pe.Line, pe.Col, tc.line, tc.col)
		}
	}
}

// TestConditionHeaderKeepsJavaScriptOr: `||`, and a `|` inside parentheses, a
// string, a regex or a call, are not pipes, so every condition header keeps
// them as JavaScript.
func TestConditionHeaderKeepsJavaScriptOr(t *testing.T) {
	root := parseContent(t, `{#if a || b}<b>a</b>{:else if c || d}<b>b</b>{/if}`+
		`{#unless a || b}<b>c</b>{/unless}`+
		`{#case a || b}{:when 'a'}<b>e</b>{/case}`+
		`{#if (flags | 4) && /x|y/.test(s) && s !== 'p|q' && f(a | b)}<b>f</b>{/if}`)
	kids := elementChildren(root.Children)

	ifn := kids[0].(*If)
	if ifn.Cond != "a || b" {
		t.Errorf("{#if}: got %q", ifn.Cond)
	}
	if elseIf := elementChildren(ifn.Else)[0].(*If); elseIf.Cond != "c || d" {
		t.Errorf("{:else if}: got %q", elseIf.Cond)
	}
	if unless := kids[1].(*If); unless.Cond != "!(a || b)" {
		t.Errorf("{#unless}: got %q", unless.Cond)
	}
	if cs := kids[2].(*Case); cs.Expr != "a || b" {
		t.Errorf("{#case}: got %q", cs.Expr)
	}
	if nested := kids[3].(*If); nested.Cond != "(flags | 4) && /x|y/.test(s) && s !== 'p|q' && f(a | b)" {
		t.Errorf("nested pipes: got %q", nested.Cond)
	}

	root = parseContent(t, `<p class="x {#if a || b}on{/if}">z</p>`)
	mixed := elementChildren(root.Children)[0].(*Element).Attrs[0].(*MixedAttr)
	var inline *InlineIfPart
	for _, p := range mixed.Parts {
		if ip, ok := p.(*InlineIfPart); ok {
			inline = ip
		}
	}
	if inline == nil || inline.Cond != "a || b" {
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
// chained value position alike. (In a condition header the pipe itself is the
// error — see TestConditionHeaderPipeIsError.)
func TestPipeMustNameAFormatter(t *testing.T) {
	for _, src := range []string{
		"<puzzle-view>\n  <p>{ flags | 4 }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ w / 2 | 0 }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a |= 2 }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | b c }</p></puzzle-view>",
		"<puzzle-view>\n  <p>{ a | 9x(1) }</p></puzzle-view>",
		"<puzzle-view>\n  <a title={ flags | 4 }>x</a></puzzle-view>",
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
