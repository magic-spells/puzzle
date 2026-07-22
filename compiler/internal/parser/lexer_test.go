package parser

import (
	"strings"
	"testing"
)

// lexAll tokenizes input in text mode (file coords starting at 1:1) and returns
// every token before EOF, failing the test on any lexer error.
func lexAll(t *testing.T, input string) []Token {
	t.Helper()
	lx := newLexer(input, Position{Line: 1, Col: 1, Offset: 0}, "test.pzl")
	var toks []Token
	for {
		tk, err := lx.Next()
		if err != nil {
			t.Fatalf("unexpected lex error: %v", err)
		}
		if tk.Type == TokEOF {
			break
		}
		toks = append(toks, tk)
	}
	return toks
}

type tv struct {
	typ TokenType
	val string
}

func assertTokens(t *testing.T, input string, want []tv) {
	t.Helper()
	got := lexAll(t, input)
	if len(got) != len(want) {
		t.Fatalf("token count: got %d, want %d\n  got:  %v\n  want: %v", len(got), len(want), dump(got), want)
	}
	for i := range want {
		if got[i].Type != want[i].typ || got[i].Value != want[i].val {
			t.Errorf("token %d: got {%s %q}, want {%s %q}", i, got[i].Type, got[i].Value, want[i].typ, want[i].val)
		}
	}
}

func dump(toks []Token) []tv {
	out := make([]tv, len(toks))
	for i, tk := range toks {
		out[i] = tv{tk.Type, tk.Value}
	}
	return out
}

// TestLexBlockHeaderTermination is the defining regression table: block headers
// must terminate at the matching '}' (the prototype swallowed everything to the
// next '{'). Includes quote/paren-in-header cases and the prototype's exact
// failure shape.
func TestLexBlockHeaderTermination(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []tv
	}{
		{
			name:  "prototype failure shape: for over items with markup body",
			input: "{#for item in items}<li>{ item.name }</li>{/for}",
			want: []tv{
				{TokBlockOpen, "for item in items"},
				{TokTagOpen, "li"},
				{TokTagEnd, ""},
				{TokInterp, " item.name "},
				{TokTagClose, "li"},
				{TokBlockClose, "for"},
			},
		},
		{
			name:  "if header with quoted comparison",
			input: "{#if currentFilter === 'all'}X{/if}",
			want: []tv{
				{TokBlockOpen, "if currentFilter === 'all'"},
				{TokText, "X"},
				{TokBlockClose, "if"},
			},
		},
		{
			name:  "if header with parens and quoted close-paren",
			input: "{#if a(b, 'c)')}Y{/if}",
			want: []tv{
				{TokBlockOpen, "if a(b, 'c)')"},
				{TokText, "Y"},
				{TokBlockClose, "if"},
			},
		},
		{
			name:  "brace inside a quoted string in the header",
			input: "{#if x === '}'}Z{/if}",
			want: []tv{
				{TokBlockOpen, "if x === '}'"},
				{TokText, "Z"},
				{TokBlockClose, "if"},
			},
		},
		{
			name:  "if with greater-than comparison (prototype swallowed it)",
			input: "{#if todos.length > 0}n{/if}",
			want: []tv{
				{TokBlockOpen, "if todos.length > 0"},
				{TokText, "n"},
				{TokBlockClose, "if"},
			},
		},
		{
			name:  "else branch",
			input: "{#if a}x{:else}y{/if}",
			want: []tv{
				{TokBlockOpen, "if a"},
				{TokText, "x"},
				{TokElse, "else"},
				{TokText, "y"},
				{TokBlockClose, "if"},
			},
		},
		{
			name:  "unless block with else",
			input: "{#unless done}x{:else}y{/unless}",
			want: []tv{
				{TokBlockOpen, "unless done"},
				{TokText, "x"},
				{TokElse, "else"},
				{TokText, "y"},
				{TokBlockClose, "unless"},
			},
		},
		{
			name:  "else-if lexes as its own token (Value = condition only)",
			input: "{#if a}x{:else if b}y{/if}",
			want: []tv{
				{TokBlockOpen, "if a"},
				{TokText, "x"},
				{TokElseIf, "b"},
				{TokText, "y"},
				{TokBlockClose, "if"},
			},
		},
		{
			name:  "bare else-if lexes as TokElseIf with empty condition",
			input: "{#if a}x{:else if}y{/if}",
			want: []tv{
				{TokBlockOpen, "if a"},
				{TokText, "x"},
				{TokElseIf, ""},
				{TokText, "y"},
				{TokBlockClose, "if"},
			},
		},
		{
			name:  "case block with multi-value when, else, and closer",
			input: "{#case s}{:when 'a', 'b'}x{:when 'c'}y{:else}z{/case}",
			want: []tv{
				{TokBlockOpen, "case s"},
				{TokWhen, "'a', 'b'"},
				{TokText, "x"},
				{TokWhen, "'c'"},
				{TokText, "y"},
				{TokElse, "else"},
				{TokText, "z"},
				{TokBlockClose, "case"},
			},
		},
		{
			name:  "when header terminates at matching brace despite braces/commas in values",
			input: "{#case s}{:when f(1, 2), '}'}x{/case}",
			want: []tv{
				{TokBlockOpen, "case s"},
				{TokWhen, "f(1, 2), '}'"},
				{TokText, "x"},
				{TokBlockClose, "case"},
			},
		},
		{
			name:  "bare when lexes with an empty values header",
			input: "{:when}",
			want: []tv{
				{TokWhen, ""},
			},
		},
		{
			name:  "range for header",
			input: "{#for 1...n}z{/for}",
			want: []tv{
				{TokBlockOpen, "for 1...n"},
				{TokText, "z"},
				{TokBlockClose, "for"},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assertTokens(t, tc.input, tc.want)
		})
	}
}

