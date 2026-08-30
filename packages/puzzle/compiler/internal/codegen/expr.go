package codegen

import (
	"errors"
	"fmt"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// expr.go implements scope-tracked JS-expression rewriting and the SPEC §5
// event-handler compiler (constellation/doc/DOC-COMPILER-DESIGN.md §d). These are the "fix for
// the data.-prefix bug": a real (small) tokenizer over the expression string
// rewrites identifier ROOTS to `__d.<name>` and leaves loop variables,
// `event`, JS keywords/literals, and property accesses untouched.

// jsKeywords are identifier ROOTS that must never be rewritten to __d.<name>:
// JS literals and operator-keywords that can appear in a template expression.
var jsKeywords = map[string]bool{
	"true": true, "false": true, "null": true, "undefined": true,
	"this": true, "new": true, "typeof": true, "instanceof": true,
	"in": true, "of": true, "void": true, "delete": true,
	"NaN": true, "Infinity": true, "arguments": true,
}

// jsGlobals are standard JS global values/constructors that may be referenced
// directly in a template expression and must NOT be rewritten to __d.<name>
// (e.g. { Math.max(count, 1) } → Math.max(__d.count, 1), not __d.Math.max(…),
// which would throw at runtime). A data variable that happens to share one of
// these names is not distinguishable here and stays un-prefixed; that is an
// accepted trade-off for making the standard globals usable in templates.
var jsGlobals = map[string]bool{
	"Math": true, "JSON": true, "Date": true, "Number": true, "String": true,
	"Boolean": true, "Array": true, "Object": true, "RegExp": true, "Error": true,
	"Map": true, "Set": true, "WeakMap": true, "WeakSet": true, "Promise": true,
	"Symbol": true, "BigInt": true, "parseInt": true, "parseFloat": true,
	"isNaN": true, "isFinite": true, "encodeURIComponent": true,
	"decodeURIComponent": true, "console": true, "window": true, "document": true,
	"globalThis": true, "Infinity": true, "NaN": true, "undefined": true,
	"Intl": true, "URL": true, "URLSearchParams": true, "Reflect": true,
	"Proxy": true, "ArrayBuffer": true, "DataView": true, "Int8Array": true,
	"Uint8Array": true, "Uint8ClampedArray": true, "Int16Array": true,
	"Uint16Array": true, "Int32Array": true, "Uint32Array": true,
	"Float32Array": true, "Float64Array": true, "BigInt64Array": true,
	"BigUint64Array": true, "structuredClone": true, "atob": true, "btoa": true,
}

// regexPrecedingKeywords are identifier keywords that CANNOT end an expression,
// so a '/' immediately after one begins a regex literal (not division). Used to
// disambiguate `/` when the previous significant token is one of these words.
var regexPrecedingKeywords = map[string]bool{
	"return": true, "typeof": true, "instanceof": true, "in": true,
	"of": true, "void": true, "delete": true, "new": true,
	"do": true, "else": true, "yield": true, "await": true, "case": true,
}

func isIdentStart(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || b == '_' || b == '$'
}

func isIdentChar(b byte) bool {
	return isIdentStart(b) || (b >= '0' && b <= '9')
}

func isDigit(b byte) bool {
	return b >= '0' && b <= '9'
}

func isHexDigit(b byte) bool {
	return isDigit(b) || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F')
}

// isJSIdentifier reports whether s is a bare JS identifier (used both for the
// event-form test and for deciding whether an object key needs quoting).
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
// that begins with an object literal. resolveExpr rewrites identifier roots to
// __d.<name>, so an object literal's KEYS become member expressions
// (`{ done: true }` → `{ __d.done: true }`) — invalid JS that esbuild would
// otherwise reject deep in generated code with no .pzl position. Callers detect
// it up front for an actionable error (SPEC §6).
const objectLiteralMsg = "object literals aren't supported in template expressions — build the object in data() or an events handler (SPEC §6)"

// startsWithObjectLiteral reports whether a template expression begins (after
// leading whitespace) with '{'. Only a LEADING brace is detected (SPEC §6): a
// literal nested elsewhere (e.g. f(x ? {a:1} : y)) is out of scope and left to
// esbuild.
func startsWithObjectLiteral(expr string) bool {
	return strings.HasPrefix(strings.TrimSpace(expr), "{")
}

// resolveExpr rewrites identifier roots in a JS expression to read the data
// model (`__d.<name>`). Rules (constellation/doc/DOC-COMPILER-DESIGN.md §d):
//   - a name immediately preceded by a single '.' is a property access →
//     untouched; the trailing '.' of a `...` spread/rest is NOT a member access,
//     so the name after it IS a root and gets prefixed (`[...items]` →
//     `[...__d.items]`, `f(...args)` → `__d.f(...__d.args)`);
//   - a name in scope (an enclosing {#for} variable, or `event` in an event
//     handler) → untouched;
//   - a JS keyword/literal or standard JS global (Math, JSON, …) → untouched;
//   - everything else → `__d.<name>`.
//
// String literals (', ", `) are copied verbatim; a template literal's `${…}`
// interior IS resolved recursively. Numeric literals (incl. 1e3, 0xFF, 1_000,
// 100n) are scanned as a unit so their exponent/hex/separator/BigInt letters are
// never mistaken for identifier starts. Regex literals (`/a/g`, escapes and
// [...] classes handled) and comments (`//…`, `/* … */`) are copied verbatim, so
// identifiers inside them are never prefixed; a `/` is read as division when the
// previous significant token can end an expression and as a regex otherwise.
// Whitespace and operators are preserved byte-for-byte, so the emitted
// expression matches the fixture exactly.
//
// Known limitation (intentionally out of scope): arrow-function parameters and
// object-literal keys are NOT recognized as binding positions, so a name written
// there is still prefixed. These discouraged template forms are unsupported.
func resolveExpr(expr string, scope map[string]bool) string {
	out, _ := resolveExprTrackingScope(expr, scope, nil)
	return out
}

// ResolveCheckExpr exposes the render compiler's expression scoping to the
// puzzle-check emitter. Keeping this as a narrow internal-package seam avoids a
// second JavaScript scanner drifting from the one that drives runtime codegen.
func ResolveCheckExpr(expr string, scope map[string]bool) string {
	return resolveExpr(expr, scope)
}

// ResolveCheckEvent exposes the event-value compiler to puzzle check for the
// same reason as ResolveCheckExpr. The returned expression is never executed;
// TypeScript only uses it to validate the referenced handler and arguments.
func ResolveCheckEvent(expr string, scope map[string]bool) (string, error) {
	out, _, err := compileEventValue(expr, scope)
	return out, err
}

// resolveExprTrackingScope resolves expr exactly like resolveExpr and also
// reports whether it references an identifier from trackedScope. Keeping the
// reference check inside the resolver makes it follow the same lexical rules:
// property names and literal/comment/regex text do not count, while identifiers
// inside template-literal interpolations do.
func resolveExprTrackingScope(expr string, scope, trackedScope map[string]bool) (string, bool) {
	var b strings.Builder
	referencesTrackedScope := false
	n := len(expr)
	i := 0
	lastNonSpace := byte(0)
	// prevEndsExpr tracks whether the previous significant token can END an
	// expression (identifier/number/string/template close, ')', ']', '}'). It
	// disambiguates '/': division after such a token, else a regex literal.
	prevEndsExpr := false
	for i < n {
		c := expr[i]
		switch {
		case c == '\'' || c == '"':
			j := i + 1
			for j < n {
				if expr[j] == '\\' {
					j += 2
					if j > n {
						// A trailing backslash must not push past EOF — an
						// unterminated string ends AT len(expr), and the copy below
						// slices expr[i:j].
						j = n
					}
					continue
				}
				if expr[j] == c {
					j++
					break
				}
				j++
			}
			b.WriteString(expr[i:j])
			lastNonSpace = c
			prevEndsExpr = true
			i = j
		case c == '`':
			j := i + 1
			b.WriteByte('`')
			for j < n {
				if expr[j] == '\\' {
					b.WriteByte(expr[j])
					if j+1 < n {
						b.WriteByte(expr[j+1])
					}
					j += 2
					continue
				}
				if expr[j] == '`' {
					b.WriteByte('`')
					j++
					break
				}
				if expr[j] == '$' && j+1 < n && expr[j+1] == '{' {
					end := matchBalanced(expr, j+1, '{', '}')
					if end < 0 {
						// unbalanced — copy the rest verbatim
						b.WriteString(expr[j:])
						j = n
						break
					}
					inner := expr[j+2 : end]
					resolved, referencesScope := resolveExprTrackingScope(inner, scope, trackedScope)
					b.WriteString("${")
					b.WriteString(resolved)
					b.WriteByte('}')
					referencesTrackedScope = referencesTrackedScope || referencesScope
					j = end + 1
					continue
				}
				b.WriteByte(expr[j])
				j++
			}
			lastNonSpace = '`'
			prevEndsExpr = true
			i = j
		case c == '/':
			switch {
			case i+1 < n && expr[i+1] == '/':
				// Line comment — copy verbatim to newline/EOF. Comments are
				// whitespace-like and leave prevEndsExpr/lastNonSpace untouched.
				j := i + 2
				for j < n && expr[j] != '\n' {
					j++
				}
				b.WriteString(expr[i:j])
				i = j
			case i+1 < n && expr[i+1] == '*':
				// Block comment — copy verbatim to closing */ (or EOF).
				j := i + 2
				for j < n {
					if expr[j] == '*' && j+1 < n && expr[j+1] == '/' {
						j += 2
						break
					}
					j++
				}
				b.WriteString(expr[i:j])
				i = j
			case !prevEndsExpr:
				// Regex literal — copy body + flags verbatim.
				j := scanRegexLiteral(expr, i)
				b.WriteString(expr[i:j])
				lastNonSpace = expr[j-1]
				prevEndsExpr = true
				i = j
			default:
				// Division operator ('/' or '/=').
				if i+1 < n && expr[i+1] == '=' {
					b.WriteString("/=")
					i += 2
				} else {
					b.WriteByte('/')
					i++
				}
				lastNonSpace = '/'
				prevEndsExpr = false
			}
		case isIdentStart(c):
			j := i
			for j < n && isIdentChar(expr[j]) {
				j++
			}
			name := expr[i:j]
			isProp := lastNonSpace == '.'
			if !isProp && trackedScope[name] {
				referencesTrackedScope = true
			}
			if isProp || jsKeywords[name] || jsGlobals[name] || scope[name] {
				b.WriteString(name)
			} else {
				b.WriteString("__d.")
				b.WriteString(name)
			}
			lastNonSpace = name[len(name)-1]
			// A property access is always a value; a bare keyword that cannot end
			// an expression (return/typeof/…) leaves the next '/' a regex.
			if isProp {
				prevEndsExpr = true
			} else {
				prevEndsExpr = !regexPrecedingKeywords[name]
			}
			i = j
		case isDigit(c):
			// A numeric literal reached here (an identifier would already have
			// consumed its trailing digits). Scan it as a unit so its letters
			// (e/E exponent, x/X hex, trailing n) and '_' separators are not
			// tokenized as a following identifier — e.g. 1e3, 0xFF, 1_000, 100n.
			j := scanNumber(expr, i)
			b.WriteString(expr[i:j])
			lastNonSpace = expr[j-1]
			prevEndsExpr = true
			i = j
		case c == '.' && i+2 < n && expr[i+1] == '.' && expr[i+2] == '.':
			// Spread/rest `...` (SPEC §6): emit the three dots but leave
			// lastNonSpace NON-'.' (0 = expression start), so the identifier that
			// follows is treated as a ROOT and still gets the __d. prefix — a lone
			// '.' (member access) keeps lastNonSpace '.' via the default branch and
			// is untouched. A '/' after '...' begins a regex, so prevEndsExpr stays
			// false. The `{#for 1...n}` range operator is split by the parser before
			// resolveExpr, so ranges never reach here.
			b.WriteString("...")
			lastNonSpace = 0
			prevEndsExpr = false
			i += 3
		case (c == '+' || c == '-') && i+1 < n && expr[i+1] == c:
			// Prefix and postfix update operators preserve prevEndsExpr. A postfix
			// update therefore leaves a following '/' as division, while a prefix
			// update remains non-ending until its operand is scanned. Consume both
			// bytes so a+++/re/ still treats the third '+' as a plain operator and
			// the slash as a regex opener.
			b.WriteString(expr[i : i+2])
			lastNonSpace = c
			i += 2
		default:
			b.WriteByte(c)
			if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
				lastNonSpace = c
				// Only closing brackets/parens end an expression; every other
				// operator/delimiter means the next '/' starts a regex.
				prevEndsExpr = c == ')' || c == ']' || c == '}'
			}
			i++
		}
	}
	return b.String(), referencesTrackedScope
}

