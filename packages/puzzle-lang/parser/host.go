package parser

import "strings"

// host.go is the public surface for a host that brings its own file layout.
// PuzzleKit files are split by SplitSections around a <puzzle-view> wrapper; a
// Sites theme file has no wrapper — it is markup plus optional top-level
// <schema>, <script> and <style> blocks. Such a host lifts its own blocks
// (blanking each to spaces, newlines kept, so every offset stays the author's)
// and hands the rest to ParseMarkup. The scanners below are the ones
// SplitSections and the lexer use, exported so a host's splitter reads a file
// exactly the way the parser will: a brace group, a template comment, a {#raw}
// span, a script string or a CSS comment hides a tag the same way in both.

// ParseMarkup parses a markup fragment — template content with no
// <puzzle-view> wrapper — whose first byte sits at at in the file, so every
// node position and every error is in file coordinates. A zero at means the
// fragment is the whole file (1:1, offset 0). opts is at most one Options
// value; the post-parse checks it leaves on run over the fragment. Nesting
// deeper than Options.MaxDepth (DefaultMaxDepth unless set) is a positioned
// error at the first node past the limit, found before parsing, so an
// untrusted file cannot exhaust the parser's stack.
//
// The result is a synthetic container: Tag is empty, Pos is at, Children are
// the fragment's top-level nodes, and ContainsRaw records a {#raw} block, as on
// the <puzzle-view> root. A host names or unwraps it; it is never markup.
func ParseMarkup(markup string, at Position, filename string, opts ...Options) (*Element, error) {
	o := pickOptions(opts)
	if at.Line < 1 {
		at = Position{Line: 1, Col: 1}
	}
	if limit := o.markupDepth(); limit > 0 {
		// A token scan with a counter, no recursion: it answers before the
		// recursive parser could run out of stack.
		if pos, over := scanNesting(newLexer(markup, at, filename), filename, limit, 0, rawScanBudget); over {
			return nil, errAt(filename, pos, "template nesting exceeds the limit of %d levels", limit)
		}
	}
	p, err := newParser(newLexer(markup, at, filename), filename, o)
	if err != nil {
		return nil, err
	}
	p.maxDepth = o.markupDepth()
	nodes, perr := p.parseChildren(openCtx{kind: ctxRoot, pos: at})
	if perr != nil {
		return nil, perr
	}
	root := &Element{Children: nodes, Pos: at, ContainsRaw: p.hasRaw}
	if perr := o.validate(root, filename); perr != nil {
		return nil, perr
	}
	return root, nil
}

// The scanners below take the whole file as src/s, so an index into it is a
// file offset and an error position is the file's own line and column. Every
// index they take or return is ABSOLUTE (an offset into s), and an index
// outside s is never a panic: a scanner answers "not found" (-1) or a
// positioned error.

// ScanOpenTag finds the end of the open tag whose '<' is src[i] and whose
// name, already read with TagNameAt, is name. It is quote- and brace-aware,
// so a '>' inside an attribute value or a { a > b } does not end the tag
// early. It returns the index just past '>', the index of the first attribute
// byte, and the trimmed attribute text; the error is a positioned *ParseError
// for an unterminated tag or an unclosed '{'.
func ScanOpenTag(src string, i int, name, filename string) (afterGT, attrOffset int, attrsRaw string, err error) {
	if i < 0 || i >= len(src) || src[i] != '<' || name == "" || !strings.HasPrefix(src[i+1:], name) {
		return 0, 0, "", posErr(src, filename, clampOffset(src, i), "no <"+name+"> open tag here")
	}
	return scanOpenTag(src, i, name, filename)
}

// TagNameAt reads the tag name starting at s[i] — just past a '<' or '</' —
// with the lexer's tag-name rules, and returns "" when no name starts there or
// the name is not followed by white space, '>', '/', or the end of s.
func TagNameAt(s string, i int) string {
	if i < 0 || i > len(s) || !startsTagName(s[i:]) {
		return ""
	}
	end := tagNameEnd(s, i)
	if end < len(s) && !isBoundary(s[end]) {
		return ""
	}
	return s[i:end]
}

// FindScriptClose scans a <script> body from index from for its real
// </script>, skipping JavaScript strings, template literals, regex literals
// and comments, so a literal "</script>" inside one does not end the body. It
// returns the index of the close tag's '<', or -1. With -1, swallowedAt is the
// index where the opaque unit that swallowed the file's last "</script>"
// began (-1 when none did), so the missing-close error can point there.
func FindScriptClose(s string, from int) (closeAt, swallowedAt int) {
	if from < 0 || from > len(s) {
		return -1, -1
	}
	rel, swallowed := findScriptClose(s, from)
	if rel < 0 {
		return -1, swallowed
	}
	return from + rel, -1
}

// FindStyleClose scans a <style> body from index from for its real </style>,
// skipping CSS comments and quoted strings. It returns the index of the close
// tag's '<', or -1.
func FindStyleClose(s string, from int) int {
	if from < 0 || from > len(s) {
		return -1
	}
	if rel := findStyleClose(s, from); rel >= 0 {
		return from + rel
	}
	return -1
}

