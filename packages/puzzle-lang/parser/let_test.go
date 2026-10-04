package parser_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// letOpts is a host that turns {#let} on and runs its own composition checks,
// as Sites does.
var letOpts = parser.Options{Let: true, SkipIslandCheck: true, SkipSlotCheck: true, SkipRefCheck: true}

// letView puts a body on line 2 of a file, so a diagnostic's line proves it is
// in file coordinates.
func letView(body string) string { return "\n" + body + "\n" }

func parseLetMarkup(t *testing.T, src string) (*parser.Element, error) {
	t.Helper()
	return parser.ParseMarkup(src, parser.Position{}, "templates/Test.pzl", letOpts)
}

func mustParseLet(t *testing.T, src string) *parser.Element {
	t.Helper()
	root, err := parseLetMarkup(t, src)
	if err != nil {
		t.Fatalf("parse %q: %v", src, err)
	}
	return root
}

// findLets collects every {#let} in a tree, depth first.
func findLets(nodes []parser.Node) []*parser.Let {
	var out []*parser.Let
	for _, n := range nodes {
		switch n := n.(type) {
		case *parser.Let:
			out = append(out, n)
		case *parser.Element:
			out = append(out, findLets(n.Children)...)
		case *parser.For:
			out = append(out, findLets(n.Body)...)
		case *parser.If:
			out = append(out, findLets(n.Then)...)
			out = append(out, findLets(n.Else)...)
		}
	}
	return out
}

// The {#let} spellings that must parse.
func TestLetAccepted(t *testing.T) {
	for _, tt := range []struct{ name, body string }{
		{"single line", `  {#let total = price * qty}`},
		{"multiline", "  {#let\n    total = price * qty\n    due = total - 1\n  }"},
		{"function call", `  {#let due = currency(total, '$', 2)}`},
		{"ternary", `  {#let tone = member ? 'warm' : 'plain'}`},
		{"array literal", `  {#let tags = ['a', 'b']}`},
		{"object literal", `  {#let card = { title: 'é', 'quoted key': 2 }}`},
		{"comparison is not an assignment", `  {#let same = a == b}`},
		{"equals inside a string", `  {#let q = 'a = b'}`},
		{"blank lines between assignments", "  {#let\n\n    a = 1\n\n    b = 2\n\n  }"},
		{"reassigned in a later block", `  {#let n = 1}{#let n = 2}`},
		{"inside a loop body", `  {#for x in items}{#let y = x}{/for}`},
		{"underscore name", `  {#let _private = 1}`},
		{"unicode name", `  {#let größe = 1}`},
		{"newline inside brackets", "  {#let\n    tags = [\n      'a',\n      'b'\n    ]\n  }"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			root := mustParseLet(t, letView(tt.body))
			if len(findLets(root.Children)) == 0 {
				t.Fatalf("no {#let} in %#v", root.Children)
			}
		})
	}
}

// The tree a {#let} builds, with every position in file coordinates.
func TestLetTree(t *testing.T) {
	src := "<div>\n  {#let\n    total = price * qty\n    due   =  total - 1\n  }\n</div>"
	lets := findLets(mustParseLet(t, src).Children)
	if len(lets) != 1 {
		t.Fatalf("lets = %d", len(lets))
	}
	let := lets[0]
	if let.Pos != (parser.Position{Line: 2, Col: 3, Offset: 8}) {
		t.Errorf("Pos = %+v", let.Pos)
	}
	want := []struct {
		name, expr      string
		nameAt, valueAt parser.Position
	}{
		{"total", "price * qty", parser.Position{Line: 3, Col: 5, Offset: 18}, parser.Position{Line: 3, Col: 13, Offset: 26}},
		{"due", "total - 1", parser.Position{Line: 4, Col: 5, Offset: 42}, parser.Position{Line: 4, Col: 14, Offset: 51}},
	}
	if len(let.Bindings) != len(want) {
		t.Fatalf("bindings = %+v", let.Bindings)
	}
	for i, w := range want {
		b := let.Bindings[i]
		if b.Name != w.name || b.Interp.Expr != w.expr || b.NamePos != w.nameAt || b.ExprPos != w.valueAt {
			t.Errorf("binding %d = %s=%q at %+v / %+v; want %s=%q at %+v / %+v",
				i, b.Name, b.Interp.Expr, b.NamePos, b.ExprPos, w.name, w.expr, w.nameAt, w.valueAt)
		}
		if b.Interp.Pos != b.ExprPos || b.Interp.ExprAST == nil {
			t.Errorf("binding %d Interp = %+v", i, b.Interp)
		}
		if got := b.Interp.ExprAST.Pos(); got.Line != w.valueAt.Line || got.Col != w.valueAt.Col || got.Offset != w.valueAt.Offset {
			t.Errorf("binding %d tree starts at %+v, want %+v", i, got, w.valueAt)
		}
	}
}

