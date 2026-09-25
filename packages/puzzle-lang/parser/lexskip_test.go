package parser

import (
	"strings"
	"testing"
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
		name        string
		s           string
		sep         byte
		skipDoubled bool
		want        []string
	}{
		{"plain pipe", "a | b", '|', true, []string{"a ", " b"}},
		{"logical or not split", "a || b", '|', true, []string{"a || b"}},
		// A '|' inside a regex is part of the regex body, not a split point.
		{"pipe in regex", "/a|b/.test(x) | up", '|', true, []string{"/a|b/.test(x) ", " up"}},
		// Division on the left still splits at the trailing pipe.
		{"division then pipe", "a / b | up", '|', true, []string{"a / b ", " up"}},
		// A '|' inside a string is not a split point.
		{"pipe in string", "'a|b' | up", '|', true, []string{"'a|b' ", " up"}},
		// A '|' inside a comment is not a split point.
		{"pipe in comment", "a /* | */ | up", '|', true, []string{"a /* | */ ", " up"}},
		// Comma splitting for formatter args, respecting a regex comma-free body.
		{"comma args with regex", "/a,b/, x", ',', false, []string{"/a,b/", " x"}},
		{"nested commas not split", "f(a, b), c", ',', false, []string{"f(a, b)", " c"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := splitTopLevel(tc.s, tc.sep, tc.skipDoubled)
			if strings.Join(got, "\x00") != strings.Join(tc.want, "\x00") {
				t.Errorf("splitTopLevel(%q, %q, %v) = %#v, want %#v", tc.s, tc.sep, tc.skipDoubled, got, tc.want)
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

func TestParsePostfixUpdateBeforeDivisionClosesInterpolation(t *testing.T) {
	src := `<puzzle-view>
  <div>{ index++ / total }</div>
</puzzle-view>
<script>
export default class A {}
</script>`
	if _, err := Parse([]byte(src), "A.pzl"); err != nil {
		t.Fatalf("postfix update before division must not hide the interpolation close: %v", err)
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
		{'5', false, true}, // digit ends an expression
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
