package codegen

import (
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// classname.go extracts the component class name for the appended
// `Name.prototype.render = …` assignment (constellation/doc/DOC-DECISIONS.md D24). The Go side
// never parses JavaScript (D3): the name comes from a TEXTUAL scan for the
// SPEC-mandated `export default class <Name>` declaration — the FIRST REAL one,
// where "real" means not buried in a string, template literal, comment, or
// regex literal. An anonymous default class is a build error.
//
// The scan routes through the parser's shared comment/string-aware LexSkip
// machinery (lexskip.go — the same scanner backing findScriptClose and the
// balanced splitters) instead of a line-anchored regex: a commented-out
// `export default class Fake` sitting at column 0 used to win the regex match
// and emit `Fake.prototype.render = …`, a ReferenceError at module load.

// extractClassName finds the exported class name in the opaque <script> body.
// It returns a positioned error when there is no `export default class`
// declaration or when the class is anonymous.
func extractClassName(scripts, file string, scriptsPos parser.Position) (string, error) {
	name, hasExtends, found := findDefaultClass(scripts)
	if !found {
		return "", &parser.ParseError{
			File: file, Line: scriptsPos.Line, Col: scriptsPos.Col,
			Message: "no `export default class <Name> extends PuzzleView` declaration found in <script> (SPEC §4, D24)",
		}
	}
	if name == "" {
		return "", &parser.ParseError{
			File: file, Line: scriptsPos.Line, Col: scriptsPos.Col,
			Message: "anonymous default class export is not supported — name your component class (D24)",
		}
	}
	if !hasExtends {
		return "", &parser.ParseError{
			File: file, Line: scriptsPos.Line, Col: scriptsPos.Col,
			Message: "the default export must extend PuzzleView (directly or through a base class) — add an `extends` clause (SPEC §4, D24)",
		}
	}
	return name, nil
}

// findDefaultClass scans s for the first REAL `export default class` keyword
// sequence — three consecutive identifier tokens separated only by whitespace,
// none of them inside a string/comment/regex/template literal (skipped via
// parser.LexSkip). It returns the class name that follows (empty string for an
// anonymous class — `class {}` or `class extends X`) and whether the sequence
// was found at all. hasExtends reports whether that named declaration carries a
// real class-level extends clause (the base identifier itself is intentionally
// unrestricted). First match wins, matching the historical regex behavior, so
// an anonymous first declaration is an error (not skipped to a later one).
func findDefaultClass(s string) (name string, hasExtends bool, found bool) {
	// Keyword-sequence state: how many of export→default→class we've matched
	// consecutively (whitespace-only between). A comment/string/regex or any
	// non-whitespace operator byte breaks adjacency and resets to 0.
	const (
		wantExport = iota
		wantDefault
		wantClass
	)
	state := wantExport
	prevEndsExpr := false
	// prevWasDot tracks whether the previous SIGNIFICANT token was a '.' member-
	// access operator, so a keyword used as a property name (`obj.export`) is not
	// mistaken for the keyword. A '.' is always a plain byte (LexSkip never starts
	// a unit with it), so any consumed unit — string, comment, regex, identifier —
	// clears it (a comment ending in '.', like `// do.`, must NOT make the next
	// `export` look dotted).
	prevWasDot := false
	i, n := 0, len(s)
	for i < n {
		c := s[i]
		if next, pee, consumed := parser.LexSkip(s, i, prevEndsExpr); consumed {
			if isIdentStart(c) {
				tok := s[i:next]
				switch {
				case state == wantExport && tok == "export" && !prevWasDot:
					state = wantDefault
				case state == wantDefault && tok == "default":
					state = wantClass
				case state == wantClass && tok == "class":
					name, hasExtends := classDeclarationAfter(s, next)
					return name, hasExtends, true
				case tok == "export" && !prevWasDot:
					state = wantDefault // restart the sequence on a fresh `export`
				default:
					state = wantExport
				}
			} else {
				state = wantExport // string/comment/regex breaks adjacency
			}
			prevWasDot = false
			prevEndsExpr = pee
			i = next
			continue
		}
		if !isASCIISpace(c) {
			state = wantExport // any operator/punctuation breaks adjacency
			prevWasDot = c == '.'
		}
		prevEndsExpr = parser.LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return "", false, false
}

// classDeclarationAfter reads the class name following the `class` keyword and
// checks for a class-level `extends` token before the body. TypeScript generic
// parameter lists are skipped by angle depth so `class C<T extends X> {}` does
// not mistake the type constraint for the required inheritance clause.
func classDeclarationAfter(s string, i int) (name string, hasExtends bool) {
	n := len(s)
	for i < n && isASCIISpace(s[i]) {
		i++
	}
	if i >= n || !isIdentStart(s[i]) {
		return "", false
	}
	j := i
	for j < n && isIdentChar(s[j]) {
		j++
	}
	name = s[i:j]
	if name == "extends" {
		return "", true
	}

	angleDepth := 0
	prevEndsExpr := false
	for i = j; i < n; {
		if next, pee, consumed := parser.LexSkip(s, i, prevEndsExpr); consumed {
			if isIdentStart(s[i]) && angleDepth == 0 && s[i:next] == "extends" {
				return name, true
			}
			prevEndsExpr = pee
			i = next
			continue
		}
		c := s[i]
		switch c {
		case '<':
			angleDepth++
		case '>':
			if angleDepth > 0 {
				angleDepth--
			}
		case '{':
			if angleDepth == 0 {
				return name, false
			}
		}
		prevEndsExpr = parser.LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return name, false
}

func isASCIISpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

// classNameFromFilename derives a valid JS class identifier from a .pzl filename
// for scriptless components (DOC-SPEC.md §4, where <script> is optional). The
// base name has its extension stripped, every character that is not a JS
// identifier char replaced with '_', and a leading '_' prepended when the result
// would otherwise start with a digit. An empty/degenerate name falls back to a
// stable default.
func classNameFromFilename(filename string) string {
	base := filepath.Base(filename)
	if ext := filepath.Ext(base); ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	var b strings.Builder
	for i := 0; i < len(base); i++ {
		if c := base[i]; isIdentChar(c) {
			b.WriteByte(c)
		} else {
			b.WriteByte('_')
		}
	}
	name := b.String()
	if name == "" {
		return "PuzzleComponent"
	}
	if name[0] >= '0' && name[0] <= '9' {
		name = "_" + name
	}
	return name
}