// The {#let} mistakes that must be reported where an author can act on them.
func TestLetDiagnostics(t *testing.T) {
	for _, tt := range []struct {
		name, body, message string
		line, col           int
	}{
		{"empty header", `  {#let}`, "{#let} requires at least one assignment — a {#let} names values: {#let total = price * qty}", 2, 3},
		{"blank multiline header", "  {#let\n\n  }", "{#let} requires at least one assignment — a {#let} names values: {#let total = price * qty}", 2, 3},
		{"missing equals", `  {#let total}`, `{#let} assignment "total" is missing '=' — write name = expression, one per line`, 2, 9},
		{"compound assignment", `  {#let total += 1}`, `{#let} assignment "total += 1" is missing '=' — write name = expression, one per line`, 2, 9},
		{"missing value", `  {#let total = }`, `{#let} assignment "total" is missing a value — write name = expression`, 2, 9},
		{"missing name", `  {#let = 1}`, `{#let} assignment "= 1" is missing '=' — write name = expression, one per line`, 2, 9},
		{"bad name", `  {#let a.b = 1}`, `{#let} name "a.b" is not a name — use letters, digits and underscores, starting with a letter`, 2, 9},
		{"reserved name", `  {#let class = 1}`, `{#let} name "class" is reserved`, 2, 9},
		{"global name", `  {#let Math = 1}`, `{#let} name "Math" is a JavaScript global and cannot name a binding`, 2, 9},
		{"literal name", `  {#let NaN = 1}`, `{#let} name "NaN" is a literal value and cannot name a binding`, 2, 9},
		{"duplicate name in one block", "  {#let\n    a = 1\n    a = 2\n  }", "{#let} names \"a\" twice in one block — already assigned at 3:5", 4, 5},
		{"second line is diagnosed at its own line", "  {#let\n    a = 1\n    b\n  }", `{#let} assignment "b" is missing '=' — write name = expression, one per line`, 4, 5},
		{"expression error at the token", "  {#let\n    a = 1 +\n  }", "", 3, 0},
		{"pipe is the language's steer", `  {#let due = total | currency}`, "", 2, 21},
		{"unknown block suggests let", `  {#assign total = 1}`, "unknown block {#assign} — did you mean {#let}? a {#let} names values: {#let total = price * qty}", 2, 3},
		{"set suggests let", `  {#set total = 1}`, "unknown block {#set} — did you mean {#let}? a {#let} names values: {#let total = price * qty}", 2, 3},
		{"unknown block lists let", `  {#while x}`, "unknown block {#while} (expected {#if}, {#unless}, {#for}, {#case}, {#let}, or {#svg})", 2, 3},
		{"stray closer", `  {#let a = 1}{/let}`, "", 2, 16},
		{"let before the first when", "  {#case x}{#let a = 1}{:when 1}one{/case}", "content between {#case} and its first {:when} must be whitespace", 2, 12},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseLetMarkup(t, letView(tt.body))
			var pe *parser.ParseError
			if !errors.As(err, &pe) {
				t.Fatalf("want a positioned error, got %v", err)
			}
			if tt.message != "" && pe.Message != tt.message {
				t.Errorf("message = %q\n want %q", pe.Message, tt.message)
			}
			if pe.File != "templates/Test.pzl" || pe.Line != tt.line || (tt.col != 0 && pe.Col != tt.col) {
				t.Errorf("at %s:%d:%d, want %d:%d (%s)", pe.File, pe.Line, pe.Col, tt.line, tt.col, pe.Message)
			}
		})
	}
}