// scanRegexLiteral returns the index just past the regex literal starting at i
// (which must point at the opening '/'). It skips escaped characters, treats '/'
// inside a [...] character class as literal (only ']' closes the class), and
// consumes trailing flag letters. An unterminated literal returns len(s).
//
// A trivially small twin lives in parser/lexskip.go (lexScanRegexLiteral) so the
// parser's balanced scanners can share the rule without importing codegen; keep
// the two in sync.
func scanRegexLiteral(s string, i int) int {
	n := len(s)
	j := i + 1
	inClass := false
	for j < n {
		c := s[j]
		if c == '\\' {
			j += 2
			if j > n {
				// A trailing backslash must not push past EOF: the unterminated
				// result is len(s), and callers slice s[i:end] / index s[end-1].
				j = n
			}
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
			// Trailing flags (ASCII letters only).
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

// scanNumber returns the index just past the JS numeric literal starting at i
// (which must point at an ASCII digit). It consumes a radix prefix (0x/0X,
// 0b/0B, 0o/0O), digits and '_' separators, an optional fractional '.', an
// exponent (e/E with optional sign followed by digits), and a trailing 'n'
// (BigInt). Keeping these letters/underscores bound to the number prevents the
// identifier scanner from splitting e.g. 1e3 into `1` + `e3`.
func scanNumber(s string, i int) int {
	n := len(s)
	j := i
	// Radix-prefixed integer literals: 0x.., 0b.., 0o..
	if s[j] == '0' && j+1 < n {
		switch s[j+1] {
		case 'x', 'X', 'b', 'B', 'o', 'O':
			j += 2
			for j < n && (isHexDigit(s[j]) || s[j] == '_') {
				j++
			}
			if j < n && s[j] == 'n' {
				j++
			}
			return j
		}
	}
	// Integer part (with separators).
	for j < n && (isDigit(s[j]) || s[j] == '_') {
		j++
	}
	// Fractional part.
	if j < n && s[j] == '.' {
		j++
		for j < n && (isDigit(s[j]) || s[j] == '_') {
			j++
		}
	}
	// Exponent, only when it is a well-formed e[+-]?<digit> — otherwise leave the
	// 'e' for the identifier scanner (it is not part of this number).
	if j < n && (s[j] == 'e' || s[j] == 'E') {
		k := j + 1
		if k < n && (s[k] == '+' || s[k] == '-') {
			k++
		}
		if k < n && isDigit(s[k]) {
			j = k
			for j < n && (isDigit(s[j]) || s[j] == '_') {
				j++
			}
		}
	}
	// BigInt suffix.
	if j < n && s[j] == 'n' {
		j++
	}
	return j
}

// matchBalanced returns the index of the close delimiter matching the open
// delimiter at open, or -1. It routes through parser.LexSkip so strings, regex
// literals, and comments in the scanned JS are skipped exactly as the parser's
// balanced scanners do.
func matchBalanced(s string, open int, openDelim, closeDelim byte) int {
	depth := 0
	prevEndsExpr := false
	for i := open; i < len(s); {
		if next, pee, consumed := parser.LexSkip(s, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		c := s[i]
		if c == openDelim {
			depth++
		} else if c == closeDelim {
			depth--
			if depth == 0 {
				return i
			}
		}
		prevEndsExpr = parser.LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return -1
}

// splitEventConditional splits one top-level JS conditional expression into its
// condition and branches. Strings, templates, regexes, comments, and nested
// delimiters are opaque through LexSkip. Nested top-level conditionals are
// tracked only to find the matching colon; compileEventValue still rejects them
// as branch values because each branch must be a simple handler form or null.
func splitEventConditional(expr string) (condition, truthy, falsy string, ok bool) {
	depth := 0
	question := -1
	nestedQuestions := 0
	prevEndsExpr := false
	for i := 0; i < len(expr); {
		if next, pee, consumed := parser.LexSkip(expr, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		c := expr[i]
		switch c {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		}
		if depth == 0 {
			switch c {
			case '?':
				// `??` and `?.` are operators inside a condition, not the start
				// of a handler-valued conditional.
				isNullishOrOptional := (i > 0 && expr[i-1] == '?') ||
					(i+1 < len(expr) && (expr[i+1] == '?' || expr[i+1] == '.'))
				if !isNullishOrOptional {
					if question < 0 {
						question = i
					} else {
						nestedQuestions++
					}
				}
			case ':':
				if question >= 0 {
					if nestedQuestions > 0 {
						nestedQuestions--
					} else {
						return strings.TrimSpace(expr[:question]),
							strings.TrimSpace(expr[question+1 : i]),
							strings.TrimSpace(expr[i+1:]), true
					}
				}
			}
		}
		prevEndsExpr = parser.LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return "", "", "", false
}

// compileEventValue compiles an @event value and reports whether it is
// DATA-INDEPENDENT (cacheable, v1.29 D62 / SPEC §31). It accepts the two SPEC §5
// handler forms plus the D86 handler-valued conditional whose branches are each
// a handler form or null. A literal null emits no handler.
func compileEventValue(expr string, scope map[string]bool) (string, bool, error) {
	expr = strings.TrimSpace(expr)
	eventParam := "event"
	if scope["event"] {
		// Preserve a loop item/counter named event: the DOM event parameter must
		// not shadow the outer .map((event) => …) binding.
		eventParam = "__ev"
	}
	if expr == "null" {
		return "null", false, nil
	}
	if condition, truthy, falsy, ok := splitEventConditional(expr); ok {
		if condition == "" || truthy == "" || falsy == "" {
			return "", false, fmt.Errorf("event handler must be a bare method name or a single call expression (got %q)", expr)
		}
		truthyJS, err := compileEventBranch(truthy, scope, eventParam)
		if err != nil {
			return "", false, err
		}
		falsyJS, err := compileEventBranch(falsy, scope, eventParam)
		if err != nil {
			return "", false, err
		}
		// The condition is evaluated during render and may toggle function ↔
		// null, so the conditional value itself must never be cached.
		return "(" + resolveExpr(condition, scope) + ") ? " + truthyJS + " : " + falsyJS, false, nil
	}
	return compileEventHandler(expr, scope, eventParam)
}

func compileEventBranch(expr string, scope map[string]bool, eventParam string) (string, error) {
	if expr == "null" {
		return "null", nil
	}
	out, _, err := compileEventHandler(expr, scope, eventParam)
	return out, err
}

// compileEventHandler compiles one bare identifier or single call expression.
// The callee is qualified to this.events.* and call arguments are resolved with
// the DOM event in scope unless a loop binding named event already owns that
// name. Call forms are cacheable only when their arguments directly reference no
// loop-scope binding and contain no resolved render-data read.
func compileEventHandler(expr string, scope map[string]bool, eventParam string) (string, bool, error) {
	if isJSIdentifier(expr) {
		return "(" + eventParam + ") => this.events." + expr + "(" + eventParam + ")", true, nil
	}
	op := strings.IndexByte(expr, '(')
	if op < 0 {
		return "", false, fmt.Errorf("event handler must be a bare method name or a single call expression (got %q)", expr)
	}
	callee := strings.TrimSpace(expr[:op])
	if !isJSIdentifier(callee) {
		return "", false, fmt.Errorf("event handler callee must be a plain method name (got %q)", callee)
	}
	closeParen := matchBalanced(expr, op, '(', ')')
	if closeParen != len(expr)-1 {
		return "", false, fmt.Errorf("event handler must be a single call expression (got %q)", expr)
	}
	argsRaw := strings.TrimSpace(expr[op+1 : closeParen])
	// An object-literal FIRST argument (`save({ id: 1 })`) would be mangled by
	// resolveExpr into invalid JS; reject it here with the shared message. The
	// caller positions it at the @event attribute. Leading-'{' only — a literal
	// nested in a later argument is out of scope (SPEC §6).
	if startsWithObjectLiteral(argsRaw) {
		return "", false, errors.New(objectLiteralMsg)
	}
	evScope := cloneScope(scope)
	evScope["event"] = true
	argsJS := ""
	referencesLoopScope := false
	if argsRaw != "" {
		argsJS, referencesLoopScope = resolveExprTrackingScope(argsRaw, evScope, scope)
	}
	cacheable := !referencesLoopScope && !strings.Contains(argsJS, "__d.")
	return "(" + eventParam + ") => this.events." + callee + "(" + argsJS + ")", cacheable, nil
}

func cloneScope(scope map[string]bool) map[string]bool {
	out := make(map[string]bool, len(scope)+1)
	for k := range scope {
		out[k] = true
	}
	return out
}
