package parser

import (
	"strings"
	"testing"
)

// chain_test.go — D173 V1: a top-level single `|` is a formatter pipe in every
// template value position (brace-only attributes, component props, marker
// arguments), exactly as in text interpolation. A pipe in a condition or
// branching header — {#if}, {:else if}, {#unless}, {#case}, {:when}, {#for}, and
// an attribute value's inline {#if} — is a positioned error, and so is a single
// `|` below the top level of any value (D176: there is no bitwise OR).

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
	root := parseContent(t, `<a title={ price | currency } data-x={ a || b } data-r={ /a|b/.test(s) } data-s={ 'a|b' } data-c={ f(a || b) }>x</a>`)
	el := elementChildren(root.Children)[0].(*Element)

	title := dynamicAttr(t, el.Attrs, "title")
	if title.Expr != "price" || fmtNames(title.Formatters) != "currency" {
		t.Errorf("title: got %q | %q", title.Expr, fmtNames(title.Formatters))
	}
	// `||` (nested too), a regex and a string are not pipes.
	for name, want := range map[string]string{
		"data-x": "a || b",
		"data-r": "/a|b/.test(s)",
		"data-s": "'a|b'",
		"data-c": "f(a || b)",
	} {
		d := dynamicAttr(t, el.Attrs, name)
		if d.Expr != want || len(d.Formatters) != 0 {
			t.Errorf("%s: got %q with chain %q, want %q and no chain", name, d.Expr, fmtNames(d.Formatters), want)
		}
	}
}

func TestChainInComponentPropAndMarkerArg(t *testing.T) {
	root := parseContent(t, `<Card items={ list | join(', ') | truncate(20) }><Children item={ row | t({ id: 1 }) }/></Card>`)
	card := elementChildren(root.Children)[0].(*Component)
	items := dynamicAttr(t, card.Props, "items")
	if items.Expr != "list" || fmtNames(items.Formatters) != "join(', ') | truncate(20)" {
		t.Errorf("prop: got %q | %q", items.Expr, fmtNames(items.Formatters))
	}
	slot := elementChildren(card.Children)[0].(*Slot)
	arg := dynamicAttr(t, slot.Args, "item")
	if arg.Expr != "row" || fmtNames(arg.Formatters) != "t({ id: 1 })" {
		t.Errorf("marker arg: got %q | %q", arg.Expr, fmtNames(arg.Formatters))
	}
}

// TestConditionHeaderPipeIsError: formatters are display helpers and stay out of
// branching logic, so a top-level `|` in an {#if}, {:else if}, {#unless} or
// {#case} header, or in an attribute value's inline {#if}, is a positioned error
// whose fix-it computes the value first (D176 rule 4). It never compiles
// to a bitwise OR.
func TestConditionHeaderPipeIsError(t *testing.T) {
	for _, tc := range []struct {
		src, header, example string
		line, col            int
	}{
		{"{#if post.tags | join}<b>a</b>{/if}", "an {#if} condition", "{#if hasTags}", 2, 3},
		{"{#if flags | 4}<b>a</b>{/if}", "an {#if} condition", "{#if hasTags}", 2, 3},
		// A pipe in a ternary branch is still top-level: the ternary does not
		// nest it, so it is the ban, never a bitwise OR.
		{"{#if a ? b | c : d}<b>a</b>{/if}", "an {#if} condition", "{#if hasTags}", 2, 3},
		{"{#if ok}<b>a</b>\n  {:else if other | join}<b>b</b>{/if}", "an {:else if} condition", "{:else if hasTags}", 3, 3},
		{"{#unless user.name | blank}<b>c</b>{/unless}", "an {#unless} condition", "{#unless hasTags}", 2, 3},
		{"{#case status | downcase}{:when 'a'}<b>e</b>{/case}", "a {#case} expression", "{#case statusLabel}", 2, 3},
		// A bitwise OR before 0.8: still the pipe ban, never an OR.
		{"{#case mode | 1}{:when 3}<b>e</b>{/case}", "a {#case} expression", "{#case statusLabel}", 2, 3},
		{`<p class="x {#if on | truthy}on{/if}">z</p>`, "an {#if} condition in an attribute value", "{#if isActive}", 2, 15},
	} {
		src := "<puzzle-view>\n  " + tc.src + "</puzzle-view>"
		_, err := Parse([]byte(src), "t.pzl")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Errorf("%s: got %v, want a *ParseError", tc.src, err)
			continue
		}
		want := "formatter pipes are not allowed in " + tc.header +
			" — compute the value first (a data() field in PuzzleKit, {#let} in Sites) and test that field, e.g. " +
			tc.example + "; write || for a logical OR"
		if pe.Message != want {
			t.Errorf("%s: message\n  %q\nwant\n  %q", tc.src, pe.Message, want)
		}
		if pe.Line != tc.line || pe.Col != tc.col {
			t.Errorf("%s: position %d:%d, want %d:%d", tc.src, pe.Line, pe.Col, tc.line, tc.col)
		}
	}
}

