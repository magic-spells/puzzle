package parser

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// exprs_test.go — every expression position carries a parsed tree at its own
// file position, an expression error lands on the offending token wherever
// the expression sits, and `event` is legal exactly where it is bound.

// at returns the 1-based line and byte column where marker first occurs in src.
func at(t *testing.T, src, marker string) (int, int) {
	t.Helper()
	i := strings.Index(src, marker)
	if i < 0 {
		t.Fatalf("marker %q not in source", marker)
	}
	line := 1 + strings.Count(src[:i], "\n")
	return line, i - strings.LastIndex(src[:i], "\n")
}

func wantPos(t *testing.T, what string, n expr.Node, src, marker string) {
	t.Helper()
	if n == nil {
		t.Errorf("%s: no tree", what)
		return
	}
	line, col := at(t, src, marker)
	if p := n.Pos(); p.Line != line || p.Col != col {
		t.Errorf("%s: tree at %d:%d, want %d:%d (%q)", what, p.Line, p.Col, line, col, marker)
	}
	if p := n.Pos(); src[p.Offset:p.Offset+len(marker)] != marker {
		t.Errorf("%s: offset %d does not start %q", what, p.Offset, marker)
	}
}

func TestEveryExpressionPositionHasATree(t *testing.T) {
	src := "<puzzle-view class={ rootClass }>\n" +
		"  <p title={ t1 | fmt(a1, x => x.a2) } data-q=\"s {  q1 } {#if   c1 }on{/if}\" @click={ go(event, h1) }>{ i1 | pad( a3 ,  a4 ) }</p>\n" +
		"  {#if  c2 }<b>a</b>{:else if\n    c3 }<b>b</b>{/if}\n" +
		"  {#unless  (u1) }<b>c</b>{/unless}\n" +
		"  {#case   s1 }{:when  w1 ,  w2 }<b>d</b>{/case}\n" +
		"  {#for item in  coll1 , i}<li key={ k1 }>x</li>{/for}\n" +
		"  {#for  r1 ... r2 }<li>y</li>{/for}\n" +
		"  <Card n={ p1 }><Children item={ m1 }/></Card>\n" +
		"</puzzle-view>\n" +
		"<puzzle-skeleton><p>{ sk1 }</p></puzzle-skeleton>\n<script></script>"
	sec, err := SplitSections(src, "t.pzl")
	if err != nil {
		t.Fatal(err)
	}
	root, err := ParseTemplate(sec, "t.pzl")
	if err != nil {
		t.Fatal(err)
	}
	wantPos(t, "view root attribute", root.Attrs[0].(*DynamicAttr).ExprAST, src, "rootClass")

	kids := elementChildren(root.Children)
	p := kids[0].(*Element)
	title := p.Attrs[0].(*DynamicAttr)
	wantPos(t, "attribute", title.ExprAST, src, "t1")
	wantPos(t, "attribute formatter argument", title.Formatters[0].ArgsAST[0], src, "a1")
	if _, ok := title.Formatters[0].ArgsAST[1].(*expr.Arrow); !ok {
		t.Errorf("a formatter argument is a call argument, so an arrow is legal: got %T", title.Formatters[0].ArgsAST[1])
	}
	mixed := p.Attrs[1].(*MixedAttr)
	wantPos(t, "quoted attribute interpolation", mixed.Parts[1].(*InterpPart).Interp.ExprAST, src, "q1")
	wantPos(t, "inline {#if}", mixed.Parts[3].(*InlineIfPart).CondAST, src, "c1")
	wantPos(t, "handler", p.Attrs[2].(*EventAttr).ExprAST, src, "go(event")
	interp := p.Children[0].(*Interpolation)
	wantPos(t, "interpolation", interp.ExprAST, src, "i1")
	if len(interp.Formatters[0].ArgsAST) != len(interp.Formatters[0].Args) {
		t.Errorf("ArgsAST must align with Args")
	}
	wantPos(t, "formatter argument 1", interp.Formatters[0].ArgsAST[0], src, "a3")
	wantPos(t, "formatter argument 2", interp.Formatters[0].ArgsAST[1], src, "a4")

	ifn := kids[1].(*If)
	wantPos(t, "{#if}", ifn.CondAST, src, "c2")
	wantPos(t, "{:else if} on its own line", elementChildren(ifn.Else)[0].(*If).CondAST, src, "c3")

	unless := kids[2].(*If)
	if unless.Cond != "!((u1))" {
		t.Errorf("{#unless} keeps its folded Cond string for codegen: %q", unless.Cond)
	}
	neg, ok := unless.CondAST.(*expr.Unary)
	if !ok || neg.Op != "!" || expr.Print(neg) != "(! u1)" {
		t.Fatalf("{#unless} tree must be a ! over the parsed condition, got %T %v", unless.CondAST, unless.CondAST)
	}
	wantPos(t, "{#unless}", neg, src, "(u1)")
	wantPos(t, "{#unless} operand", neg.Operand, src, "u1")

	cs := kids[3].(*Case)
	wantPos(t, "{#case}", cs.ExprAST, src, "s1")
	wantPos(t, "{:when} value 1", cs.Clauses[0].ValuesAST[0], src, "w1")
	wantPos(t, "{:when} value 2", cs.Clauses[0].ValuesAST[1], src, "w2")

	loop := kids[4].(*For)
	wantPos(t, "{#for} collection", loop.CollectionAST, src, "coll1")
	wantPos(t, "key", elementChildren(loop.Body)[0].(*Element).Attrs[0].(*DynamicAttr).ExprAST, src, "k1")
	rng := kids[5].(*For)
	wantPos(t, "range start", rng.RangeFromAST, src, "r1")
	wantPos(t, "range end", rng.RangeToAST, src, "r2")

	card := kids[6].(*Component)
	wantPos(t, "component prop", card.Props[0].(*DynamicAttr).ExprAST, src, "p1")
	wantPos(t, "marker argument", card.Children[0].(*Slot).Args[0].(*DynamicAttr).ExprAST, src, "m1")

	skel, err := ParseSkeleton(sec, "t.pzl")
	if err != nil {
		t.Fatal(err)
	}
	wantPos(t, "skeleton", elementChildren(skel.Children)[0].(*Element).Children[0].(*Interpolation).ExprAST, src, "sk1")
}

