package expr

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// lexer.go turns an expression's source into tokens in one linear pass. It
// never lexes a regular expression: the grammar has none, so a `/` is always
// a punctuator and the parser reports a regex literal where a value was
// expected. The first lexical error ends the stream with a tError token; the
// parser reports it only if no syntax error comes before it.

type tokKind uint8

const (
	tEOF tokKind = iota
	tError
	tIdent
	tNumber
	tString
	tTemplate       // `…` with no substitution
	tTemplateHead   // `…${
	tTemplateMiddle // }…${
	tTemplateTail   // }…`
	tPunct
)

type token struct {
	kind tokKind
	// nl reports a line terminator between the previous token and this one.
	nl bool
	// text is an identifier's name, a punctuator, or the source of a literal.
	text string
	// str is the cooked value of a string or template segment.
	str string
	num float64
	pos Pos
	ext *tokExt
}

// tokExt holds the fields only a few tokens need, off the hot path of the
// token slice.
type tokExt struct {
	// err is a tError token's error.
	err *Error
	// sub is where a template head's or middle's `${` sits.
	sub Pos
}

// braceFrame is one open `{` or `${`. For a `${`, tpl is the position of the
// template literal's opening backtick.
type braceFrame struct {
	template bool
	tpl      Pos
}

type lexer struct {
	src   string
	i     int
	line  int
	col   int
	base  int
	nl    bool
	stack []braceFrame
	toks  []token
}

// lex tokenizes src, whose first byte sits at base in the file, appending to
// buf[:0]. The result always ends with a tEOF or a tError token.
func lex(src string, base Pos, buf []token) []token {
	lx := &lexer{src: src, line: base.Line, col: base.Col, base: base.Offset, toks: buf[:0]}
	for {
		lx.skipSpace()
		if lx.i >= len(lx.src) {
			lx.emit(token{kind: tEOF, pos: lx.pos()})
			return lx.toks
		}
		if err := lx.next(); err != nil {
			lx.emit(token{kind: tError, pos: err.Pos, ext: &tokExt{err: err}})
			return lx.toks
		}
	}
}

func (lx *lexer) pos() Pos {
	return Pos{Line: lx.line, Col: lx.col, Offset: lx.base + lx.i}
}

// adv consumes n bytes, keeping line and column current.
func (lx *lexer) adv(n int) {
	for end := lx.i + n; lx.i < end && lx.i < len(lx.src); lx.i++ {
		if lx.src[lx.i] == '\n' {
			lx.line++
			lx.col = 1
		} else {
			lx.col++
		}
	}
}

func (lx *lexer) emit(t token) {
	t.nl = lx.nl
	lx.nl = false
	lx.toks = append(lx.toks, t)
}

func (lx *lexer) errAt(p Pos, msg string) *Error {
	return &Error{Pos: p, Message: msg}
}

func (lx *lexer) peekByte(k int) byte {
	if lx.i+k < len(lx.src) {
		return lx.src[lx.i+k]
	}
	return 0
}

