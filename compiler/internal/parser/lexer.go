package parser

import (
	"fmt"
	"strings"
)

// lexer.go is the HTML-aware template lexer (constellation/doc/DOC-COMPILER-DESIGN.md §c). It
// tokenizes the <puzzle-view> CONTENT only — <scripts>/<styles> bodies are
// never scanned for template syntax (that split happens in sections.go).
//
// The one salvage from the prototype is the idea of line/col bookkeeping; the
// implementation here is index-based (jumpTo replays consumed bytes to keep
// line/col accurate) so it can reuse scanBraceGroup, the single balanced scan.
// The prototype's fatal bug — block headers swallowing everything to the next
// '{' — is gone: block headers terminate at the matching '}' via scanBraceGroup.

// TokenType enumerates the lexer's output tokens.
type TokenType int

const (
	TokEOF        TokenType = iota
	TokText                 // literal text (brace escapes resolved)
	TokInterp               // { expr }            Value = raw inner
	TokBlockOpen            // {#if ...}/{#for ...} Value = header after '#'
	TokElse                 // {:else}
	TokElseIf               // {:else if cond}     Value = condition (after "else if")
	TokWhen                 // {:when v1, v2, ...}  Value = raw values header after "when"
	TokBlockClose           // {/if}/{/for}        Value = keyword
	TokTagOpen              // <name               Value = tag name; enters tag mode
	TokTagClose             // </name>             Value = tag name
	TokComment              // <!-- ... -->        dropped by the parser
	TokAttrName             // attribute name      Value = name (may start with '@')
	TokEquals               // =
	TokAttrQuoted           // "..."/'...'         Value = raw inner, Quote = delimiter
	TokAttrBrace            // { expr }            Value = inner expr (unquoted value)
	TokAttrBare             // bareword value      Value = word
	TokTagEnd               // >
	TokSelfClose            // />
)

// tokenNames feeds Token.String / TokenType.String for readable test output.
var tokenNames = map[TokenType]string{
	TokEOF: "EOF", TokText: "Text", TokInterp: "Interp", TokBlockOpen: "BlockOpen",
	TokElse: "Else", TokElseIf: "ElseIf", TokWhen: "When", TokBlockClose: "BlockClose", TokTagOpen: "TagOpen",
	TokTagClose: "TagClose", TokComment: "Comment", TokAttrName: "AttrName",
	TokEquals: "Equals", TokAttrQuoted: "AttrQuoted", TokAttrBrace: "AttrBrace",
	TokAttrBare: "AttrBare", TokTagEnd: "TagEnd", TokSelfClose: "SelfClose",
}

func (t TokenType) String() string {
	if s, ok := tokenNames[t]; ok {
		return s
	}
	return fmt.Sprintf("TokenType(%d)", int(t))
}

// Token is one lexical unit. Line/Col are 1-based file coordinates; Offset is
// the byte offset into the original file.
type Token struct {
	Type   TokenType
	Value  string
	Quote  byte // delimiter for TokAttrQuoted, else 0
	Line   int
	Col    int
	Offset int
}

type lexMode int

const (
	modeText lexMode = iota // scanning element content
	modeTag                 // scanning inside an open tag (attributes)
)

type lexer struct {
	input       string
	file        string
	pos         int
	line        int
	col         int
	baseOffset  int
	mode        lexMode
	expectValue bool // true immediately after '=', so a bareword lexes as a value
}

// newLexer creates a lexer over content whose first byte sits at base in the
// original file, so every emitted token is in file coordinates.
func newLexer(input string, base Position, file string) *lexer {
	return &lexer{
		input:      input,
		file:       file,
		line:       base.Line,
		col:        base.Col,
		baseOffset: base.Offset,
		mode:       modeText,
	}
}

// newAttrLexer creates a lexer that starts in tag mode, used to tokenize a
// standalone attribute string (the <puzzle-view> root attrs).
func newAttrLexer(input string, base Position, file string) *lexer {
	l := newLexer(input, base, file)
	l.mode = modeTag
	return l
}

func (l *lexer) at(i int) byte {
	if i >= 0 && i < len(l.input) {
		return l.input[i]
	}
	return 0
}

func (l *lexer) cur() byte { return l.at(l.pos) }