// An expression error is a ParseError on the offending token, wherever the
// expression sits — including headers the lexer trims, bodies after odd
// white space, and lines below the construct's opener.
func TestExpressionErrorsLandOnTheToken(t *testing.T) {
	for _, body := range []string{
		"<p>{ a +  b & c }</p>",
		"<p>{ a | fmt(1,  b & c) }</p>",
		"<p title={  b & c }>x</p>",
		`<p title="x {  b & c } y">x</p>`,
		`<p class="x {#if   b & c}on{/if}">x</p>`,
		"<button @click={ go( b & c) }>x</button>",
		"{#if   b & c}<b>a</b>{/if}",
		"{#if a}<b>a</b>{:else if    b & c}<b>b</b>{/if}",
		"{#if a}<b>a</b>{:else if\n      b & c}<b>b</b>{/if}",
		"{#unless  b & c}<b>a</b>{/unless}",
		"{#case  b & c}{:when 1}<b>a</b>{/case}",
		"{#case s}{:when 1,   b & c}<b>a</b>{/case}",
		"{#for x in   b & c}<b>a</b>{/for}",
		"{#for x in b & c, i}<b>a</b>{/for}",
		"{#for 1...  b & c}<b>a</b>{/for}",
		"{#for\n  b & c ...9}<b>a</b>{/for}",
		"<Card n={ b & c }/>",
		"<Card><Children item={ b & c }/></Card>",
	} {
		src := "<puzzle-view>\n  " + body + "\n</puzzle-view>"
		_, err := Parse([]byte(src), "t.pzl")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Errorf("%s: got %v, want a ParseError", body, err)
			continue
		}
		line, col := at(t, src, "& ")
		if pe.Line != line || pe.Col != col || !strings.HasPrefix(pe.Message, "bitwise operators are not available") {
			t.Errorf("%s: got %d:%d %s, want %d:%d", body, pe.Line, pe.Col, pe.Message, line, col)
		}
	}
}

func TestEventIsHandlerOnlyUnlessBound(t *testing.T) {
	ok := []string{
		"<button @click={ go(event) }>x</button>",
		"<button @click={ event ? a : null }>x</button>",
		"{#for event in events}<p title={ event.name }>{ event.id }</p>{/for}",
		"{#for x in xs, event}<p>{ event }</p>{/for}",
		"{#for 1...3, event}<p>{ event }</p>{/for}",
		"{#for event in events}{#for x in event.items}<p>{ event.id }</p>{/for}{/for}",
		`<Card><Snippet fits="row" event>{ event.id }</Snippet></Card>`,
		"<p>{ items | fmt(event => event.id) }</p>",
		"<p>{ event2 }{ events }</p>",
	}
	for _, body := range ok {
		if _, err := Parse([]byte("<puzzle-view>"+body+"</puzzle-view>"), "t.pzl"); err != nil {
			t.Errorf("%s: %v", body, err)
		}
	}
	bad := []string{
		"<p>{ event }</p>",
		"<p title={ event.x }>x</p>",
		"{#if event}<b>a</b>{/if}",
		// A loop's header is outside its own scope.
		"{#for event in event.items}<b>a</b>{/for}",
		// The binding ends with its loop.
		"{#for event in events}<b>a</b>{/for}<p>{ event }</p>",
		`<Card><Snippet fits="row" item>{ event }</Snippet></Card>`,
	}
	for _, body := range bad {
		_, err := Parse([]byte("<puzzle-view>"+body+"</puzzle-view>"), "t.pzl")
		pe, isPE := err.(*ParseError)
		if !isPE || pe.Message != "`event` is only available in an event handler" {
			t.Errorf("%s: got %v, want the event error", body, err)
		}
	}
}
