package parser

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

func TestScanBraceGroupRegex(t *testing.T) {
	cases := []struct {
		name      string
		s         string
		wantInner string
		wantEnd   int
		wantErr   bool
	}{
		{"plain", "{ a }x", " a ", 5, false},
		{"string with brace", "{ '}' }", " '}' ", 7, false},
		{"nested object", "{ {a: 1} }", " {a: 1} ", 10, false},
		// A '}' inside a regex must not terminate the group early.
		{"regex with close brace", "{ /}/.test(x) }", " /}/.test(x) ", 15, false},
		// A regex may begin immediately after '{'; only known complete block
		// closers reserve that slash for template structure.
		{"regex immediately after brace", "{/\\d+/.test(x)}", "/\\d+/.test(x)", len("{/\\d+/.test(x)}"), false},
		// A regex character class holding a '}' is still skipped whole.
		{"regex class with brace", "{ /[}]/.test(x) }", " /[}]/.test(x) ", 17, false},
		// A comment containing a '}' must not terminate the group.
		{"block comment with brace", "{ a /* } */ }", " a /* } */ ", 13, false},
		{"line comment with brace", "{ a // }\n}", " a // }\n", 10, false},
		// A nested template literal inside ${…} must stay opaque to the outer
		// brace scan, including its otherwise-structural closing brace.
		{"nested template interpolation", "{ `outer ${`inner }`}` }tail", " `outer ${`inner }`}` ", 24, false},
		// The block-close marker is structural, not a regex.
		{"close tag", "{/if}", "/if", 5, false},
		{"block open unaffected", "{#if a}", "#if a", 7, false},
		{"unclosed", "{ a ", "", 0, true},
		// A literal left open by a trailing backslash at EOF must still report the
		// unclosed group, not run its scanner past the end of the source.
		{"unterminated regex at eof", `{/a\`, "", 0, true},
		{"unterminated string at eof", `{ 'a\`, "", 0, true},
		{"unterminated template literal at eof", "{ `a\\", "", 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			inner, end, err := scanBraceGroup(tc.s, 0)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("scanBraceGroup(%q) = (%q, %d), want error", tc.s, inner, end)
				}
				return
			}
			if err != nil {
				t.Fatalf("scanBraceGroup(%q) unexpected error: %v", tc.s, err)
			}
			if inner != tc.wantInner || end != tc.wantEnd {
				t.Errorf("scanBraceGroup(%q) = (%q, %d), want (%q, %d)", tc.s, inner, end, tc.wantInner, tc.wantEnd)
			}
		})
	}
}

func TestScanBraceGroupKnownClosers(t *testing.T) {
	for _, src := range []string{
		"{/if}", "{/ unless }", "{/case}", "{/ for}", "{/svg }", "{/ comment }", "{/ raw }",
	} {
		t.Run(src, func(t *testing.T) {
			inner, end, err := scanBraceGroup(src, 0)
			if err != nil {
				t.Fatalf("scanBraceGroup(%q): %v", src, err)
			}
			if end != len(src) || inner != src[1:len(src)-1] {
				t.Fatalf("scanBraceGroup(%q) = (%q, %d)", src, inner, end)
			}
		})
	}
}

func TestSplitTopLevelLexical(t *testing.T) {
	cases := []struct {
		name string
		s    string
		sep  byte
		want []string
	}{
		// Comma splitting for {:when} values, respecting a regex comma-free body.
		{"comma args with regex", "/a,b/, x", ',', []string{"/a,b/", " x"}},
		{"nested commas not split", "f(a, b), c", ',', []string{"f(a, b)", " c"}},
		{"comma in a string", "'a,b', c", ',', []string{"'a,b'", " c"}},
		{"comma in a comment", "a /* , */, b", ',', []string{"a /* , */", " b"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := splitTopLevel(tc.s, tc.sep)
			if strings.Join(got, "\x00") != strings.Join(tc.want, "\x00") {
				t.Errorf("splitTopLevel(%q, %q) = %#v, want %#v", tc.s, tc.sep, got, tc.want)
			}
		})
	}
}

func TestLastTopLevelIndexByteLexical(t *testing.T) {
	cases := []struct {
		name string
		s    string
		sep  byte
		want int
	}{
		{"top level comma", "a, b", ',', 1},
		{"comma in regex ignored", "/a,b/", ',', -1},
		{"comma in call ignored, trailing counted", "f(a, b), i", ',', 7},
		{"comma in string ignored", "'a,b'", ',', -1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := lastTopLevelIndexByte(tc.s, tc.sep); got != tc.want {
				t.Errorf("lastTopLevelIndexByte(%q, %q) = %d, want %d", tc.s, tc.sep, got, tc.want)
			}
		})
	}
}