func TestLexInterpolationAndText(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []tv
	}{
		{
			name:  "interpolation with object literal (nested braces)",
			input: "{ {a: 1} }",
			want:  []tv{{TokInterp, " {a: 1} "}},
		},
		{
			name:  "interpolation with formatter and quoted comma arg",
			input: "{ names | join(', ') }",
			want:  []tv{{TokInterp, " names | join(', ') "}},
		},
		{
			name:  "text then interpolation then text",
			input: "hi { name } bye",
			want: []tv{
				{TokText, "hi "},
				{TokInterp, " name "},
				{TokText, " bye"},
			},
		},
		{
			name:  "escaped braces become literal",
			input: `a \{ b \} c`,
			want:  []tv{{TokText, "a { b } c"}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assertTokens(t, tc.input, tc.want)
		})
	}
}

func TestLexTagsAndAttributes(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []tv
	}{
		{
			name:  "self-closing input with mixed attribute kinds",
			input: `<input type="text" value={ newTodoText } @input={ update(event) } autofocus />`,
			want: []tv{
				{TokTagOpen, "input"},
				{TokAttrName, "type"}, {TokEquals, ""}, {TokAttrQuoted, "text"},
				{TokAttrName, "value"}, {TokEquals, ""}, {TokAttrBrace, " newTodoText "},
				{TokAttrName, "@input"}, {TokEquals, ""}, {TokAttrBrace, " update(event) "},
				{TokAttrName, "autofocus"},
				{TokSelfClose, ""},
			},
		},
		{
			name:  "quoted value containing an inline-if with quotes",
			input: `<b class="base {#if x === 'all'}on{/if}"></b>`,
			want: []tv{
				{TokTagOpen, "b"},
				{TokAttrName, "class"}, {TokEquals, ""}, {TokAttrQuoted, "base {#if x === 'all'}on{/if}"},
				{TokTagEnd, ""},
				{TokTagClose, "b"},
			},
		},
		{
			name:  "svg path with hyphenated attribute names",
			input: `<path fill-rule="evenodd" d="M16 5z" clip-rule="evenodd"></path>`,
			want: []tv{
				{TokTagOpen, "path"},
				{TokAttrName, "fill-rule"}, {TokEquals, ""}, {TokAttrQuoted, "evenodd"},
				{TokAttrName, "d"}, {TokEquals, ""}, {TokAttrQuoted, "M16 5z"},
				{TokAttrName, "clip-rule"}, {TokEquals, ""}, {TokAttrQuoted, "evenodd"},
				{TokTagEnd, ""},
				{TokTagClose, "path"},
			},
		},
		{
			name:  "html comment is a single dropped token",
			input: `a<!-- x -->b`,
			want: []tv{
				{TokText, "a"},
				{TokComment, "<!-- x -->"},
				{TokText, "b"},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assertTokens(t, tc.input, tc.want)
		})
	}
}

