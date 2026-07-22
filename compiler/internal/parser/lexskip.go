package parser

// lexskip.go holds the ONE shared lexical-skip helper behind every balanced
// scanner in this package (scanBraceGroup, splitTopLevel, lastTopLevelIndexByte,
// topLevelIndex) and, via export, matchBrace/matchParen in the codegen package.
// Per scan.go's doc comment, a single balanced scan MUST back all these paths —
// three divergent scanners is how the prototype died — so string, template
// literal, regex literal, and comment skipping live here ONCE instead of being
// pasted into each loop.
//
// Regex-vs-division disambiguation mirrors resolveExpr in codegen/expr.go: a '/'
// after a token that can END an expression (identifier/number/string/regex/`)`/
// `]`/`}`) is division, otherwise it opens a regex literal. Callers thread a
// prevEndsExpr bool through their loop: LexSkip both consumes opaque lexical
// units and reports the state that follows them, and LexPlainEndsExpr folds the
// plain bytes the caller processes itself back into that same state.

// lexRegexPrecedingKeywords are identifier keywords that CANNOT end an
// expression, so a '/' immediately after one opens a regex literal (not
// division). Mirrors regexPrecedingKeywords in codegen/expr.go.
var lexRegexPrecedingKeywords = map[string]bool{
	"return": true, "typeof": true, "instanceof": true, "in": true,
	"of": true, "void": true, "delete": true, "new": true,
	"do": true, "else": true, "yield": true, "await": true, "case": true,
}

func lexIsIdentStart(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || b == '_' || b == '$'
}

func lexIsIdentChar(b byte) bool {
	return lexIsIdentStart(b) || (b >= '0' && b <= '9')
}

func lexIsSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

// LexSkip inspects the byte at s[i] for the balanced scanners. When it begins a
// lexical unit the caller must treat as OPAQUE — a '...'/"..."/`...` string, a
// /re/flags regex literal, a // or /* */ comment, or an identifier run — LexSkip
// returns the index just past that unit, the prevEndsExpr state that follows it,
// and consumed=true; the caller must NOT re-inspect the skipped bytes. For any
// other byte (operator, bracket, separator, digit, whitespace) it returns
// consumed=false and leaves i/pee alone: the caller processes s[i] itself, then
// folds it into prevEndsExpr via LexPlainEndsExpr.
//
// Strings and template literals are escape-aware and close on the matching
// quote. Template `${…}` interiors are scanned with the same balanced machinery,
// so strings/comments/regexes/nested backticks inside an interpolation cannot
// expose a brace or section-close sentinel to the caller. An identifier run is
// consumed as a unit so a keyword that cannot end an expression
// (return/typeof/…) leaves a following '/' a regex, exactly as resolveExpr does;
// a keyword used as a property name (`.return`) still ends an expression.
// Identifier runs and strings contain no separators or brackets, so swallowing
// them whole never hides a separator/depth char from the caller.
func LexSkip(s string, i int, prevEndsExpr bool) (next int, pee bool, consumed bool) {
	c := s[i]
	switch {
	case c == '\'' || c == '"':
		j := i + 1
		for j < len(s) {
			if s[j] == '\\' {
				j += 2
				continue
			}
			if s[j] == c {
				j++
				break
			}
			j++
		}
		return j, true, true
	case c == '`':
		return lexScanTemplateLiteral(s, i), true, true
	case c == '/' && i+1 < len(s) && s[i+1] == '/':
		// Line comment — skip to newline/EOF; insignificant, prevEndsExpr unchanged.
		j := i + 2
		for j < len(s) && s[j] != '\n' {
			j++
		}
		return j, prevEndsExpr, true
	case c == '/' && i+1 < len(s) && s[i+1] == '*':
		// Block comment — skip to closing */ (or EOF); prevEndsExpr unchanged.
		j := i + 2
		for j < len(s) {
			if s[j] == '*' && j+1 < len(s) && s[j+1] == '/' {
				j += 2
				break
			}
			j++
		}
		return j, prevEndsExpr, true
	case c == '/' && !prevEndsExpr:
		// Regex literal — a '/' where the previous token cannot end an expression.
		return lexScanRegexLiteral(s, i), true, true
	case lexIsIdentStart(c):
		j := i
		for j < len(s) && lexIsIdentChar(s[j]) {
			j++
		}
		if lexPrecededByDot(s, i) {
			return j, true, true
		}
		return j, !lexRegexPrecedingKeywords[s[i:j]], true
	}
	return i, prevEndsExpr, false
}

// lexScanTemplateLiteral returns the index just past the template literal
// opening at i. Static chunks are escape-aware; each ${…} interpolation is
// skipped by scanBraceGroup, which routes back through LexSkip for nested
// strings, comments, regexes, and template literals. An unterminated template or
// interpolation consumes through EOF, matching the other opaque lexical scans.
func lexScanTemplateLiteral(s string, i int) int {
	for j := i + 1; j < len(s); {
		switch {
		case s[j] == '\\':
			j += 2
		case s[j] == '`':
			return j + 1
		case s[j] == '$' && j+1 < len(s) && s[j+1] == '{':
			_, end, err := scanBraceGroup(s, j+1)
			if err != nil {
				return len(s)
			}
			j = end
		default:
			j++
		}
	}
	return len(s)
}

// LexPlainEndsExpr folds a single plain byte c (one LexSkip did NOT consume:
// operator, bracket, separator, digit, or whitespace) into prevEndsExpr. A digit
// or a closing )/]/} ends an expression; whitespace is insignificant and leaves
// the state unchanged; every other operator/delimiter means the next '/' opens a
// regex.
func LexPlainEndsExpr(c byte, prev bool) bool {
	switch {
	case lexIsSpace(c):
		return prev
	case c == ')' || c == ']' || c == '}':
		return true
	case c >= '0' && c <= '9':
		return true
	default:
		return false
	}
}

// lexPrecededByDot reports whether the last significant byte before i is '.', so
// a keyword used as a property name is still treated as ending an expression.
func lexPrecededByDot(s string, i int) bool {
	for k := i - 1; k >= 0; k-- {
		if lexIsSpace(s[k]) {
			continue
		}
		return s[k] == '.'
	}
	return false
}

// lexScanRegexLiteral returns the index just past the regex literal opening at i
// (s[i] must be '/'). Mirrors scanRegexLiteral in codegen/expr.go: escapes are
// skipped, '/' inside a [...] class is literal (only ']' closes the class), and
// trailing ASCII flag letters are consumed. An unterminated literal returns
// len(s).
func lexScanRegexLiteral(s string, i int) int {
	n := len(s)
	j := i + 1
	inClass := false
	for j < n {
		c := s[j]
		if c == '\\' {
			j += 2
			continue
		}
		if inClass {
			if c == ']' {
				inClass = false
			}
			j++
			continue
		}
		switch c {
		case '[':
			inClass = true
			j++
		case '/':
			j++ // consume the closing '/'
			for j < n && ((s[j] >= 'a' && s[j] <= 'z') || (s[j] >= 'A' && s[j] <= 'Z')) {
				j++
			}
			return j
		default:
			j++
		}
	}
	return j
}