func TestTopLevelIndexLexical(t *testing.T) {
	cases := []struct {
		name string
		s    string
		sub  string
		want int
	}{
		{"range operator", "0...n", "...", 1},
		{"range in nested ignored", "[0...9]", "...", -1},
		{"no dots in regex", "/a...b/", "...", -1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := topLevelIndex(tc.s, tc.sub); got != tc.want {
				t.Errorf("topLevelIndex(%q, %q) = %d, want %d", tc.s, tc.sub, got, tc.want)
			}
		})
	}
}

func TestLexSkip(t *testing.T) {
	cases := []struct {
		name         string
		s            string
		i            int
		prevEndsExpr bool
		wantNext     int
		wantPEE      bool
		wantConsumed bool
	}{
		{"single-quote string", "'ab' x", 0, false, 4, true, true},
		{"template literal", "`ab` x", 0, false, 4, true, true},
		{"template literal with nested interpolation", "`outer ${`inner }`}` x", 0, false, 20, true, true},
		{"string with escape", "'a\\'b' x", 0, false, 6, true, true},
		{"regex after non-value", "/ab/g x", 0, false, 5, true, true},
		{"regex with class", "/[)]/ x", 0, false, 5, true, true},
		{"division not consumed", "/ b", 0, true, 0, true, false},
		{"line comment", "// c\nx", 0, false, 4, false, true},
		{"block comment", "/* c */x", 0, false, 7, false, true},
		{"identifier run", "abc+", 0, false, 3, true, true},
		{"keyword return leaves regex", "return /x/", 0, false, 6, false, true},
		{"keyword as property ends expr", ".return /x/", 1, false, 7, true, true},
		{"contextual of ends expr", "of /x/", 0, false, 2, true, true},
		{"keyword-shaped tail of a non-ASCII name ends expr", "価格new /x/", len("価格"), false, len("価格new"), true, true},
		{"increment preserves expression-ending state", "++ / b", 0, true, 2, true, true},
		{"decrement preserves expression-start state", "--a / b", 0, false, 2, false, true},
		{"operator not consumed", "+ a", 0, false, 0, false, false},
		{"bracket not consumed", ") a", 0, false, 0, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			next, pee, consumed := LexSkip(tc.s, tc.i, tc.prevEndsExpr)
			if next != tc.wantNext || pee != tc.wantPEE || consumed != tc.wantConsumed {
				t.Errorf("LexSkip(%q, %d, %v) = (%d, %v, %v), want (%d, %v, %v)",
					tc.s, tc.i, tc.prevEndsExpr, next, pee, consumed, tc.wantNext, tc.wantPEE, tc.wantConsumed)
			}
		})
	}
}

func TestLexSkipUpdateOperatorsBeforeSlash(t *testing.T) {
	cases := []struct {
		name      string
		expr      string
		wantRegex bool
	}{
		{"postfix increment", "a++ / b", false},
		{"postfix decrement", "a-- / b", false},
		{"member postfix increment", "this.i++ / n", false},
		{"prefix increment", "++i / n", false},
		{"prefix decrement", "--i / n", false},
		{"increment followed by plus then regex", "a+++/re/.source", true},
		{"decrement followed by minus then regex", "a--- /re/.source", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			slash := strings.IndexByte(tc.expr, '/')
			if slash < 0 {
				t.Fatal("test fixture has no slash")
			}

			prevEndsExpr := false
			for i := 0; i <= slash; {
				next, pee, consumed := LexSkip(tc.expr, i, prevEndsExpr)
				if i == slash {
					if consumed != tc.wantRegex {
						t.Fatalf("slash in %q classified as regex = %v, want %v", tc.expr, consumed, tc.wantRegex)
					}
					return
				}
				if consumed {
					prevEndsExpr = pee
					i = next
					continue
				}
				prevEndsExpr = LexPlainEndsExpr(tc.expr[i], prevEndsExpr)
				i++
			}
			t.Fatalf("scanner skipped target slash in %q", tc.expr)
		})
	}
}