// TestConditionHeaderKeepsJavaScriptOr: `||` (at any depth), and a `|` inside
// a string, a regex or a template literal, are not pipes, so every condition
// header keeps them as written.
func TestConditionHeaderKeepsJavaScriptOr(t *testing.T) {
	root := parseContent(t, `{#if a || b}<b>a</b>{:else if c || d}<b>b</b>{/if}`+
		`{#unless a || b}<b>c</b>{/unless}`+
		`{#case a || b}{:when 'a'}<b>e</b>{/case}`+
		`{#if (a || b) && /x|y/.test(s) && s !== 'p|q' && f(a || b)}<b>f</b>{/if}`+
		"{#if `x${a | b}` === s}<b>g</b>{/if}")
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
	if nested := kids[3].(*If); nested.Cond != "(a || b) && /x|y/.test(s) && s !== 'p|q' && f(a || b)" {
		t.Errorf("nested pipes: got %q", nested.Cond)
	}
	// A `|` inside a template literal's ${…} is nested JavaScript, not a pipe.
	if tpl := kids[4].(*If); tpl.Cond != "`x${a | b}` === s" {
		t.Errorf("template literal: got %q", tpl.Cond)
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
// data(). `||` is not a pipe; a nested single `|` is TestNestedPipeIsError's.
func TestForHeaderPipeIsError(t *testing.T) {
	for _, header := range []string{
		"item in items | join(',')",
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
	for _, header := range []string{"item in a || b", "item in pick(a || b)", "1...(a || b)"} {
		src := "<puzzle-view>{#for " + header + "}<b>x</b>{/for}</puzzle-view>"
		if _, err := Parse([]byte(src), "t.pzl"); err != nil {
			t.Errorf("{#for %s}: unexpected error %v", header, err)
		}
	}
}

// TestPipeMustNameAFormatter: after a top-level `|`, anything that is not a
// formatter name — a number, an operator, two words — is a positioned error
// naming what a formatter name is (there is no bitwise OR to steer to), in
// text interpolation and in every chained value position alike. (In a condition header the pipe itself is the
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
		if !strings.Contains(pe.Message, "is not a formatter name (an identifier, optionally kebab-case like my-format) — a top-level `|` in a template expression is a formatter pipe") ||
			strings.Contains(pe.Message, "(a | b)") {
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
		"<p>{ (a || b) | upcase }</p>",
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
	if !strings.Contains(pe.Message, "not allowed in a {:when} value") || strings.Contains(pe.Message, "bitwise") {
		t.Errorf("message %q", pe.Message)
	}
	if pe.Line != 2 {
		t.Errorf("line %d, want 2", pe.Line)
	}
	for _, clause := range []string{"{:when 'a|b'}", "{:when (a || b)}", "{:when a || b}", "{:when 1, 2}"} {
		src := "<puzzle-view>{#case s}" + clause + "<b>x</b>{/case}</puzzle-view>"
		if _, err := Parse([]byte(src), "t.pzl"); err != nil {
			t.Errorf("%s: unexpected error %v", clause, err)
		}
	}
}

// TestNestedPipeIsError: a single `|` below the top level of a value — inside
// (), [] or {}, a formatter argument included — is a positioned error in every
// value position and header, never a bitwise OR (D176 rule 4). A value
// position points at the `|`; a block header, at its `{`.
func TestNestedPipeIsError(t *testing.T) {
	const want = "a formatter pipe must be at the top level of the value — there is no bitwise OR in templates; compute the value first (a data() field in PuzzleKit, {#let} in Sites)"
	for _, tc := range []struct {
		src       string
		line, col int
	}{
		{"<p>{ save(x | trim) }</p>", 2, 15},
		{"<p>{ !(draft | trim) | upcase }</p>", 2, 16},
		{"<p>{\n    [a | b][0] }</p>", 3, 8},
		{"<p>{ a | truncate(n | 1) }</p>", 2, 23},
		{"<a title={ f(a | b) }>x</a>", 2, 18},
		{`<p class="x { f(a | b) } y">z</p>`, 2, 21},
		{`<p class="x {#if on}{ f(a | b) }{/if}">z</p>`, 2, 29},
		{"<Card n={ { v: a | b } }/>", 2, 20},
		{"<Card><Children item={ f(a | b) }/></Card>", 2, 30},
		{"{#for x in xs}<b key={ id(x | 1) }>y</b>{/for}", 2, 31},
		{"{#for item in pick(a | b)}<b>x</b>{/for}", 2, 3},
		{"{#for 1...(a | b), n}<b>x</b>{/for}", 2, 3},
		{"{#case s}{:when (a | b)}<b>x</b>{/case}", 2, 12},
		{"{#if (flags | 4) === 4}<b>a</b>{/if}", 2, 3},
		{"{#if ok}<b>a</b>{:else if f(a | b)}<b>b</b>{/if}", 2, 19},
		{"{#unless !(a | b)}<b>c</b>{/unless}", 2, 3},
		{"{#case [a | b][0]}{:when 1}<b>d</b>{/case}", 2, 3},
		{`<p class="x {#if f(on | 1)}on{/if}">z</p>`, 2, 15},
	} {
		src := "<puzzle-view>\n  " + tc.src + "</puzzle-view>"
		_, err := Parse([]byte(src), "t.pzl")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Errorf("%s: got %v, want a *ParseError", tc.src, err)
			continue
		}
		if pe.Message != want {
			t.Errorf("%s: message %q", tc.src, pe.Message)
		}
		if pe.Line != tc.line || pe.Col != tc.col {
			t.Errorf("%s: position %d:%d, want %d:%d", tc.src, pe.Line, pe.Col, tc.line, tc.col)
		}
	}
	// `||` at any depth, and a `|` in a string, regex, template literal or
	// comment, are not pipes.
	for _, src := range []string{
		"<p>{ f(a || b) | upcase }</p>",
		"<p>{ [a || b, 'x|y', /p|q/] | json }</p>",
		"<p>{ a | join(' | ') }</p>",
		"<p>{ f(`${a}|${b}`) }</p>",
		"<p>{ f(a /* x | y */) }</p>",
		"<a title={ f({ k: 'a|b' }) }>x</a>",
		"{#if f(a || b) && /x|y/.test(s)}<b>a</b>{/if}",
		"{#for x in pick(a || b)}<b>x</b>{/for}",
		"{#case s}{:when ('a|b')}<b>x</b>{/case}",
	} {
		if _, err := Parse([]byte("<puzzle-view>"+src+"</puzzle-view>"), "t.pzl"); err != nil {
			t.Errorf("%s: unexpected error %v", src, err)
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
		"<puzzle-view>\n  <p>{ x | f(a) && g(b) }</p></puzzle-view>",
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