// step consumes one byte, maintaining line/col.
func (l *lexer) step() {
	if l.pos >= len(l.input) {
		return
	}
	if l.input[l.pos] == '\n' {
		l.line++
		l.col = 1
	} else {
		l.col++
	}
	l.pos++
}

// jumpTo advances to target (>= pos) replaying bytes so line/col stay accurate.
func (l *lexer) jumpTo(target int) {
	for l.pos < target {
		l.step()
	}
}

func (l *lexer) errf(line, col int, format string, args ...any) error {
	return &ParseError{File: l.file, Line: line, Col: col, Message: fmt.Sprintf(format, args...)}
}

// Next returns the next token.
func (l *lexer) Next() (Token, error) {
	if l.mode == modeTag {
		return l.nextTag()
	}
	return l.nextText()
}

func (l *lexer) nextText() (Token, error) {
	if l.pos >= len(l.input) {
		return Token{Type: TokEOF, Line: l.line, Col: l.col, Offset: l.baseOffset + l.pos}, nil
	}
	switch l.cur() {
	case '<':
		return l.lexAngle()
	case '{':
		return l.lexBrace()
	default:
		return l.lexText()
	}
}

// lexText scans literal text until the next '<' or unescaped '{'. \{ and \}
// become literal braces (constellation/doc/DOC-COMPILER-DESIGN.md §c).
func (l *lexer) lexText() (Token, error) {
	line, col, off := l.line, l.col, l.baseOffset+l.pos
	var sb strings.Builder
	for l.pos < len(l.input) {
		c := l.cur()
		if c == '<' || c == '{' {
			break
		}
		if c == '\\' && (l.at(l.pos+1) == '{' || l.at(l.pos+1) == '}') {
			l.step() // drop backslash
			sb.WriteByte(l.cur())
			l.step()
			continue
		}
		sb.WriteByte(c)
		l.step()
	}
	return Token{Type: TokText, Value: sb.String(), Line: line, Col: col, Offset: off}, nil
}

// lexAngle handles '<': comments, closing tags, opening tags, or a lone '<'
// treated as text.
func (l *lexer) lexAngle() (Token, error) {
	line, col, off := l.line, l.col, l.baseOffset+l.pos
	rest := l.input[l.pos:]

	if strings.HasPrefix(rest, "<!--") {
		idx := strings.Index(l.input[l.pos+4:], "-->")
		if idx < 0 {
			return Token{}, l.errf(line, col, "unterminated HTML comment")
		}
		target := l.pos + 4 + idx + 3
		val := l.input[l.pos:target]
		l.jumpTo(target)
		return Token{Type: TokComment, Value: val, Line: line, Col: col, Offset: off}, nil
	}

	if l.at(l.pos+1) == '/' { // closing tag </name>
		j := l.pos + 2
		for j < len(l.input) && isNameChar(l.input[j]) {
			j++
		}
		name := l.input[l.pos+2 : j]
		for j < len(l.input) && isSpaceByte(l.input[j]) {
			j++
		}
		if name == "" || j >= len(l.input) || l.input[j] != '>' {
			return Token{}, l.errf(line, col, "malformed closing tag")
		}
		l.jumpTo(j + 1)
		return Token{Type: TokTagClose, Value: name, Line: line, Col: col, Offset: off}, nil
	}

	if isNameStart(l.at(l.pos + 1)) { // opening tag <name
		j := l.pos + 1
		for j < len(l.input) && isNameChar(l.input[j]) {
			j++
		}
		name := l.input[l.pos+1 : j]
		l.jumpTo(j)
		l.mode = modeTag
		l.expectValue = false
		return Token{Type: TokTagOpen, Value: name, Line: line, Col: col, Offset: off}, nil
	}

	// lone '<' — emit as a single-char text token
	l.step()
	return Token{Type: TokText, Value: "<", Line: line, Col: col, Offset: off}, nil
}