// skipSpace skips JavaScript white space and line terminators: tab, vertical
// tab, form feed, space, NBSP, the BOM, any Zs space separator, LF, CR, and
// U+2028/U+2029.
func (lx *lexer) skipSpace() {
	for lx.i < len(lx.src) {
		c := lx.src[lx.i]
		switch c {
		case ' ', '\t', '\v', '\f':
			lx.adv(1)
		case '\n', '\r':
			lx.nl = true
			lx.adv(1)
		default:
			if c < utf8.RuneSelf {
				return
			}
			r, size := utf8.DecodeRuneInString(lx.src[lx.i:])
			switch {
			case r == 0x2028 || r == 0x2029:
				lx.nl = true
				lx.adv(size)
			case r == 0xA0 || r == 0xFEFF || unicode.Is(unicode.Zs, r):
				lx.adv(size)
			default:
				return
			}
		}
	}
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func isHex(c byte) bool {
	return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// next lexes one token at lx.i (not white space, not end of input).
func (lx *lexer) next() *Error {
	c := lx.src[lx.i]
	switch {
	case c == '\'' || c == '"':
		return lx.lexString(c)
	case c == '`':
		start := lx.pos()
		lx.adv(1)
		return lx.lexTemplate(start, start, false)
	case c == '}' && len(lx.stack) > 0 && lx.stack[len(lx.stack)-1].template:
		frame := lx.stack[len(lx.stack)-1]
		lx.stack = lx.stack[:len(lx.stack)-1]
		start := lx.pos()
		lx.adv(1)
		return lx.lexTemplate(start, frame.tpl, true)
	case isDigit(c) || (c == '.' && isDigit(lx.peekByte(1))):
		return lx.lexNumber()
	case c == '/' && (lx.peekByte(1) == '/' || lx.peekByte(1) == '*'):
		return lx.errAt(lx.pos(), msgComment)
	case c == '\\' && lx.peekByte(1) == 'u':
		return lx.errAt(lx.pos(), msgNameEscape)
	case c < utf8.RuneSelf:
		if isIDStart(rune(c)) {
			return lx.lexIdent()
		}
		return lx.lexPunct()
	}
	r, _ := utf8.DecodeRuneInString(lx.src[lx.i:])
	if r != utf8.RuneError && isIDStart(r) {
		return lx.lexIdent()
	}
	return lx.errAt(lx.pos(), unexpectedChar(lx.src[lx.i:]))
}

// unexpectedChar names the character at the start of s.
func unexpectedChar(s string) string {
	r, _ := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return "unexpected byte that is not valid UTF-8"
	}
	if unicode.IsPrint(r) {
		return "unexpected character `" + string(r) + "`"
	}
	return fmt.Sprintf("unexpected character U+%04X", r)
}

func (lx *lexer) lexIdent() *Error {
	start := lx.pos()
	from := lx.i
	for lx.i < len(lx.src) {
		c := lx.src[lx.i]
		if c < utf8.RuneSelf {
			if c == '\\' && lx.peekByte(1) == 'u' {
				return lx.errAt(lx.pos(), msgNameEscape)
			}
			if !isIDContinue(rune(c)) {
				break
			}
			lx.adv(1)
			continue
		}
		r, size := utf8.DecodeRuneInString(lx.src[lx.i:])
		if r == utf8.RuneError || !isIDContinue(r) {
			break
		}
		lx.adv(size)
	}
	lx.emit(token{kind: tIdent, text: lx.src[from:lx.i], pos: start})
	return nil
}

// lexNumber lexes a decimal literal: `1`, `1.5`, `.5`, `5.`, `1e3`, `1E-3`.
// Hex, octal, binary, BigInt, numeric separators, and legacy leading zeros
// are errors, and so is a name or digit directly after the literal, as in
// JavaScript (`1.toFixed()`, `3in`).
func (lx *lexer) lexNumber() *Error {
	start := lx.pos()
	from := lx.i
	if lx.src[lx.i] == '0' {
		switch lx.peekByte(1) {
		case 'x', 'X':
			return lx.errAt(start, msgHex)
		case 'o', 'O':
			return lx.errAt(start, msgOctal)
		case 'b', 'B':
			return lx.errAt(start, msgBinary)
		}
		if isDigit(lx.peekByte(1)) {
			return lx.errAt(start, msgLeadingZero)
		}
	}
	digits := func() *Error {
		for lx.i < len(lx.src) && isDigit(lx.src[lx.i]) {
			lx.adv(1)
		}
		if lx.i < len(lx.src) && lx.src[lx.i] == '_' {
			return lx.errAt(lx.pos(), msgSeparator)
		}
		return nil
	}
	if err := digits(); err != nil {
		return err
	}
	if lx.i < len(lx.src) && lx.src[lx.i] == '.' {
		lx.adv(1)
		if err := digits(); err != nil {
			return err
		}
	}
	if c := lx.peekByte(0); c == 'e' || c == 'E' {
		lx.adv(1)
		if c := lx.peekByte(0); c == '+' || c == '-' {
			lx.adv(1)
		}
		if !isDigit(lx.peekByte(0)) {
			return lx.errAt(start, msgExponentDigits)
		}
		if err := digits(); err != nil {
			return err
		}
	}
	if lx.peekByte(0) == 'n' {
		return lx.errAt(start, msgBigInt)
	}
	if lx.i < len(lx.src) {
		r, _ := utf8.DecodeRuneInString(lx.src[lx.i:])
		if r == '\\' || (r != utf8.RuneError && isIDStart(r)) || isDigit(lx.src[lx.i]) {
			return lx.errAt(lx.pos(), msgNumberThenName)
		}
	}
	raw := lx.src[from:lx.i]
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil && !strings.Contains(err.Error(), "value out of range") {
		return lx.errAt(start, "invalid number `"+raw+"`")
	}
	lx.emit(token{kind: tNumber, text: raw, num: v, pos: start})
	return nil
}

// lexString lexes a single- or double-quoted string with JavaScript's
// strict-mode escapes. A raw LF or CR inside it is an error; U+2028 and U+2029
// are allowed, as in JavaScript.
func (lx *lexer) lexString(q byte) *Error {
	start := lx.pos()
	from := lx.i
	lx.adv(1)
	var sb strings.Builder
	for {
		if lx.i >= len(lx.src) {
			return lx.errAt(start, msgUnterminatedStr)
		}
		c := lx.src[lx.i]
		switch {
		case c == q:
			lx.adv(1)
			lx.emit(token{kind: tString, text: lx.src[from:lx.i], str: sb.String(), pos: start})
			return nil
		case c == '\n' || c == '\r':
			return lx.errAt(lx.pos(), msgStrLineBreak)
		case c == '\\':
			if lx.i+1 >= len(lx.src) {
				return lx.errAt(start, msgUnterminatedStr)
			}
			if err := lx.escape(&sb); err != nil {
				return err
			}
		default:
			sb.WriteByte(c)
			lx.adv(1)
		}
	}
}

// lexTemplate lexes a template-literal segment. start is the segment's first
// character (the backtick, or the `}` that closes a substitution) and tpl the
// literal's opening backtick. The segment ends at a backtick (tTemplate /
// tTemplateTail) or at `${` (tTemplateHead / tTemplateMiddle), which opens a
// substitution frame the matching `}` resumes from. CR and CRLF cook to LF.
func (lx *lexer) lexTemplate(start, tpl Pos, continuation bool) *Error {
	var sb strings.Builder
	from := lx.i
	for {
		if lx.i >= len(lx.src) {
			return lx.errAt(tpl, msgUnterminatedTpl)
		}
		c := lx.src[lx.i]
		switch {
		case c == '`':
			raw := lx.src[from:lx.i]
			lx.adv(1)
			kind := tTemplate
			if continuation {
				kind = tTemplateTail
			}
			lx.emit(token{kind: kind, text: raw, str: sb.String(), pos: start})
			return nil
		case c == '$' && lx.peekByte(1) == '{':
			raw := lx.src[from:lx.i]
			sub := lx.pos()
			lx.adv(2)
			kind := tTemplateHead
			if continuation {
				kind = tTemplateMiddle
			}
			lx.stack = append(lx.stack, braceFrame{template: true, tpl: tpl})
			lx.emit(token{kind: kind, text: raw, str: sb.String(), pos: start, ext: &tokExt{sub: sub}})
			return nil
		case c == '\\':
			if lx.i+1 >= len(lx.src) {
				return lx.errAt(tpl, msgUnterminatedTpl)
			}
			if err := lx.escape(&sb); err != nil {
				return err
			}
		case c == '\r':
			sb.WriteByte('\n')
			lx.adv(1)
			if lx.peekByte(0) == '\n' {
				lx.adv(1)
			}
		default:
			sb.WriteByte(c)
			lx.adv(1)
		}
	}
}

// escape decodes the escape sequence at lx.i (a backslash with at least one
// byte after it) into sb: \' \" \\ \b \f \n \r \t \v, \0 not followed by a
// digit, \xHH, \uHHHH and \u{H…}, a line continuation (backslash + line
// terminator, which produces nothing), and any other character standing for
// itself. Legacy octal escapes (\1–\9, \0 before a digit) are errors, as in
// strict-mode JavaScript, and so is an unpaired UTF-16 surrogate.
func (lx *lexer) escape(sb *strings.Builder) *Error {
	at := lx.pos()
	c := lx.src[lx.i+1]
	if b, ok := simpleEscapes[c]; ok {
		sb.WriteByte(b)
		lx.adv(2)
		return nil
	}
	switch {
	case c == '0' && !isDigit(lx.peekByte(2)):
		sb.WriteByte(0)
		lx.adv(2)
		return nil
	case isDigit(c):
		return lx.errAt(at, msgOctalEscape)
	case c == 'x':
		if !isHex(lx.peekByte(2)) || !isHex(lx.peekByte(3)) {
			return lx.errAt(at, msgHexEscape)
		}
		v, _ := strconv.ParseUint(lx.src[lx.i+2:lx.i+4], 16, 8)
		sb.WriteRune(rune(v))
		lx.adv(4)
		return nil
	case c == 'u':
		cp, n, err := lx.unicodeEscape(lx.i, at)
		if err != nil {
			return err
		}
		switch {
		case cp >= 0xDC00 && cp <= 0xDFFF:
			return lx.errAt(at, msgSurrogate)
		case cp >= 0xD800 && cp <= 0xDBFF:
			// A high surrogate must be followed at once by a \u escape for the
			// low half; together they are one code point.
			j := lx.i + n
			if j+1 >= len(lx.src) || lx.src[j] != '\\' || lx.src[j+1] != 'u' {
				return lx.errAt(at, msgSurrogate)
			}
			lo, m, err := lx.unicodeEscape(j, at)
			if err != nil || lo < 0xDC00 || lo > 0xDFFF {
				return lx.errAt(at, msgSurrogate)
			}
			sb.WriteRune(0x10000 + (cp-0xD800)<<10 + (lo - 0xDC00))
			lx.adv(n + m)
			return nil
		}
		sb.WriteRune(cp)
		lx.adv(n)
		return nil
	case c == '\n':
		lx.adv(2)
		return nil
	case c == '\r':
		lx.adv(2)
		if lx.peekByte(0) == '\n' {
			lx.adv(1)
		}
		return nil
	}
	r, size := utf8.DecodeRuneInString(lx.src[lx.i+1:])
	if r != 0x2028 && r != 0x2029 {
		// Any other character escapes to itself (a line continuation over
		// U+2028/U+2029 produces nothing).
		sb.WriteString(lx.src[lx.i+1 : lx.i+1+size])
	}
	lx.adv(1 + size)
	return nil
}

var simpleEscapes = map[byte]byte{'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f', 'v': '\v'}

// unicodeEscape decodes the \u escape at j (src[j:j+2] == `\u`) without
// consuming it: the code point and the escape's length in bytes. at positions
// the error.
func (lx *lexer) unicodeEscape(j int, at Pos) (rune, int, *Error) {
	s := lx.src
	if j+2 < len(s) && s[j+2] == '{' {
		k := j + 3
		for k < len(s) && isHex(s[k]) {
			k++
		}
		if k == j+3 || k >= len(s) || s[k] != '}' {
			return 0, 0, lx.errAt(at, msgUnicodeEscape)
		}
		hex := strings.TrimLeft(s[j+3:k], "0")
		if len(hex) > 6 {
			return 0, 0, lx.errAt(at, msgCodePoint)
		}
		v, _ := strconv.ParseUint("0"+hex, 16, 32)
		if v > 0x10FFFF {
			return 0, 0, lx.errAt(at, msgCodePoint)
		}
		return rune(v), k + 1 - j, nil
	}
	if j+6 > len(s) {
		return 0, 0, lx.errAt(at, msgUnicodeEscape)
	}
	for k := j + 2; k < j+6; k++ {
		if !isHex(s[k]) {
			return 0, 0, lx.errAt(at, msgUnicodeEscape)
		}
	}
	v, _ := strconv.ParseUint(s[j+2:j+6], 16, 32)
	return rune(v), 6, nil
}

// punctuators, longest first within each length so the lexer takes the
// longest match. The table includes the operators the grammar excludes, so the
// parser can name them in its error.
var punctuators = [...][]string{
	4: {">>>="},
	3: {"===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "..."},
	2: {"=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**"},
	1: {"(", ")", "[", "]", "{", "}", ".", ",", ":", ";", "?", "!", "~", "+", "-", "*", "/", "%", "<", ">", "=", "&", "|", "^"},
}

// punctByFirst indexes punctuators by their first byte, longest first.
var punctByFirst = func() (m [128][]string) {
	for n := 4; n >= 1; n-- {
		for _, p := range punctuators[n] {
			m[p[0]] = append(m[p[0]], p)
		}
	}
	return m
}()

func (lx *lexer) lexPunct() *Error {
	start := lx.pos()
	rest := lx.src[lx.i:]
	for _, p := range punctByFirst[rest[0]] {
		n := len(p)
		if len(rest) < n || rest[:n] != p {
			continue
		}
		// `?.` is a punctuator only when a digit does not follow, so `a?.5:1`
		// stays a conditional.
		if p == "?." && len(rest) > 2 && isDigit(rest[2]) {
			continue
		}
		switch p {
		case "{":
			lx.stack = append(lx.stack, braceFrame{})
		case "}":
			if len(lx.stack) > 0 {
				lx.stack = lx.stack[:len(lx.stack)-1]
			}
		}
		lx.adv(n)
		lx.emit(token{kind: tPunct, text: p, pos: start})
		return nil
	}
	return lx.errAt(start, unexpectedChar(rest))
}
