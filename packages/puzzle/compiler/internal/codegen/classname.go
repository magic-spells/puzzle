package codegen

import (
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/jsident"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
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
// declaration or when the class is anonymous. toks is the shared token stream
// for `scripts` (tokenizeJS, computed once per compile).
func extractClassName(scripts string, toks []jsTok, file string, scriptsPos parser.Position) (string, error) {
	name, nameOff, hasExtends, found := findDefaultClass(toks)
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
	if nameCut(scripts[nameOff+len(name):]) {
		pos := scriptsPos.Advance(scripts[:nameOff])
		return "", &parser.ParseError{
			File: file, Line: pos.Line, Col: pos.Col,
			Message: fmt.Sprintf("class name `%s` is followed by a character the compiler cannot read as part of an identifier (a `\\u` escape, or a letter newer than its Unicode tables) — rename the class (D24)", name),
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

// nameCut reports whether rest — the bytes right after the class name token —
// may continue the name in JavaScript although the scan stopped: a `\u`
// escape, or a non-ASCII character that is not white space, such as a letter
// newer than Go's Unicode tables (U+30FB `・` in `データ・一覧`). The render tail
// would bind to the cut name (`データ`) and the module would crash on load.
func nameCut(rest string) bool {
	switch {
	case rest == "":
		return false
	case rest[0] == '\\':
		return true
	case rest[0] < utf8.RuneSelf:
		return false
	}
	r, _ := utf8.DecodeRuneInString(rest)
	return !unicode.IsSpace(r) && r != 0xFEFF
}

// findDefaultClass scans the token stream for the first REAL `export default
// class` keyword sequence — three consecutive identifier tokens, none of them
// inside a string/comment/regex/template literal. It returns the class name that
// follows (empty string for an anonymous class — `class {}` or `class extends
// X`), the name's byte offset in the body, and whether the sequence was found
// at all. hasExtends reports whether that
// named declaration carries a real class-level extends clause (the base
// identifier itself is intentionally unrestricted). First match wins, matching
// the historical regex behavior, so an anonymous first declaration is an error
// (not skipped to a later one).
//
// It consumes the SAME stream the binding scans use (scriptcollide.go) rather
// than re-lexing the body — three independent walks over one <script> was the
// whole cost this replaced.
func findDefaultClass(toks []jsTok) (name string, nameOff int, hasExtends bool, found bool) {
	// Keyword-sequence state: how many of export→default→class we've matched
	// consecutively. A string/regex/template or any punctuation token breaks
	// adjacency and resets to 0; a COMMENT does not (it is whitespace to the
	// grammar, so `export default /* x */ class Foo {}` is a real declaration
	// while `export default "class"` is not).
	const (
		wantExport = iota
		wantDefault
		wantClass
	)
	state := wantExport
	// prevWasDot tracks whether the previous token was a '.' member-access
	// operator, so a keyword used as a property name (`obj.export`) is not
	// mistaken for the keyword. Any other token clears it — including a comment
	// ending in '.', like `// do.`, which must NOT make the next `export` look
	// dotted.
	prevWasDot := false
	for i := 0; i < len(toks); i++ {
		t := toks[i]
		switch {
		case t.ident != "":
			switch {
			case state == wantExport && t.ident == "export" && !prevWasDot:
				state = wantDefault
			case state == wantDefault && t.ident == "default":
				state = wantClass
			case state == wantClass && t.ident == "abstract":
				// TypeScript `export default abstract class Foo {}` — the
				// modifier sits between `default` and `class`; keep waiting.
			case state == wantClass && t.ident == "class":
				name, hasExtends := classDeclarationAfter(toks, i+1)
				if name != "" {
					nameOff = toks[i+1].off
				}
				return name, nameOff, hasExtends, true
			case t.ident == "export" && !prevWasDot:
				state = wantDefault // restart the sequence on a fresh `export`
			default:
				state = wantExport
			}
			prevWasDot = false
		case t.comment:
			prevWasDot = false
		case t.opaque:
			state = wantExport // string/regex/template breaks adjacency
			prevWasDot = false
		default:
			state = wantExport // any operator/punctuation breaks adjacency
			prevWasDot = t.ch == '.'
		}
	}
	return "", 0, false, false
}

// classDeclarationAfter reads the class name at toks[j] (the token after the
// `class` keyword) and checks for a class-level `extends` before the body opens.
// A non-identifier there — including a comment, which the byte-scanning
// predecessor also refused — is an anonymous class. TypeScript generic parameter
// lists are skipped by angle depth so `class C<T extends X> {}` does not mistake
// the type constraint for the required inheritance clause.
func classDeclarationAfter(toks []jsTok, j int) (name string, hasExtends bool) {
	if j >= len(toks) || toks[j].ident == "" {
		return "", false
	}
	name = toks[j].ident
	if name == "extends" {
		return "", true
	}

	angleDepth := 0
	for i := j + 1; i < len(toks); i++ {
		t := toks[i]
		switch {
		case t.ident != "":
			if angleDepth == 0 && t.ident == "extends" {
				return name, true
			}
		case t.opaque:
			// strings/comments/regexes are transparent here
		default:
			switch t.ch {
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
		}
	}
	return name, false
}

// isCommentStart reports whether the unit LexSkip is about to consume at i is a
// `//` or `/*` comment. LexSkip returns only (next, prevEndsExpr, consumed) — it
// does not report the unit KIND — but its own comment cases are exactly these
// two byte pairs, checked before the regex-literal case, so the same two-byte
// look is an exact classification.
func isCommentStart(s string, i int) bool {
	return i+1 < len(s) && s[i] == '/' && (s[i+1] == '/' || s[i+1] == '*')
}

func isASCIISpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

// classNameFromFilename derives a valid JS class identifier from a .pzl filename
// for scriptless components (DOC-SPEC.md §4, where <script> is optional). The
// base name has its extension stripped, every character that cannot continue a
// JS identifier (jsident.IsIDContinue — so `Übersicht` stays whole) replaced
// with '_', and a leading '_' prepended when the result would otherwise not
// start an identifier (a digit, a combining mark) or be reserved in
// strict-mode JavaScript. An empty/degenerate name falls back to a stable
// default.
func classNameFromFilename(filename string) string {
	base := filepath.Base(filename)
	if ext := filepath.Ext(base); ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	var b strings.Builder
	for _, r := range base {
		if jsident.IsIDContinue(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	name := b.String()
	if name == "" {
		return "PuzzleComponent"
	}
	if first, _ := utf8.DecodeRuneInString(name); !jsident.IsIDStart(first) || jsident.IsReservedBindingIdentifier(name) {
		name = "_" + name
	}
	return name
}
