package parser

import (
	"fmt"
	"strings"
)

// scan.go holds THE shared balanced-brace scanner and the top-level splitters
// that build on the same quote/depth awareness. Per constellation/doc/DOC-COMPILER-DESIGN.md
// §c, a single balanced scan MUST back interpolations, block headers, and
// attribute-value expression mode — three divergent scanners is how the
// prototype died.

// scanBraceGroup is the one shared balanced-brace scan. s[open] must be '{'. It
// returns the content between the braces and the index immediately after the
// matching '}'. It skips strings ('...', "...", `...`), regex literals, and
// comments via LexSkip so a '}' inside any of them does not terminate the group,
// and it tracks nested brace depth so an object literal such as `{ {a: 1} }`
// scans correctly. This is what lets `{#if x === '}'}`, `{#if currentFilter ===
// 'all'}`, and `{ /}/.test(name) }` terminate at the right brace — the defining
// fix over the prototype's "swallow to the next {".
func scanBraceGroup(s string, open int) (inner string, end int, err error) {
	if open >= len(s) || s[open] != '{' {
		return "", 0, fmt.Errorf("internal error: scanBraceGroup not positioned at '{'")
	}
	depth := 0
	prevEndsExpr := false
	for i := open; i < len(s); {
		// A '/' immediately after the opening '{' is structural only for a
		// complete, known block closer ({/if}, {/for}, …). Every other slash at
		// this position may open a regex literal, including the no-space
		// interpolation `{/[}]/.test(x)}`.
		if i == open+1 && s[i] == '/' {
			if isKnownBlockCloserAt(s, open) || !lexRegexLiteralClosed(s, i, lexScanRegexLiteral(s, i)) {
				prevEndsExpr = LexPlainEndsExpr('/', prevEndsExpr)
				i++
				continue
			}
		}
		if next, pee, consumed := LexSkip(s, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		c := s[i]
		switch c {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[open+1 : i], i + 1, nil
			}
		}
		prevEndsExpr = LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return "", 0, fmt.Errorf("unclosed '{'")
}

// lexRegexLiteralClosed distinguishes a completed regex scan from
// lexScanRegexLiteral's unterminated-EOF result. It is used only for a slash at
// the start of a brace group: an invalid regex-shaped expression such as
// `{/each}` still needs its group boundary found so the parser can report the
// earlier unknown {#each} opener, while a real `/foo}/` literal stays opaque.
func lexRegexLiteralClosed(s string, open, end int) bool {
	k := end - 1
	for k > open && ((s[k] >= 'a' && s[k] <= 'z') || (s[k] >= 'A' && s[k] <= 'Z')) {
		k--
	}
	return k > open && s[k] == '/'
}

var blockCloseKeywords = map[string]bool{
	"if": true, "unless": true, "case": true, "for": true,
	"svg": true, "comment": true,
}

// isKnownBlockCloserAt reports whether s[open:] is a complete block closer.
// The slash must immediately follow '{'; whitespace is tolerated around the
// known keyword, matching the lexer's existing close-token normalization.
func isKnownBlockCloserAt(s string, open int) bool {
	i := open + 2 // just after "{/"
	for i < len(s) && isSpaceByte(s[i]) {
		i++
	}
	start := i
	for i < len(s) && isNameChar(s[i]) {
		i++
	}
	if !blockCloseKeywords[s[start:i]] {
		return false
	}
	for i < len(s) && isSpaceByte(s[i]) {
		i++
	}
	return i < len(s) && s[i] == '}'
}

// scanInlineComment scans a {## … } inline comment (D70) starting at the opening
// '{'. s[open] must be '{' and the caller has verified the "{##" prefix. This is a
// DUMB scanner — deliberately NOT string/regex/JS-comment-aware (unlike
// scanBraceGroup, whose LexSkip would treat the apostrophe in `{## don't }` as an
// unterminated string and blow up). It only tracks '{'/'}' nesting depth and
// honors backslash escapes (\{ and \}), so balanced braces inside are fine
// (`{## { user.name } }` is one comment) and a lone '}' needs \}. Returns the
// index just past the matching '}'.
func scanInlineComment(s string, open int) (end int, err error) {
	depth := 0
	for i := open; i < len(s); i++ {
		c := s[i]
		if c == '\\' && i+1 < len(s) && (s[i+1] == '{' || s[i+1] == '}') {
			i++ // skip the escaped brace so it does not count toward nesting
			continue
		}
		switch c {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i + 1, nil
			}
		}
	}
	return 0, fmt.Errorf("unclosed {## comment")
}

// isBlockCommentOpen reports whether s[open] begins a {#comment} block-comment
// opener (D70): a '{' immediately followed by '#' and the exact keyword "comment"
// (firstWord stops at whitespace/'}'/any non-name char, so `{#commentary}` and
// `{#comment-x}` are NOT openers — matching how {/comment} is closed strictly).
// Content after the keyword in the opener (`{#comment note}`) is allowed.
func isBlockCommentOpen(s string, open int) bool {
	if open+2 > len(s) || s[open] != '{' || s[open+1] != '#' {
		return false
	}
	return firstWord(s[open+2:]) == "comment"
}

