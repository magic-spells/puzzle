package codegen

import "strings"

// expr.go holds the small lexical helpers the emitters share. Template
// expressions themselves are lowered from their AST (lower.go).

func isIdentStart(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || b == '_' || b == '$'
}

func isIdentChar(b byte) bool {
	return isIdentStart(b) || (b >= '0' && b <= '9')
}

// isJSIdentifier reports whether s is a bare ASCII JS identifier — whether an
// attribute or prop name can be an unquoted object key.
func isJSIdentifier(s string) bool {
	if s == "" {
		return false
	}
	if !isIdentStart(s[0]) {
		return false
	}
	for i := 1; i < len(s); i++ {
		if !isIdentChar(s[i]) {
			return false
		}
	}
	return true
}

// objectLiteralMsg is the positioned compile error for a template expression
// whose braces open with an object literal: `{ { a: 1 } }` reads as a brace
// inside the interpolation brace. Object literals are legal in argument and
// nested positions (D173 V8: `{ t('label', { count: n }) }`); callers detect
// the leading brace up front for an actionable, positioned error (SPEC §6).
const objectLiteralMsg = "a template expression can't start with an object literal — pass it as a function argument or build it in data() (SPEC §6)"

// startsWithObjectLiteral reports whether a template expression's text begins
// (after leading whitespace) with '{'. It is a rule about the braces the
// author wrote, not about the expression's value, so it reads the text.
func startsWithObjectLiteral(expr string) bool {
	return strings.HasPrefix(strings.TrimSpace(expr), "{")
}
