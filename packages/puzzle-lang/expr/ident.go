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

// reservedMessage returns the error for name used where a value or a binding
// is expected, or "" when name is an ordinary identifier. true, false, null,
// and undefined are literals, not identifiers, so they are reserved here too.
func reservedMessage(name string) string {
	if m, ok := keywordMessages[name]; ok {
		return m
	}
	if statementWords[name] {
		return "`" + name + "` begins a statement, and " + msgStatement
	}
	switch name {
	case "true", "false", "null", "undefined":
		return "`" + name + "` is a literal value and cannot name a binding"
	}
	if jsident.IsReservedBindingIdentifier(name) {
		return "`" + name + "` is a reserved word in JavaScript and cannot name a value"
	}
	return ""
}