// A {#let} name reaches the expressions after it as a binding — it reads, and
// calling it is an error, exactly as a {#for} item — and only until its child
// list ends.
func TestLetScope(t *testing.T) {
	const called = "is a template variable here and cannot be called"
	for _, tt := range []struct {
		name, src string
		err       bool
	}{
		{"free name calls the library", `{ t('k') }`, false},
		{"later text", `{#let t = 1}{ t('k') }`, true},
		{"later attribute", `{#let t = 1}<p title={ t('k') }></p>`, true},
		{"later quoted attribute", `{#let t = 1}<p title="a { t('k') }"></p>`, true},
		{"later block header", `{#let t = 1}{#if t('k')}x{/if}`, true},
		{"nested element", `{#let t = 1}<div><p>{ t('k') }</p></div>`, true},
		{"loop body", `{#let t = 1}{#for x in xs}{ t('k') }{/for}`, true},
		{"next assignment", "{#let\n  t = 1\n  u = t('k')\n}", true},
		{"own value reads the outer name", `{#let t = t('k')}`, false},
		{"before the block", `{ t('k') }{#let t = 1}`, false},
		{"ends with the element", `<div>{#let t = 1}</div>{ t('k') }`, false},
		{"ends with the branch", `{#if a}{#let t = 1}{:else}{ t('k') }{/if}`, false},
		{"ends with the else-if branch", `{#if a}x{:else if b}{#let t = 1}{:else}{ t('k') }{/if}`, false},
		{"ends with the loop body", `{#for x in xs}{#let t = 1}{/for}{ t('k') }`, false},
		{"ends with the when clause", `{#case k}{:when 1}{#let t = 1}{:when 2}{ t('k') }{/case}`, false},
		{"loop counter stays bound", `{#for x in xs, i}{#let y = i}{/for}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseLetMarkup(t, tt.src)
			if tt.err {
				if err == nil || !strings.Contains(err.Error(), "`t` "+called) {
					t.Fatalf("want the binding-call error, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// With Let on, a wrapped file parses {#let} through every entry point, and the
// checks a host leaves on still run beside it.
func TestLetThroughEntryPoints(t *testing.T) {
	src := "<puzzle-view>\n  {#let total = price * qty}\n  <p>{ total }</p>\n</puzzle-view>\n<script>export default class extends PuzzleView {}</script>\n"
	opts := parser.Options{Let: true}
	root, err := parser.Parse([]byte(src), "views/Home.pzl", opts)
	if err != nil {
		t.Fatal(err)
	}
	if lets := findLets(root.Children); len(lets) != 1 || lets[0].Bindings[0].Name != "total" {
		t.Fatalf("lets = %+v", lets)
	}
	file, err := parser.ParseFile([]byte(src), "views/Home.pzl", opts)
	if err != nil || len(findLets(file.Root.Children)) != 1 {
		t.Fatalf("ParseFile: %v", err)
	}
	dup := "<puzzle-view>{#let a = 1}<p ref=\"x\"></p><p ref=\"x\"></p></puzzle-view>"
	if _, err := parser.Parse([]byte(dup), "views/Home.pzl", opts); err == nil || !strings.Contains(err.Error(), "duplicate ref name") {
		t.Fatalf("ref check did not run beside {#let}: %v", err)
	}
}