// TestLexScanRegexLiteralUnterminated pins the doc-comment contract: an
// unterminated literal returns len(s) EXACTLY. A trailing backslash used to skip
// its escape pair PAST the end and return len(s)+1, which made
// lexRegexLiteralClosed index s[len(s)].
func TestLexScanRegexLiteralUnterminated(t *testing.T) {
	cases := []struct {
		name string
		s    string
		want int
	}{
		{"trailing backslash", `/a\`, 3},
		{"trailing backslash after body", `/abc\`, 5},
		{"trailing backslash in class", `/[a\`, 4},
		{"bare slash at eof", `/`, 1},
		{"unterminated class", `/[ab`, 4},
		// Terminated literals are unaffected: body + flags, escaped slash, class.
		{"closed with flags", `/ab/gi`, 6},
		{"closed with escaped slash", `/a\/b/`, 6},
		{"closed with class", `/[/]/`, 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := lexScanRegexLiteral(tc.s, 0); got != tc.want {
				t.Errorf("lexScanRegexLiteral(%q) = %d, want %d (len %d)", tc.s, got, tc.want, len(tc.s))
			}
		})
	}
}

// TestParseTrailingBackslashPositionedError is the end-to-end guard for the same
// overshoot: a .pzl whose template ends inside a literal opened by a trailing
// backslash must fail with a POSITIONED "unclosed '{'" parse error — the author
// needs a file/line for the typo — rather than dying in an index-out-of-range
// panic with a raw Go stack trace.
func TestParseTrailingBackslashPositionedError(t *testing.T) {
	cases := []struct {
		name string
		src  string
	}{
		{"regex-shaped closer", `<puzzle-view>{/a\</puzzle-view>`},
		{"regex-shaped closer with script", `<puzzle-view><div>{/a\</puzzle-view>` + "\n<script></script>"},
		{"string literal", `<puzzle-view>{ 'a\</puzzle-view>`},
		{"template literal", "<puzzle-view>{ `a\\</puzzle-view>"},
		{"interpolation ending in backslash", `<puzzle-view>{ a\`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected a parse error, got nil")
			}
			pe, ok := err.(*ParseError)
			if !ok {
				t.Fatalf("expected *ParseError, got %T (%v)", err, err)
			}
			if pe.Line < 1 || pe.Col < 1 {
				t.Errorf("error is not positioned: %d:%d (%s)", pe.Line, pe.Col, pe.Message)
			}
		})
	}
}

// A postfix update before a division must not hide the interpolation's close:
// the brace scan ends the group at the right `}`, so the error is the
// expression grammar's own `++` error at the operator, never an unclosed '{'.
func TestParsePostfixUpdateBeforeDivisionClosesInterpolation(t *testing.T) {
	src := `<puzzle-view>
  <div>{ index++ / total }</div>
</puzzle-view>
<script>
export default class A {}
</script>`
	_, err := Parse([]byte(src), "A.pzl")
	pe, ok := err.(*ParseError)
	if !ok {
		t.Fatalf("want the `++` ParseError, got %v", err)
	}
	if !strings.Contains(pe.Message, "`++` and `--` are not available") || pe.Line != 2 || pe.Col != 15 {
		t.Fatalf("postfix update before division must be the grammar's `++` error at 2:15, got %d:%d %s", pe.Line, pe.Col, pe.Message)
	}
}

func TestLexPlainEndsExpr(t *testing.T) {
	cases := []struct {
		c    byte
		prev bool
		want bool
	}{
		{' ', true, true},   // whitespace leaves state unchanged
		{' ', false, false}, // whitespace leaves state unchanged
		{')', false, true},  // closing bracket ends an expression
		{']', false, true},
		{'}', false, true},
		{'5', false, true},  // digit ends an expression
		{'.', false, true},  // a trailing-dot number (`5.`) ends an expression
		{0xA9, false, true}, // last byte of `é`: a non-ASCII name ends an expression
		{0x80, false, true},
		{0xFF, false, true},
		{'+', true, false}, // operator does not end an expression
		{'(', true, false}, // opening bracket does not end an expression
		{',', true, false},
	}
	for _, tc := range cases {
		if got := LexPlainEndsExpr(tc.c, tc.prev); got != tc.want {
			t.Errorf("LexPlainEndsExpr(%q, %v) = %v, want %v", tc.c, tc.prev, got, tc.want)
		}
	}
}

// firstExprAST returns the tree of the first expression position in nodes,
// depth first: an interpolation, an element attribute value, or an {#if}
// condition.
func firstExprAST(nodes []Node) expr.Node {
	for _, n := range nodes {
		switch t := n.(type) {
		case *Interpolation:
			return t.ExprAST
		case *If:
			return t.CondAST
		case *Element:
			for _, a := range t.Attrs {
				if d, ok := a.(*DynamicAttr); ok {
					return d.ExprAST
				}
			}
			if x := firstExprAST(t.Children); x != nil {
				return x
			}
		}
	}
	return nil
}

// A '/' after any operand is division in every template position. The brace
// scan used to take a '/' after a name ending in a non-ASCII letter, after a
// trailing-dot number, or after a field named `of` for a regex opener and run
// past the closing '}', so the expression grammar never saw a division it
// accepts (conformance: `café / 2`) and the author got "unclosed '{'".
func TestParseDivisionInEveryTemplatePosition(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    string
	}{
		{"text interpolation, accented name", "<p>{ café / 2 }</p>", "(/ café 2)"},
		{"attribute value, CJK name", "<p title={ 金額 / 2 }>x</p>", "(/ 金額 2)"},
		{"{#if} header, CJK name", "{#if 価格 / 2 > 1}<b>y</b>{/if}", "(> (/ 価格 2) 1)"},
		{"arrow body, Cyrillic name", "<p>{ items.map(радиус => радиус / 2) }</p>", "(call (. items map) (=> (радиус) (/ радиус 2)))"},
		{"call argument, Greek name", "<p>{ round(π / 2) }</p>", "(call round (/ π 2))"},
		// Parse-only rows: the {:when} list split and the {#for} counter peel
		// run the same scan, so a misread slash would hide their commas.
		{"quoted attribute interpolation", `<p title="a { café / 2 } b">x</p>`, ""},
		{"{:when} value list", "{#case n}{:when 金額 / 2, 0}<b>z</b>{/case}", ""},
		{"{#for} collection before a counter", "{#for x in 一覧.slice(総数 / 2), i}<b>{ x }</b>{/for}", ""},
		// An ASCII run straight after a non-ASCII letter continues the same
		// name, so a keyword-shaped tail is not a keyword.
		{"name ending in a keyword-shaped ASCII tail", "<p>{ 価格new / 2 }</p>", "(/ 価格new 2)"},
		{"slash in a string", "<p>{ 'a/b' + x }</p>", "(+ 'a/b' x)"},
		{"slash in a template literal", "<p>{ `a/${x}/b` }</p>", "(tpl 'a/' x '/b')"},
		{"chained division", "<p>{ a / b / c }</p>", "(/ (/ a b) c)"},
		{"no space after the slash", "<p>{ a /2}</p>", "(/ a 2)"},
		{"no space before the slash", "<p>{ a/ 2 }</p>", "(/ a 2)"},
		{"trailing-dot number", "<p>{ 5. / 2 }</p>", "(/ 5 2)"},
		{"field named of", "<p>{ of / 2 }</p>", "(/ of 2)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := parseContent(t, tc.content)
			if tc.want == "" {
				return
			}
			got := firstExprAST(root.Children)
			if got == nil {
				t.Fatalf("no expression tree in %q", tc.content)
			}
			if p := expr.Print(got); p != tc.want {
				t.Errorf("%q:\n got  %s\n want %s", tc.content, p, tc.want)
			}
		})
	}
}

// A regex-shaped expression still closes at its brace: the scan steps over
// the would-be literal, and the error is the expression grammar's own — a
// regular expression is not part of the language — never "unclosed '{'".
func TestParseRegexShapedExpressionIsAnExpressionError(t *testing.T) {
	src := "<puzzle-view><p>{ /x}/ }</p></puzzle-view>\n<script></script>"
	_, err := Parse([]byte(src), "t.pzl")
	pe, ok := err.(*ParseError)
	if !ok {
		t.Fatalf("want a ParseError, got %v", err)
	}
	if !strings.HasPrefix(pe.Message, "regular expression literals are not available") {
		t.Fatalf("a regex-shaped expression must reach the expression parser, got %d:%d %s", pe.Line, pe.Col, pe.Message)
	}
	if line, col := at(t, src, "/x}/"); pe.Line != line || pe.Col != col {
		t.Errorf("error at %d:%d, want %d:%d (%s)", pe.Line, pe.Col, line, col, pe.Message)
	}
}

// The <script> scan is why the regex skip stays: a regex literal holding a
// quote must stay opaque, or the quote opens a string that swallows the close
// tag. A division after a non-ASCII name in the same body is still division.
func TestScriptScanSkipsARegexHoldingAQuote(t *testing.T) {
	body := "\nconst half = 金額 / 2;\nconst quote = /'/;\nexport default class A {}\n"
	src := "<puzzle-view><p>x</p></puzzle-view>\n<script>" + body + "</script>\n<style>p { color: red }</style>"
	sec, err := SplitSections(src, "A.pzl")
	if err != nil {
		t.Fatalf("SplitSections: %v", err)
	}
	if sec.Scripts != body {
		t.Fatalf("script body = %q, want %q", sec.Scripts, body)
	}
}
