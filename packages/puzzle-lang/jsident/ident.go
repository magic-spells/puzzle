package jsident

import (
	"unicode"
	"unicode/utf8"
)

// IsIDStart reports whether r may begin a JavaScript identifier: `$`, `_`, or
// a Unicode ID_Start code point (letters, letter numbers, Other_ID_Start, minus
// Pattern_Syntax and Pattern_White_Space). The template expression lexer and
// the compiler's <script> scan share it, so a name one accepts the other does.
func IsIDStart(r rune) bool {
	if r < utf8.RuneSelf {
		return r == '$' || r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
	}
	if unicode.Is(unicode.Pattern_Syntax, r) || unicode.Is(unicode.Pattern_White_Space, r) {
		return false
	}
	return unicode.IsLetter(r) || unicode.Is(unicode.Nl, r) || unicode.Is(unicode.Other_ID_Start, r)
}

// IsIDContinue reports whether r may continue a JavaScript identifier:
// ID_Start plus digits, combining marks, connector punctuation,
// Other_ID_Continue, and the ZWNJ and ZWJ joiners JavaScript adds.
func IsIDContinue(r rune) bool {
	if r < utf8.RuneSelf {
		return r == '$' || r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
	}
	if r == 0x200C || r == 0x200D {
		return true
	}
	if unicode.Is(unicode.Pattern_Syntax, r) || unicode.Is(unicode.Pattern_White_Space, r) {
		return false
	}
	return IsIDStart(r) || unicode.In(r, unicode.Mn, unicode.Mc, unicode.Nd, unicode.Pc) ||
		unicode.Is(unicode.Other_ID_Continue, r)
}