// TestLexPositions checks that tokens carry file-accurate line/col, including
// after a newline.
func TestLexPositions(t *testing.T) {
	toks := lexAll(t, "a\n<b>{ x }")
	// tokens: Text "a\n", TagOpen b (line2 col1), TagEnd (line2 col3), Interp (line2 col4)
	tagOpen := toks[1]
	if tagOpen.Type != TokTagOpen || tagOpen.Line != 2 || tagOpen.Col != 1 {
		t.Fatalf("TagOpen pos: got %s %d:%d, want TagOpen 2:1", tagOpen.Type, tagOpen.Line, tagOpen.Col)
	}
	interp := toks[3]
	if interp.Type != TokInterp || interp.Line != 2 || interp.Col != 4 {
		t.Fatalf("Interp pos: got %s %d:%d, want Interp 2:4", interp.Type, interp.Line, interp.Col)
	}
}

func TestLexUnclosedInterpolation(t *testing.T) {
	lx := newLexer("{ x ", Position{Line: 1, Col: 1}, "test.pzl")
	_, err := lx.Next()
	if err == nil {
		t.Fatal("expected error for unclosed interpolation")
	}
}

// lexErr tokenizes input to completion and returns the first lexer error string
// (empty if none), so branch-recognition failures can be asserted by message.
func lexErr(t *testing.T, input string) string {
	t.Helper()
	lx := newLexer(input, Position{Line: 1, Col: 1, Offset: 0}, "test.pzl")
	for {
		tk, err := lx.Next()
		if err != nil {
			return err.Error()
		}
		if tk.Type == TokEOF {
			return ""
		}
	}
}

func TestLexElseIfBranchRecognition(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantSub string // substring the lex error must contain ("" = must succeed)
	}{
		{"elsif did-you-mean", "{#if a}x{:elsif b}y{/if}", "did you mean {:else if}"},
		{"elseif did-you-mean", "{#if a}x{:elseif b}y{/if}", "did you mean {:else if}"},
		{"else foo is unknown branch, not else-if", "{#if a}x{:else foo}y{/if}", "unknown branch {:else foo}"},
		{"unknown branch names the real set", "{#if a}x{:elsewhere}y{/if}", "expected {:else}, {:else if}, or {:when}"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := lexErr(t, tc.input)
			if tc.wantSub == "" {
				if got != "" {
					t.Fatalf("unexpected lex error: %s", got)
				}
				return
			}
			if got == "" {
				t.Fatalf("expected lex error containing %q, got none", tc.wantSub)
			}
			if !strings.Contains(got, tc.wantSub) {
				t.Fatalf("lex error %q does not contain %q", got, tc.wantSub)
			}
		})
	}
}

// TestLexElseFooNotElseIf guards that "{:else foo}" no longer lexes as TokElseIf
// — it must surface the unknown-branch error instead.
func TestLexElseFooNotElseIf(t *testing.T) {
	if got := lexErr(t, "{#if a}x{:else foo}y{/if}"); !strings.Contains(got, "unknown branch") {
		t.Fatalf("{:else foo} should be an unknown-branch error, got %q", got)
	}
}