// lexBrace handles a '{' in text mode: interpolation or block directive. The
// group is delimited by the shared scanBraceGroup, so headers terminate at the
// matching '}'.
func (l *lexer) lexBrace() (Token, error) {
	line, col, off := l.line, l.col, l.baseOffset+l.pos

	// Template comments (D70) are consumed here and emit NO token: after skipping
	// the comment we return the NEXT token, so the comment is invisible to the
	// parser (like whitespace between tags). Both sniffs read RAW source bytes at
	// the open position rather than scanBraceGroup's result — that scan is
	// string/regex-aware and would choke on comment prose such as `{## don't }`.
	//
	// {## … } inline comment: a dumb brace-nesting scan (honors \{ \}).
	if strings.HasPrefix(l.input[l.pos:], "{##") {
		end, err := scanInlineComment(l.input, l.pos)
		if err != nil {
			return Token{}, l.errf(line, col, "unclosed {## comment")
		}
		l.jumpTo(end) // replays bytes so line/col stay accurate past a multiline comment
		return l.nextText()
	}
	// {#comment} … {/comment} block comment: body scanned RAW (never lexed).
	if isBlockCommentOpen(l.input, l.pos) {
		end, err := scanBlockComment(l.input, l.pos)
		if err != nil {
			return Token{}, l.errf(line, col, "unterminated {#comment} — expected {/comment}")
		}
		l.jumpTo(end)
		return l.nextText()
	}

	inner, end, err := scanBraceGroup(l.input, l.pos)
	if err != nil {
		return Token{}, l.errf(line, col, "unclosed '{' (interpolation or block directive)")
	}
	var tok Token
	switch {
	case len(inner) > 0 && inner[0] == '#':
		tok = Token{Type: TokBlockOpen, Value: strings.TrimSpace(inner[1:]), Line: line, Col: col, Offset: off}
	case len(inner) > 0 && inner[0] == ':':
		branch := strings.TrimSpace(inner[1:])
		switch {
		case branch == "else":
			tok = Token{Type: TokElse, Value: "else", Line: line, Col: col, Offset: off}
		case isElseIfBranch(branch):
			// {:else if cond} is recognized as its own token; the parser accepts
			// it inside {#if} (desugaring to nested If nodes) and rejects it inside
			// {#unless}/{#case}. Value carries the condition only (after "else if");
			// a bare "{:else if}" yields "", a positioned parser error.
			tok = Token{Type: TokElseIf, Value: elseIfCondition(branch), Line: line, Col: col, Offset: off}
		case isWhenBranch(branch):
			// {:when v1, v2, ...} clause of a {#case} block; Value carries the raw
			// values header (after "when"), which the parser splits at top-level
			// commas. An empty header (bare "{:when}") is a positioned parser error.
			tok = Token{Type: TokWhen, Value: strings.TrimSpace(branch[4:]), Line: line, Col: col, Offset: off}
		default:
			if fw := firstWord(branch); fw == "elsif" || fw == "elseif" {
				return Token{}, l.errf(line, col, "unknown branch {:%s} — did you mean {:else if}?", branch)
			}
			return Token{}, l.errf(line, col, "unknown branch {:%s} (expected {:else}, {:else if}, or {:when})", branch)
		}
	case len(inner) > 0 && inner[0] == '/' && isKnownBlockCloserAt(l.input, l.pos):
		tok = Token{Type: TokBlockClose, Value: strings.TrimSpace(inner[1:]), Line: line, Col: col, Offset: off}
	default:
		tok = Token{Type: TokInterp, Value: inner, Line: line, Col: col, Offset: off}
	}
	l.jumpTo(end)
	return tok, nil
}

