package expr

import (
	"unicode"
	"unicode/utf8"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/jsident"
)

// ident.go holds the identifier rules: JavaScript's Unicode ID_Start and
// ID_Continue, and what a reserved word in a reference position means.

// isIDStart reports whether r may begin a name: `$`, `_`, or a Unicode
// ID_Start code point (letters, letter numbers, Other_ID_Start, minus
// Pattern_Syntax and Pattern_White_Space).
func isIDStart(r rune) bool {
	if r < utf8.RuneSelf {
		return r == '$' || r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
	}
	if unicode.Is(unicode.Pattern_Syntax, r) || unicode.Is(unicode.Pattern_White_Space, r) {
		return false
	}
	return unicode.IsLetter(r) || unicode.Is(unicode.Nl, r) || unicode.Is(unicode.Other_ID_Start, r)
}

// isIDContinue reports whether r may continue a name: ID_Start plus digits,
// combining marks, connector punctuation, Other_ID_Continue, and the ZWNJ and
// ZWJ joiners JavaScript adds.
func isIDContinue(r rune) bool {
	if r < utf8.RuneSelf {
		return r == '$' || r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
	}
	if r == 0x200C || r == 0x200D {
		return true
	}
	if unicode.Is(unicode.Pattern_Syntax, r) || unicode.Is(unicode.Pattern_White_Space, r) {
		return false
	}
	return isIDStart(r) || unicode.In(r, unicode.Mn, unicode.Mc, unicode.Nd, unicode.Pc) ||
		unicode.Is(unicode.Other_ID_Continue, r)
}

// statementWords are the reserved words that begin a statement or a
// declaration. Written where a value is expected they get the statements
// message rather than the generic reserved-word one.
var statementWords = map[string]bool{
	"var": true, "let": true, "const": true, "if": true, "else": true, "for": true,
	"while": true, "do": true, "return": true, "switch": true, "case": true,
	"default": true, "break": true, "continue": true, "throw": true, "try": true,
	"catch": true, "finally": true, "with": true, "debugger": true, "export": true,
}

// keywordMessages are the reserved words with a message of their own.
var keywordMessages = map[string]string{
	"this":       msgThis,
	"new":        msgNew,
	"typeof":     msgTypeof,
	"instanceof": msgInstanceof,
	"in":         msgIn,
	"void":       msgVoid,
	"delete":     msgDelete,
	"await":      msgAwait,
	"yield":      msgYield,
	"function":   msgFunction,
	"class":      msgClass,
	"super":      msgSuper,
	"import":     msgImport,
}

// reservedMessage returns the error for name READ as a value, or "" when name
// is an ordinary identifier. true, false, null, undefined, NaN, and Infinity
// are literals, not identifiers, so they are reserved here too. eval and
// arguments are not: strict mode forbids only binding them, so a data field
// by either name reads like any other.
func reservedMessage(name string) string {
	if m, ok := keywordMessages[name]; ok {
		return m
	}
	if statementWords[name] {
		return "`" + name + "` begins a statement, and " + msgStatement
	}
	switch name {
	case "true", "false", "null", "undefined", "NaN", "Infinity":
		return "`" + name + "` is a literal value and cannot name a binding"
	case "eval", "arguments":
		return ""
	}
	if jsident.IsReservedBindingIdentifier(name) {
		return "`" + name + "` is a reserved word in JavaScript and cannot name a value"
	}
	return ""
}

// IsIdentifier reports whether s is one JavaScript identifier by shape: an
// ID_Start character (`$` and `_` included) followed by ID_Continue
// characters. It says nothing about reserved words; BindingNameReason does.
func IsIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i, r := range s {
		if r == utf8.RuneError {
			return false
		}
		if i == 0 && !isIDStart(r) || i > 0 && !isIDContinue(r) {
			return false
		}
	}
	return true
}

// BindingNameReason is the one rule for a name a template BINDS — an arrow
// parameter, a {#for} item or counter, a <Snippet> parameter (and a Sites
// {#let} name). It returns "" when identifier-shaped name may be bound, or a
// phrase that completes "<name> …" when it may not: a strict-mode reserved
// word (eval and arguments included), a literal word, or a JavaScript global
// the language gives a meaning to. `event` may be bound: a bound `event`
// shadows a handler's DOM event, as JavaScript scoping would. Check the shape
// with IsIdentifier first.
func BindingNameReason(name string) string {
	switch {
	case jsident.IsReservedBindingIdentifier(name):
		return "is not a legal binding identifier in strict-mode JavaScript"
	case name == "NaN" || name == "Infinity" || name == "undefined":
		return "is a literal value and cannot name a binding"
	case globalValueMessage(name) != "":
		return "is a JavaScript global and cannot name a binding"
	}
	return ""
}