// matchCommentCloser reports whether s[open] begins a {/comment} closer (D70),
// tolerating whitespace like checkCloser trims elsewhere ({/comment}, {/ comment },
// {/comment } all close). On a match it returns the index just past the '}'.
func matchCommentCloser(s string, open int) (ok bool, end int) {
	i := open + 1
	if i >= len(s) || s[i] != '/' {
		return false, 0
	}
	i++
	for i < len(s) && isSpaceByte(s[i]) {
		i++
	}
	const kw = "comment"
	if i+len(kw) > len(s) || s[i:i+len(kw)] != kw {
		return false, 0
	}
	i += len(kw)
	for i < len(s) && isSpaceByte(s[i]) {
		i++
	}
	if i >= len(s) || s[i] != '}' {
		return false, 0
	}
	return true, i + 1
}

// scanBlockComment scans a {#comment} … {/comment} block (D70) starting at the
// opening '{' (caller has verified isBlockCommentOpen). The body is consumed RAW
// — never lexed or parsed — so interpolations, block tags, HTML comments, and
// otherwise-malformed template code inside are all ignored, and apostrophes/
// quotes are inert. Nested {#comment} openers are counted, so a commented-out
// region may itself contain a comment block. Returns the index just past the
// matching {/comment}.
func scanBlockComment(s string, open int) (end int, err error) {
	depth := 1
	for i := open + 1; i < len(s); {
		if s[i] != '{' {
			i++
			continue
		}
		if isBlockCommentOpen(s, i) {
			depth++
			i++
			continue
		}
		if ok, next := matchCommentCloser(s, i); ok {
			depth--
			if depth == 0 {
				return next, nil
			}
			i = next
			continue
		}
		i++
	}
	return 0, fmt.Errorf("unterminated {#comment} — expected {/comment}")
}

// isTemplateCommentInner reports whether an already-scanned brace-group inner
// (the text between '{' and '}') is a template comment (D70): the inline "##…"
// form, or the block-comment "#comment…" opener. Used at the attribute-value
// boundary, where either spelling is rejected.
func isTemplateCommentInner(inner string) bool {
	if strings.HasPrefix(inner, "##") {
		return true
	}
	return strings.HasPrefix(inner, "#") && firstWord(inner[1:]) == "comment"
}

// splitTopLevel splits s at top-level occurrences of the single-byte separator
// sep, respecting strings/regex/comments (via LexSkip) and (), [], {} nesting.
// When skipDoubled is true a doubled separator (e.g. "||") is treated as an
// operator and is NOT a split point — this is how the formatter pipe split
// avoids breaking a logical-OR (constellation/doc/DOC-COMPILER-DESIGN.md §c).
// Used for pipe splitting (sep '|', skipDoubled) and formatter-argument
// splitting (sep ',', not doubled). Skipping regex is what keeps a '|' inside
// `/a|b/` out of the formatter split.
func splitTopLevel(s string, sep byte, skipDoubled bool) []string {
	var out []string
	depth := 0
	start := 0
	prevEndsExpr := false
	for i := 0; i < len(s); {
		if next, pee, consumed := LexSkip(s, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		c := s[i]
		switch c {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		}
		if c == sep && depth == 0 {
			doubled := skipDoubled && ((i+1 < len(s) && s[i+1] == sep) || (i > 0 && s[i-1] == sep))
			if !doubled {
				out = append(out, s[start:i])
				start = i + 1
			}
		}
		prevEndsExpr = LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	out = append(out, s[start:])
	return out
}

// lastTopLevelIndexByte returns the index of the LAST top-level occurrence of
// the single-byte sep in s (respecting strings/regex/comments via LexSkip and
// (), [], {} nesting), or -1. Used to peel a trailing {#for} loop-counter
// binding without being fooled by commas inside a collection literal or call
// expression.
func lastTopLevelIndexByte(s string, sep byte) int {
	depth := 0
	last := -1
	prevEndsExpr := false
	for i := 0; i < len(s); {
		if next, pee, consumed := LexSkip(s, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		c := s[i]
		switch c {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		}
		if c == sep && depth == 0 {
			last = i
		}
		prevEndsExpr = LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return last
}

// topLevelIndex returns the index of the first top-level occurrence of sub in s
// (respecting strings/regex/comments via LexSkip and bracket nesting), or -1.
// Used to detect the `...` range operator in a {#for} header without being
// fooled by quotes.
func topLevelIndex(s, sub string) int {
	depth := 0
	prevEndsExpr := false
	for i := 0; i < len(s); {
		if next, pee, consumed := LexSkip(s, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		c := s[i]
		switch c {
		case '(', '[', '{':
			depth++
			prevEndsExpr = LexPlainEndsExpr(c, prevEndsExpr)
			i++
			continue
		case ')', ']', '}':
			depth--
			prevEndsExpr = LexPlainEndsExpr(c, prevEndsExpr)
			i++
			continue
		}
		if depth == 0 && i+len(sub) <= len(s) && s[i:i+len(sub)] == sub {
			return i
		}
		prevEndsExpr = LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return -1
}