// nextTag tokenizes inside an open tag: attribute names, '=', values, and the
// tag terminators.
func (l *lexer) nextTag() (Token, error) {
	for l.pos < len(l.input) && isSpaceByte(l.cur()) {
		l.step()
	}
	if l.pos >= len(l.input) {
		return Token{Type: TokEOF, Line: l.line, Col: l.col, Offset: l.baseOffset + l.pos}, nil
	}
	line, col, off := l.line, l.col, l.baseOffset+l.pos
	c := l.cur()

	switch {
	case c == '>':
		l.step()
		l.mode = modeText
		l.expectValue = false
		return Token{Type: TokTagEnd, Line: line, Col: col, Offset: off}, nil
	case c == '/' && l.at(l.pos+1) == '>':
		l.step()
		l.step()
		l.mode = modeText
		l.expectValue = false
		return Token{Type: TokSelfClose, Line: line, Col: col, Offset: off}, nil
	case c == '=':
		l.step()
		l.expectValue = true
		return Token{Type: TokEquals, Line: line, Col: col, Offset: off}, nil
	case c == '"' || c == '\'':
		return l.lexQuotedValue()
	case c == '{':
		inner, end, err := scanBraceGroup(l.input, l.pos)
		if err != nil {
			return Token{}, l.errf(line, col, "unclosed '{' in attribute value")
		}
		l.jumpTo(end)
		l.expectValue = false
		return Token{Type: TokAttrBrace, Value: inner, Line: line, Col: col, Offset: off}, nil
	default:
		if l.expectValue {
			j := l.pos
			for j < len(l.input) {
				b := l.input[j]
				if isSpaceByte(b) || b == '>' || (b == '/' && l.at(j+1) == '>') {
					break
				}
				j++
			}
			val := l.input[l.pos:j]
			l.jumpTo(j)
			l.expectValue = false
			return Token{Type: TokAttrBare, Value: val, Line: line, Col: col, Offset: off}, nil
		}
		if c == '@' || isNameStart(c) {
			j := l.pos
			if c == '@' {
				j++
			}
			for j < len(l.input) && isNameChar(l.input[j]) {
				j++
			}
			name := l.input[l.pos:j]
			l.jumpTo(j)
			return Token{Type: TokAttrName, Value: name, Line: line, Col: col, Offset: off}, nil
		}
		return Token{}, l.errf(line, col, "unexpected character %q in tag", string(rune(c)))
	}
}

// lexQuotedValue scans a quoted attribute value. The enclosing quote ends the
// value, but a '{' switches to the shared brace scan so quotes inside an
// expression (e.g. `class="{#if x === 'all'}..."`) do not end the value early.
func (l *lexer) lexQuotedValue() (Token, error) {
	q := l.cur()
	qLine, qCol := l.line, l.col
	i := l.pos + 1
	contentStart := i
	for i < len(l.input) {
		ch := l.input[i]
		if ch == '{' {
			_, end, err := scanBraceGroup(l.input, i)
			if err != nil {
				return Token{}, l.errf(qLine, qCol, "unclosed '{' in attribute value")
			}
			i = end
			continue
		}
		if ch == q {
			break
		}
		i++
	}
	if i >= len(l.input) {
		return Token{}, l.errf(qLine, qCol, "unclosed attribute value")
	}
	raw := l.input[contentStart:i]
	l.step() // over opening quote -> now at contentStart
	cLine, cCol, cOff := l.line, l.col, l.baseOffset+l.pos
	l.jumpTo(i) // to closing quote
	l.step()    // past closing quote
	l.expectValue = false
	return Token{Type: TokAttrQuoted, Value: raw, Quote: q, Line: cLine, Col: cCol, Offset: cOff}, nil
}

func isSpaceByte(b byte) bool {
	return b == ' ' || b == '\t' || b == '\r' || b == '\n'
}

// isElseIfBranch reports whether a {:...} branch is an else-if clause, i.e. the
// word "else" followed by whitespace and the word "if" (then end-of-branch or
// whitespace before the condition). Exactly "else" is handled separately; other
// "else …" branches (e.g. "else foo") are unknown and fall through to the
// unknown-branch error.
func isElseIfBranch(branch string) bool {
	if len(branch) <= 4 || branch[:4] != "else" || !isSpaceByte(branch[4]) {
		return false
	}
	rest := strings.TrimLeft(branch[4:], " \t\r\n")
	if len(rest) < 2 || rest[:2] != "if" {
		return false
	}
	return len(rest) == 2 || isSpaceByte(rest[2])
}

// elseIfCondition returns the condition text of an else-if branch (the trimmed
// text after "else if"), mirroring how TokWhen strips its "when" keyword. A bare
// "else if" yields "", which the parser reports as a positioned error.
func elseIfCondition(branch string) string {
	rest := strings.TrimLeft(branch[4:], " \t\r\n") // after "else"
	return strings.TrimSpace(rest[2:])              // after "if"
}

// isWhenBranch reports whether a {:...} branch is a {#case} when-clause: the bare
// word "when" (an empty clause, caught later as a parser error) or "when"
// followed by whitespace and its comma-separated values.
func isWhenBranch(branch string) bool {
	if branch == "when" {
		return true
	}
	return len(branch) > 4 && branch[:4] == "when" && isSpaceByte(branch[4])
}

func isNameStart(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || b == '_'
}

func isNameChar(b byte) bool {
	return isNameStart(b) || (b >= '0' && b <= '9') || b == '-' || b == ':' || b == '.'
}