// TestLexTemplateComments covers D70 template comments: both the inline `{## … }`
// and block `{#comment} … {/comment}` spellings emit NO tokens, and their bodies
// are consumed RAW (interpolations, block tags, HTML comments, apostrophes, and
// otherwise-malformed template code inside are all ignored).
func TestLexTemplateComments(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []tv
	}{
		{
			name:  "inline comment is dropped entirely",
			input: "a{## just a note }b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "inline comment with balanced inner braces is one comment",
			input: "a{## { user.name } }b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "inline comment with an apostrophe (scanBraceGroup would choke)",
			input: "a{## don't touch this }b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "inline comment with quotes inside",
			input: `a{## "quoted" and 'apostrophe' }b`,
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "inline comment with no space after ## ({###x} is still a comment)",
			input: "a{###x}b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "escaped close-brace lets a lone } live inside an inline comment",
			input: `a{## a lone \} brace }b`,
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "block comment is dropped entirely",
			input: "a{#comment}hidden{/comment}b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "block comment body is raw: interpolations and block tags ignored",
			input: "a{#comment}{ x }{#if y}{/if}<!-- c -->{/comment}b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "block comment body with apostrophes and quotes is inert",
			input: `a{#comment} don't "break" on 'quotes' {/comment}b`,
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "block comment opener may carry a note after the keyword",
			input: "a{#comment TODO: revisit}x{/comment}b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "closer tolerates whitespace",
			input: "a{#comment}x{/ comment }b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "nested comment blocks are balanced",
			input: "a{#comment}outer{#comment}inner{/comment}still hidden{/comment}b",
			want:  []tv{{TokText, "a"}, {TokText, "b"}},
		},
		{
			name:  "comment between real tokens keeps the stream intact",
			input: "{ a }{## note }{ b }",
			want:  []tv{{TokInterp, " a "}, {TokInterp, " b "}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assertTokens(t, tc.input, tc.want)
		})
	}
}

// TestLexTemplateCommentErrors covers the unterminated-comment lexer errors and
// their positions (pointing at the opening '{').
func TestLexTemplateCommentErrors(t *testing.T) {
	t.Run("unclosed inline comment", func(t *testing.T) {
		got := lexErr(t, "ab{## never closed")
		if !strings.Contains(got, "unclosed {## comment") {
			t.Fatalf("expected unclosed inline comment error, got %q", got)
		}
	})
	t.Run("unterminated block comment names the expected closer", func(t *testing.T) {
		got := lexErr(t, "ab{#comment}dangling")
		if !strings.Contains(got, "unterminated {#comment} — expected {/comment}") {
			t.Fatalf("expected unterminated block comment error, got %q", got)
		}
	})
	t.Run("unterminated block comment error position points at the opener", func(t *testing.T) {
		// The opening '{' sits on line 2, col 1.
		lx := newLexer("x\n{#comment}y", Position{Line: 1, Col: 1, Offset: 0}, "test.pzl")
		var perr *ParseError
		for {
			_, err := lx.Next()
			if err != nil {
				perr = err.(*ParseError)
				break
			}
		}
		if perr == nil {
			t.Fatal("expected an error for the unterminated block comment")
		}
		if perr.Line != 2 || perr.Col != 1 {
			t.Fatalf("error position: got %d:%d, want 2:1", perr.Line, perr.Col)
		}
	})
}

// TestLexPositionsAfterComment guards that a token following a MULTILINE comment
// carries file-accurate line/col — the raw comment scans must count newlines.
func TestLexPositionsAfterComment(t *testing.T) {
	t.Run("after a multiline inline comment", func(t *testing.T) {
		toks := lexAll(t, "{## line one\nline two\n}{ x }")
		if len(toks) != 1 {
			t.Fatalf("expected 1 token after comment, got %d: %v", len(toks), dump(toks))
		}
		// The comment spans 3 lines; the '}' is on line 3, so { x } opens at 3:2.
		if toks[0].Type != TokInterp || toks[0].Line != 3 || toks[0].Col != 2 {
			t.Fatalf("interp pos: got %s %d:%d, want Interp 3:2", toks[0].Type, toks[0].Line, toks[0].Col)
		}
	})
	t.Run("after a multiline block comment", func(t *testing.T) {
		toks := lexAll(t, "{#comment}\nhidden\nlines\n{/comment}<b>")
		// {/comment} ends on line 4; <b> follows on line 4.
		if len(toks) != 2 {
			t.Fatalf("expected 2 tokens after comment, got %d: %v", len(toks), dump(toks))
		}
		if toks[0].Type != TokTagOpen || toks[0].Line != 4 {
			t.Fatalf("tag pos: got %s %d:%d, want TagOpen on line 4", toks[0].Type, toks[0].Line, toks[0].Col)
		}
	})
}
