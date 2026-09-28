package expr

import "fmt"

// Error is a positioned expression error. Its fields are parser.ParseError's
// minus File, which the template parser adds when it converts one.
type Error struct {
	Pos     Pos
	Message string
	// Note is optional supplementary guidance shown under the message.
	Note string
}

func (e *Error) Error() string {
	return fmt.Sprintf("%d:%d: %s", e.Pos.Line, e.Pos.Col, e.Message)
}

// The messages below are part of the conformance contract
// (../conformance/expressions-parse.json): every host shows the same words at
// the same position. They follow the house form "… is not available in
// template expressions — <what to write instead>", and a fix-it that needs a
// place to compute a value names both hosts' (a data() field in PuzzleKit,
// {#let} in Sites).
const (
	computeFirst = "compute the value first (a data() field in PuzzleKit, {#let} in Sites)"

	msgExpected        = "expected an expression"
	msgThis            = "`this` is not available in template expressions — return the value from data() (a getter or a computed field), or use a formatter for a display transform"
	msgEvent           = "`event` is only available in an event handler"
	msgArrowPlace      = "arrow functions are only available as a call argument, e.g. `items.filter(item => item.done)`"
	msgArrowParam      = "arrow function parameters are plain names — defaults, rest parameters, and destructuring are not available in template expressions"
	msgArrowBlock      = "an arrow function body is one expression, not a `{ … }` block — to return an object, wrap it in parentheses: `x => ({ … })`"
	msgArrowNewline    = "a line break cannot come before `=>`"
	msgFunction        = "`function` is not available in template expressions — pass an arrow function as a call argument, e.g. `items.filter(item => item.done)`"
	msgClass           = "`class` is not available in template expressions"
	msgNew             = "`new` is not available in template expressions — to show a date, use date(v, preset), time(v, preset), or datetime(v, preset)"
	msgTypeof          = "`typeof` is not available in template expressions — test the value directly, e.g. `x == null` or `Array.isArray(x)`"
	msgInstanceof      = "`instanceof` is not available in template expressions — use `Array.isArray(x)` for a list"
	msgIn              = "the `in` operator is not available in template expressions — use `Object.keys(obj).includes(key)`"
	msgVoid            = "`void` is not available in template expressions — write `undefined`"
	msgDelete          = "`delete` is not available in template expressions — a template reads values; it never changes them"
	msgAwait           = "`await` is not available in template expressions — " + computeFirst
	msgYield           = "`yield` is not available in template expressions"
	msgSuper           = "`super` is not available in template expressions"
	msgImport          = "`import` is not available in template expressions"
	msgStatement       = "statements are not available in template expressions — a template expression is a single value, e.g. `a ? b : c`"
	msgSemicolon       = "`;` ends a statement, and statements are not available in template expressions — a template expression is a single value"
	msgComma           = "the comma operator is not available in template expressions — an expression is one value"
	msgAssign          = "assignment is not available in template expressions — a template reads values; it never changes them (to compare, write `===`)"
	msgUpdate          = "`++` and `--` are not available in template expressions — a template reads values; it never changes them"
	msgBitwise         = "bitwise operators are not available in template expressions — use `&&` / `||` for logic"
	msgBitOr           = "the `|` operator is not available in template expressions — there is no bitwise OR; write `||` for a logical OR"
	msgExponent        = "`**` is not available in template expressions — use `Math.pow(a, b)`"
	msgRegex           = "regular expression literals are not available in template expressions — use `includes()`, `startsWith()`, or `endsWith()`"
	msgComment         = "comments are not available in template expressions"
	msgSpread          = "spread (`...`) is not available in template expressions"
	msgSpreadArray     = msgSpread + " — join lists with `concat()`"
	msgSpreadObject    = msgSpread + " — " + computeFirst
	msgSpreadCall      = msgSpread + " — pass the arguments one by one"
	msgArrayHole       = "empty array slots are not available in template expressions — remove the extra `,`"
	msgEmptyArg        = "expected an argument before `,`"
	msgEmptyParens     = "expected an expression inside `( )`"
	msgComputedKey     = "computed object keys (`[key]: value`) are not available in template expressions — " + computeFirst
	msgNumericKey      = "an object key is a name or a quoted string — write `'1': value`"
	msgObjectMethod    = "object methods, getters, and setters are not available in template expressions — an object holds values"
	msgProto           = "`__proto__` is not available in template expressions"
	msgOptionalCall    = "optional calls (`?.(`) are not available in template expressions — call a method on a value that may be missing with `a?.m()`"
	msgTaggedTemplate  = "tagged templates are not available in template expressions"
	msgComputedCall    = "a method is called by name in template expressions, e.g. `a.trim()` — a computed method call (`a[name]()`) is not available"
	msgCallResult      = "a call's result cannot be called in template expressions — only a function name (`f(x)`) or a method (`a.m(x)`) can be called"
	msgNotCallable     = "only a function name (`f(x)`) or a method (`a.m(x)`) can be called in template expressions"
	msgLengthCall      = "`.length` is a property, not a method — write `x.length`"
	msgHex             = "hexadecimal numbers are not available in template expressions — write the decimal value"
	msgOctal           = "octal numbers are not available in template expressions — write the decimal value"
	msgBinary          = "binary numbers are not available in template expressions — write the decimal value"
	msgBigInt          = "BigInt literals are not available in template expressions"
	msgSeparator       = "numeric separators (`_`) are not available in template expressions — write the digits together, e.g. `1000`"
	msgLeadingZero     = "a number cannot start with a leading zero — write `7`, not `07`"
	msgExponentDigits  = "a number's exponent needs digits, e.g. `1e3`"
	msgNumberThenName  = "a number cannot be followed directly by a name — put a space or an operator between them; to call a method on a number, write `(1).toFixed(2)`"
	msgUnterminatedStr = "unterminated string — add the closing quote"
	msgStrLineBreak    = "a string cannot contain a line break — write `\\n`, or use a template literal"
	msgOctalEscape     = "octal escapes are not available in template expressions — write `\\x..` or `\\u....`"
	msgHexEscape       = "a `\\x` escape needs two hex digits, e.g. `\\x41`"
	msgUnicodeEscape   = "a `\\u` escape needs four hex digits (`\\u00e9`) or a code point in braces (`\\u{1F600}`)"
	msgCodePoint       = "a `\\u{…}` escape's code point must be at most 10FFFF"
	msgSurrogate       = "a lone UTF-16 surrogate escape is not available in template expressions — write the whole character, or its code point in braces, e.g. `\\u{1F600}`"
	msgUnterminatedTpl = "unterminated template literal — add the closing backtick"
	msgNameEscape      = "escapes are not available in names — write the character itself"
	msgTooDeep         = "expression nests too deeply"
)