// FindTemplateClose scans template markup from index from for closeTag (for
// example "</puzzle-view>"), skipping HTML comments, brace groups, template
// comments and {#raw} spans, so a close tag written inside any of them is not
// the close. It returns the index of the close tag's '<', or -1.
func FindTemplateClose(s string, from int, closeTag string) int {
	if from < 0 || from > len(s) || closeTag == "" {
		return -1
	}
	if rel := findTemplateClose(s, from, closeTag); rel >= 0 {
		return from + rel
	}
	return -1
}

// ScanBraceGroup is the parser's one balanced-brace scan. s[open] must be
// '{'. It returns the text between the braces and the index just past the
// matching '}', skipping strings, regex literals and comments so a '}' inside
// one does not end the group. It does not know template comments: use
// SkipBraceGroup to step over a group without reading it. The error is a
// positioned *ParseError at the '{'.
func ScanBraceGroup(s string, open int, filename string) (inner string, end int, err error) {
	if open < 0 || open >= len(s) || s[open] != '{' {
		return "", 0, posErr(s, filename, clampOffset(s, open), "no '{' here")
	}
	inner, end, e := scanBraceGroup(s, open)
	if e != nil {
		return "", 0, posErr(s, filename, open, "unclosed '{' (interpolation or block directive)")
	}
	return inner, end, nil
}

// SkipBraceGroup steps over the template brace group at s[open] == '{' the
// way the lexer does, returning the index just past it: a `{## … }` inline
// comment, a whole {#comment}…{/comment} or {#raw}…{/raw} block (whose bodies
// are never read as template grammar), or any other group as ScanBraceGroup
// reads it. A `\{` escape is the caller's to recognize before calling.
//
// The error is a positioned *ParseError at the '{' — the same one the lexer
// reports when the markup is parsed, because an unterminated group runs to
// the end of the file either way. A host splitter should return it, or stop
// scanning and let ParseMarkup report it. It must not step one byte and call
// again: every later '{' would rescan to the end of the file, which is
// quadratic in a hostile file full of unclosed braces.
func SkipBraceGroup(s string, open int, filename string) (end int, err error) {
	if open < 0 || open >= len(s) || s[open] != '{' {
		return 0, posErr(s, filename, clampOffset(s, open), "no '{' here")
	}
	var e error
	switch {
	case strings.HasPrefix(s[open:], "{##"):
		if end, e = scanInlineComment(s, open); e != nil {
			return 0, posErr(s, filename, open, "unclosed {## comment")
		}
	case isBlockCommentOpen(s, open):
		if end, e = scanBlockComment(s, open); e != nil {
			return 0, posErr(s, filename, open, "unterminated {#comment} — expected {/comment}")
		}
	case isBlockRawOpen(s, open):
		if _, _, end, e = scanBlockRaw(s, open); e != nil {
			return 0, posErr(s, filename, open, "unterminated {#raw} — expected {/raw}")
		}
	default:
		if _, end, e = scanBraceGroup(s, open); e != nil {
			return 0, posErr(s, filename, open, "unclosed '{' (interpolation or block directive)")
		}
	}
	return end, nil
}

// clampOffset keeps an out-of-range index inside s for an error position.
func clampOffset(s string, i int) int {
	if i < 0 {
		return 0
	}
	if i > len(s) {
		return len(s)
	}
	return i
}

// AttrName is one attribute name in an open tag, as AttrNames reads it.
type AttrName struct {
	Name string
	Pos  Position
}

// AttrNames lexes an open tag's attribute text (attrsRaw from ScanOpenTag,
// whose first byte sits at base) and returns each attribute's name and
// position in order. Values are skipped, never parsed: an attribute a host
// means to reject by name does not get expression semantics on the way. The
// error is the lexer's positioned *ParseError for malformed attribute text.
func AttrNames(attrsRaw string, base Position, filename string) ([]AttrName, error) {
	lex := newAttrLexer(attrsRaw, base, filename)
	var names []AttrName
	for {
		tok, err := lex.Next()
		if err != nil {
			return nil, err
		}
		switch tok.Type {
		case TokEOF:
			return names, nil
		case TokAttrName:
			names = append(names, AttrName{Name: tok.Value, Pos: tokPos(tok)})
		}
	}
}

// ParseAttrString parses an open tag's attribute text (attrsRaw from
// ScanOpenTag, whose first byte sits at base) into attributes, with the same
// rules as an element's. tag names the tag in error messages.
func ParseAttrString(attrsRaw string, base Position, filename, tag string) ([]Attr, error) {
	attrs, perr := parseAttrString(attrsRaw, base, filename, tag)
	if perr != nil {
		return nil, perr
	}
	return attrs, nil
}

// ParseScriptLang validates a <script> block's attribute text, whose only
// attribute is `lang`: it returns "" for JavaScript (no attribute, or
// lang="js") and "ts" for TypeScript; anything else is a positioned error.
func ParseScriptLang(attrsRaw string, base Position, filename string) (string, error) {
	lang, perr := parseScriptsLang(attrsRaw, base, filename)
	if perr != nil {
		return "", perr
	}
	return lang, nil
}

// ParseStyleScoped validates a <style> block's attribute text, whose only
// attribute is a bare `scoped`, and reports whether it is present; anything
// else is a positioned error.
func ParseStyleScoped(attrsRaw string, base Position, filename string) (bool, error) {
	scoped, perr := parseStylesScoped(attrsRaw, base, filename)
	if perr != nil {
		return false, perr
	}
	return scoped, nil
}
