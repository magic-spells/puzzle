package codegen

import (
	"fmt"
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// expr.go implements scope-tracked JS-expression rewriting and the SPEC §5
// event-handler compiler (constellation/doc/DOC-COMPILER-DESIGN.md §d). These are the "fix for
// the data.-prefix bug": a real (small) tokenizer over the expression string
// rewrites identifier ROOTS to `__d.<name>` and leaves loop variables,
// `event`, JS keywords/literals, and property accesses untouched.

// scopeMap is the lexical scope threaded through emission: an in-scope
// identifier maps to the JS it resolves to. The empty string means "emit the
// name bare" — an ordinary binding (a range-loop variable, a snippet param,
// `event`, the imported `ViewNode`). A NON-empty value is a rewrite, which is
// how a persistent list block's row locals reach their scope object
// (the D170 emission contract: `todo` → `s.item`, the counter → `s.i`).
// Membership alone still decides "do not prefix with __d."; the value only
// decides what is written in the identifier's place.
type scopeMap map[string]string

// scopeRef reports the JS an in-scope identifier resolves to.
func scopeRef(scope scopeMap, name string) (string, bool) {
	repl, ok := scope[name]
	if !ok {
		return "", false
	}
	if repl == "" {
		return name, true
	}
	return repl, true
}

// boolScope adapts a plain name set to a scopeMap. It is the seam for callers
// outside codegen (puzzle check) that only ever bind plain names.
func boolScope(names map[string]bool) scopeMap {
	out := make(scopeMap, len(names))
	for k := range names {
		out[k] = ""
	}
	return out
}

// exprFacts is what one resolved expression READ, classified by the same
// lexical pass that rewrites it (D170, compiler lowering). A list block needs three
// things from a loop body — which parent data roots it reads (the `roots`
// dirty mask), which members it reads off the row item (`fields`/`deep`), and
// whether it touches `this` (`volatile`) — and deriving them from a second
// scanner would be a second set of rules to keep in sync with resolveExpr.
type exprFacts struct {
	// roots are the identifier roots rewritten to `__d.<name>`, in first-read
	// order, distinct.
	roots []string
	// locals records how each in-scope binding was read.
	locals map[string]*localRead
	// usesThis is set by a bare `this` reference (not a property named "this").
	usesThis bool
	// volatileRead is set by a read of a mutable global or a clock-reading
	// built-in formatter — a value that can differ between two renders with no
	// data mutation at all, so a cached row would freeze it (D170 volatile).
	volatileRead bool
}

// localRead is how one in-scope binding was used inside an expression.
type localRead struct {
	// fields are the depth-one member names read off the binding
	// (`todo.text` → "text"), in first-read order, distinct.
	fields []string
	// deep marks a read the row revision cannot cover: a deeper path
	// (`todo.author.name`), a dynamic member (`todo[k]`), or a call on the
	// binding (`todo.fullName()`).
	deep bool
	// bareInCall marks the binding passed WHOLE into a call — `fmt(todo)`,
	// whose result is displayed, so the row depends on more than the item's own
	// identity. A whole read outside call parens (a component prop, a handler
	// argument) is not recorded here: those re-read the live row at use time.
	bareInCall bool
	// whole marks a whole-value read that IS the entire expression — `{ todo }`,
	// `todo={ todo }`, `del(todo)`'s argument. Such a read depends on the item's
	// identity alone, which the row revision covers exactly.
	whole bool
	// opaque marks a whole-value read that is NOT the entire expression: a
	// parenthesised or comment-separated member access (`(post).author.name`), a
	// template-literal interpolation, an operand of a larger expression, a call
	// argument. The compiler cannot see which members the value reaches, so the
	// site is conservative (`deep`) exactly as a relation read is. A formatter
	// pipe marks a `whole` read opaque for the same reason (the formatter is
	// handed the record itself).
	opaque bool
	// renderRead marks a read evaluated during RENDER. A handler ARGUMENT is
	// not one: it is re-read at fire time against the live row scope, so it
	// neither makes an enclosing-local read volatile nor counts as opaque —
	// the same carve-out `this` in a handler argument already has.
	renderRead bool
}

func (f *exprFacts) addRoot(name string) {
	for _, r := range f.roots {
		if r == name {
			return
		}
	}
	f.roots = append(f.roots, name)
}

func (f *exprFacts) local(name string) *localRead {
	if f.locals == nil {
		f.locals = map[string]*localRead{}
	}
	r := f.locals[name]
	if r == nil {
		r = &localRead{}
		f.locals[name] = r
	}
	return r
}

func (r *localRead) addField(name string) {
	for _, f := range r.fields {
		if f == name {
			return
		}
	}
	r.fields = append(r.fields, name)
}

// merge folds other into f, preserving first-read order.
func (f *exprFacts) merge(other *exprFacts) {
	if f == nil || other == nil {
		return
	}
	for _, r := range other.roots {
		f.addRoot(r)
	}
	if other.usesThis {
		f.usesThis = true
	}
	if other.volatileRead {
		f.volatileRead = true
	}
	for name, read := range other.locals {
		dst := f.local(name)
		for _, fl := range read.fields {
			dst.addField(fl)
		}
		dst.deep = dst.deep || read.deep
		dst.bareInCall = dst.bareInCall || read.bareInCall
		dst.whole = dst.whole || read.whole
		dst.opaque = dst.opaque || read.opaque
		dst.renderRead = dst.renderRead || read.renderRead
	}
}

// volatileGlobals are globals whose value can change between two renders with
// no data mutation at all: the clock, the URL, storage, the RNG. A row body
// reading one must re-evaluate every pass, so its site is `volatile` (D170).
// Only the names that are ALSO in jsGlobals are reachable here — the rest
// (`performance`, `location`, `history`, `navigator`, `localStorage`,
// `sessionStorage`, `crypto`, `self`) resolve to `__d.<name>` and are already
// tracked through the site's roots mask; they are listed so the rule is
// complete if one of them ever joins jsGlobals.
var volatileGlobals = map[string]bool{
	"Date": true, "performance": true, "window": true, "document": true,
	"location": true, "history": true, "navigator": true,
	"localStorage": true, "sessionStorage": true, "crypto": true,
	"globalThis": true, "self": true,
}

// volatileGlobalRead reports whether the global `name` read at src[..at] is a
// mutable one. `Math` is pure except for `Math.random`, so it is the one global
// classified by the member that follows it; every other pure global (`JSON`,
// `Number`, `Intl`, …) is pure whatever is read off it.
func volatileGlobalRead(name, src string, at int) bool {
	if volatileGlobals[name] {
		return true
	}
	if name != "Math" {
		return false
	}
	k := skipExprSpace(src, at)
	if k < len(src) && src[k] == '?' && k+1 < len(src) && src[k+1] == '.' {
		k++
	}
	if k >= len(src) || src[k] != '.' {
		return false
	}
	m := skipExprSpace(src, k+1)
	e := m
	for e < len(src) && isIdentChar(src[e]) {
		e++
	}
	return src[m:e] == "random"
}

// clockFormatters are the shipped built-in formatters whose output depends on
// the current time rather than on their input alone, so a cached row using one
// would display a frozen value ("1 second ago", forever). A site whose body
// pipes through one is `volatile`. USER-defined formatters are pure functions of
// their input by contract (SPEC §6); a row that must re-evaluate every render
// reads through `this`, which is already volatile.
var clockFormatters = map[string]bool{"timeago": true}

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
// that BEGINS with an object literal. Object literals are legal in argument and
// nested positions (D173 V8: `{ label | t({ count: n }) }`, the scanner scopes
// their values and leaves their keys alone), but not at the start of an
// expression, where `{ {` reads as a brace inside the interpolation brace.
// Callers detect it up front for an actionable, positioned error (SPEC §6).
const objectLiteralMsg = "a template expression can't start with an object literal — pass it as an argument (a formatter's or a call's) or build it in data() (SPEC §6)"

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
// Object-literal KEYS are recognized (D173 V8): only the values are scoped, and a
// shorthand property is expanded. Known limitation (intentionally out of scope):
// arrow-function parameters are NOT recognized as binding positions, so a name
// written there is still prefixed. That discouraged template form is unsupported.
func resolveExpr(expr string, scope scopeMap) string {
	out, _ := resolveExprScan(expr, scope, nil, nil)
	return out
}

// ResolveCheckExpr exposes the render compiler's expression scoping to the
// puzzle-check emitter. Keeping this as a narrow internal-package seam avoids a
// second JavaScript scanner drifting from the one that drives runtime codegen.
// The check emitter only ever binds plain names, so it keeps the plain name-set
// signature; the scopeMap rewrite values are a render-emission concern.
func ResolveCheckExpr(expr string, scope map[string]bool) string {
	return resolveExpr(expr, boolScope(scope))
}

// ResolveCheckEvent exposes the event-value compiler to puzzle check for the
// same reason as ResolveCheckExpr. The returned expression is never executed;
// TypeScript only uses it to validate the referenced handler and arguments.
//
// The one difference from the runtime form: a BARE handler name compiles to a
// plain `this.events.name` reference instead of the runtime's
// `(event) => this.events.name(event)` wrapper. The runtime always passes the
// DOM event, but a handler is free to declare no parameters — legal JavaScript
// that a synthesized one-argument call would report as an arity error, at a
// generated position with no authored bytes to point at. As a reference it is
// checked for existence and signature compatibility instead, which is what the
// bare form actually promises. Call forms keep their authored arguments and are
// still checked as calls.
func ResolveCheckEvent(expr string, scope map[string]bool) (string, error) {
	ev, err := compileEventValueMode(expr, boolScope(scope), true, nil)
	return ev.js, err
}

// resolveExprTrackingScope resolves expr exactly like resolveExpr and also
// reports whether it references an identifier from trackedScope.
func resolveExprTrackingScope(expr string, scope, trackedScope scopeMap) (string, bool) {
	return resolveExprScan(expr, scope, trackedScope, nil)
}

// resolveExprScan is the single expression pass. It resolves expr exactly like
// resolveExpr, reports whether it references an identifier from trackedScope,
// and — when facts is non-nil — classifies every identifier root it saw
// (exprFacts). Keeping all three inside ONE scanner makes them follow the same
// lexical rules: property names and literal/comment/regex text do not count,
// while identifiers inside template-literal interpolations do.
//
// resolveExprScan does NOT guard member access: it is the form for event
// handler arguments (PuzzleKit JavaScript, evaluated at fire time) and for the
// puzzle-check emitter. Template VALUE positions go through
// resolveValueScan instead.
func resolveExprScan(expr string, scope, trackedScope scopeMap, facts *exprFacts) (string, bool) {
	return resolveExprScanIn(expr, scope, trackedScope, facts, false, false)
}

// resolveValueScan is resolveExprScan for a template VALUE position — text
// interpolation, attribute values and props, block headers, loop collections
// and range bounds, formatter arguments, row keys. It lowers every member and
// index step to its optional form (`a.b.c` → `__d.a?.b?.c`, `a[i]` →
// `__d.a?.[__d.i]`), so reading through a missing value yields undefined and
// prints nothing instead of throwing a render error (D173 V4). A path that
// exists evaluates exactly as before.
//
// Three kinds of step stay plain because they can never be nullish or because
// an optional step there is a syntax error: the first step off `this`, a
// standard global (`Math.max`) or a literal (`'a'.length`), and every step of a
// `new` callee (`new Intl.NumberFormat(…)` — `new a?.B()` does not parse). An
// expression the optional form cannot express at all — a tagged template, an
// update operator, an assignment — is emitted unguarded, byte-for-byte as
// resolveExprScan would.
func resolveValueScan(expr string, scope scopeMap, facts *exprFacts) string {
	if facts == nil {
		out, _, ok := resolveGuardedIn(expr, scope, nil, false)
		if ok {
			return out
		}
		plain, _ := resolveExprScanIn(expr, scope, nil, nil, false, false)
		return plain
	}
	// The guarded pass reads into a scratch set so a fallback to the plain pass
	// does not record every read twice.
	sub := &exprFacts{}
	out, _, ok := resolveGuardedIn(expr, scope, sub, false)
	if ok {
		facts.merge(sub)
		return out
	}
	plain, _ := resolveExprScanIn(expr, scope, nil, facts, false, false)
	return plain
}

// resolveGuardedIn runs the guarded scan and reports whether the expression
// could be guarded (ok false means: emit the plain form instead).
func resolveGuardedIn(expr string, scope scopeMap, facts *exprFacts, nested bool) (string, bool, bool) {
	var unguardable bool
	out, refs := resolveExprScanFull(expr, scope, nil, facts, nested, true, &unguardable)
	return out, refs, !unguardable
}

// resolveExprScanIn is resolveExprScan with the nesting flag the template-literal
// recursion sets. A read inside `${…}` is never "the entire expression", however
// it is spelled, so it can never be the identity-only whole-value read.
func resolveExprScanIn(expr string, scope, trackedScope scopeMap, facts *exprFacts, nested, guard bool) (string, bool) {
	var unguardable bool
	return resolveExprScanFull(expr, scope, trackedScope, facts, nested, guard, &unguardable)
}

// chainFrame is the member-chain state saved when a bracket opens, so a root
// read INSIDE `f(…)`, `a[…]` or `{…}` cannot change how the chain around it is
// guarded.
type chainFrame struct {
	open      byte // '(', '[' or '{'
	safeSteps int
}

// resolveExprScanFull is the scanner body. guard turns on the D173 V4 member
// guard; *unguardable is set when the expression contains a construct the
// optional form cannot express (see resolveValueScan), and the caller then
// re-emits it plain.
//
// Object literals (D173 V8) are recognized by their braces: inside `{…}` an
// identifier in KEY position — right after the `{` or a `,` at that level — is
// a property name, not a data read, so `{ height: 480 }` stays as written and
// only the values are scoped. A shorthand property is expanded
// (`{ count }` → `{ count: __d.count }`), because the bare name would read an
// undeclared binding at runtime. Quoted, computed and spread members need no
// special case: strings are copied, and a computed key or a spread operand is
// an ordinary expression.
func resolveExprScanFull(expr string, scope, trackedScope scopeMap, facts *exprFacts, nested, guard bool, unguardable *bool) (string, bool) {
	var b strings.Builder
	referencesTrackedScope := false
	n := len(expr)
	i := 0
	lastNonSpace := byte(0)
	// callDepth counts the open parens that FOLLOW a value-ending token, i.e.
	// call argument lists rather than grouping parens. A whole-value read of a
	// loop local inside one is `fmt(todo)` — the row then depends on more than
	// the item's identity (the D170 emission contract's `deep`).
	callDepth := 0
	var parens []bool
	// prevEndsExpr tracks whether the previous significant token can END an
	// expression (identifier/number/string/template close, ')', ']', '}'). It
	// disambiguates '/': division after such a token, else a regex literal.
	prevEndsExpr := false
	// brackets is the open-bracket stack with the member-chain state each one
	// interrupted. keyPos is set right after an object literal's `{` or one of
	// its `,` separators: the next identifier there is a property name.
	var brackets []chainFrame
	keyPos := false
	// safeSteps is how many following member steps of the current chain need no
	// guard: 1 after `this`, a global or a literal; -1 (all of them) through a
	// `new` callee; 0 otherwise. afterNew marks the `new` keyword itself, whose
	// operand root opens an unguarded callee.
	safeSteps := 0
	afterNew := false
	topIs := func(open byte) bool {
		return len(brackets) > 0 && brackets[len(brackets)-1].open == open
	}
	for i < n {
		c := expr[i]
		// Everything except whitespace and comments is a token that ends key
		// position and the `new` keyword's reach; atKey remembers whether THIS
		// token sits in an object literal's key position.
		atKey := false
		isSpace := c == ' ' || c == '\t' || c == '\n' || c == '\r'
		isComment := c == '/' && i+1 < n && (expr[i+1] == '/' || expr[i+1] == '*')
		if !isSpace && !isComment {
			atKey = keyPos && topIs('{')
			keyPos = false
			if !isIdentStart(c) {
				afterNew = false
			}
		}
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
			safeSteps = 1
			i = j
		case c == '`':
			if prevEndsExpr {
				// A tagged template: `a.b` + template is a call the optional form
				// cannot express (`a?.b`x`` is a syntax error).
				*unguardable = true
			}
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
					resolved, referencesScope := resolveExprScanFull(inner, scope, trackedScope, facts, true, guard, unguardable)
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
			safeSteps = 1
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
				safeSteps = 1
				i = j
			default:
				// Division operator ('/' or '/=').
				if i+1 < n && expr[i+1] == '=' {
					b.WriteString("/=")
					*unguardable = true
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
			if atKey && !isProp {
				// An object literal's property name (D173 V8). `name:` is a key and
				// stays bare; `name,` / `name}` is a shorthand property, expanded so
				// the value half resolves like any other read.
				k := skipExprSpace(expr, j)
				if k < n && expr[k] == ':' {
					b.WriteString(name)
					lastNonSpace = name[len(name)-1]
					prevEndsExpr = true
					i = j
					continue
				}
				if k >= n || expr[k] == ',' || expr[k] == '}' {
					b.WriteString(name)
					b.WriteString(": ")
				}
			}
			if !isProp {
				if _, tracked := trackedScope[name]; tracked {
					referencesTrackedScope = true
				}
			}
			newCallee := afterNew && !isProp
			afterNew = false
			local, inScope := scopeRef(scope, name)
			switch {
			case isProp:
				b.WriteString(name)
			case inScope:
				// A lexical binding SHADOWS a keyword-ish global, which used to be
				// invisible because both spellings emitted the bare name. It is
				// visible now that a binding can carry a rewrite: a
				// `{#for document in documents}` row must read `s.item`, not the
				// window's document.
				if facts != nil {
					noteLocalRead(facts, name, expr, j, callDepth, !nested && spansExpr(expr, i, j))
				}
				b.WriteString(local)
				safeSteps = 0
				if name == "ViewNode" {
					// The compiler's own import (the `.map` fallback's synthetic
					// `ViewNode.keyOf(item)` key) is never nullish.
					safeSteps = 1
				}
			case jsKeywords[name]:
				if facts != nil && name == "this" {
					facts.usesThis = true
				}
				b.WriteString(name)
				safeSteps = 0
				if name == "this" {
					safeSteps = 1
				}
				if name == "new" {
					afterNew = true
				}
			case jsGlobals[name]:
				if facts != nil && volatileGlobalRead(name, expr, j) {
					facts.volatileRead = true
				}
				b.WriteString(name)
				safeSteps = 1
			default:
				if facts != nil {
					facts.addRoot(name)
				}
				b.WriteString("__d.")
				b.WriteString(name)
				safeSteps = 0
			}
			if newCallee {
				safeSteps = -1
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
			safeSteps = 1
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
			// the slash as a regex opener. An update target cannot be an optional
			// chain, so the guard stands down for this expression.
			b.WriteString(expr[i : i+2])
			lastNonSpace = c
			*unguardable = true
			i += 2
		case c == '.' && guard && prevEndsExpr:
			// A member step (D173 V4). An optional step reads undefined through a
			// missing object instead of throwing; `safeSteps` exempts the steps
			// that can never be nullish or may not be optional.
			if safeSteps != 0 {
				if safeSteps > 0 {
					safeSteps--
				}
				b.WriteByte('.')
			} else {
				b.WriteString("?.")
			}
			lastNonSpace = '.'
			prevEndsExpr = false
			i++
		case c == '[' && guard && prevEndsExpr:
			// A computed member step: `a[i]` → `a?.[i]`, under the same exemptions
			// as a dot step. The index expression inside is its own chain.
			if safeSteps != 0 {
				if safeSteps > 0 {
					safeSteps--
				}
				b.WriteByte('[')
			} else {
				b.WriteString("?.[")
			}
			brackets = append(brackets, chainFrame{open: '[', safeSteps: safeSteps})
			safeSteps = 0
			lastNonSpace = '['
			prevEndsExpr = false
			i++
		default:
			b.WriteByte(c)
			switch c {
			case '(':
				// A '(' after a value-ending token opens a CALL argument list;
				// after an operator it is a grouping paren. The stack keeps the
				// two apart across nesting.
				parens = append(parens, prevEndsExpr)
				if prevEndsExpr {
					callDepth++
				}
				brackets = append(brackets, chainFrame{open: '(', safeSteps: safeSteps})
				safeSteps = 0
			case ')':
				if len(parens) > 0 {
					if parens[len(parens)-1] {
						callDepth--
					}
					parens = parens[:len(parens)-1]
				}
				if topIs('(') {
					brackets = brackets[:len(brackets)-1]
				}
				// A call's result (or a parenthesized value) may be nullish, and a
				// `new` callee ends at its argument list: the next step is guarded.
				safeSteps = 0
			case '[':
				// An array literal (a computed member step took the case above).
				brackets = append(brackets, chainFrame{open: '[', safeSteps: safeSteps})
				safeSteps = 0
			case ']':
				// Closing a computed member step restores the chain it interrupted
				// (an array literal restores the state before it, which the next
				// root overwrites anyway).
				if topIs('[') {
					safeSteps = brackets[len(brackets)-1].safeSteps
					brackets = brackets[:len(brackets)-1]
				} else {
					safeSteps = 0
				}
			case '{':
				// Inside an expression a brace opens an object literal (a template
				// literal's `${` is consumed by the backtick case), so the next
				// identifier is in key position.
				brackets = append(brackets, chainFrame{open: '{', safeSteps: safeSteps})
				safeSteps = 0
				keyPos = true
			case '}':
				if topIs('{') {
					brackets = brackets[:len(brackets)-1]
				}
				safeSteps = 0
			case ',':
				keyPos = topIs('{')
			case '=':
				// An assignment (`=`, `+=`, `??=`, …) — not `==`/`===`/`!=`/`<=`/
				// `>=`/`=>` — has a target the optional form cannot express.
				prev := byte(0)
				if i > 0 {
					prev = expr[i-1]
				}
				next := byte(0)
				if i+1 < n {
					next = expr[i+1]
				}
				// A shift assignment (`<<=`, `>>=`, `>>>=`) ends in the same `<=`/`>=`
				// bytes a comparison does; the doubled angle bracket before it tells
				// them apart.
				shiftAssign := (prev == '<' || prev == '>') && i > 1 && expr[i-2] == prev
				if next != '=' && next != '>' && (shiftAssign || (prev != '=' && prev != '!' && prev != '<' && prev != '>')) {
					*unguardable = true
				}
			}
			if !isSpace {
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

// noteLocalRead classifies ONE read of an in-scope binding for exprFacts. src
// is the expression being scanned and at is the index just past the identifier,
// so the classification is a read-only peek at what follows: the main loop
// still tokenizes those bytes normally (a member name arrives as a property
// access and is skipped there).
//
//	todo.text        → field "text"
//	todo.author.name → deep (the record revision does not cover it)
//	todo.fullName()  → deep (a call, and a computed getter is indistinguishable)
//	todo[k]          → deep (dynamic member)
//	fmt(todo)        → the whole item into a call whose result is displayed
//	todo             → a whole-value read (component prop, handler argument):
//	                   neither a field nor deep — those re-read the live row
//
// `whole` reports that the identifier spans the ENTIRE expression being scanned.
// A whole-value read that does not (an operand, a template-literal
// interpolation, a call argument, a member access reached through parens or a
// comment) is OPAQUE: the compiler cannot see which members the value reaches,
// so the site must be conservative exactly as a relation read makes it.
func noteLocalRead(facts *exprFacts, name, src string, at, callDepth int, whole bool) {
	read := facts.local(name)
	read.renderRead = true
	k := skipExprSpace(src, at)
	// Optional chaining reads the same member the plain '.' does.
	if k < len(src) && src[k] == '?' && k+1 < len(src) && src[k+1] == '.' {
		k++
	}
	switch {
	case k < len(src) && src[k] == '[':
		read.deep = true
	case k < len(src) && src[k] == '(':
		// The binding itself is called.
		read.deep = true
	case k < len(src) && src[k] == '.' && !(k+2 < len(src) && src[k+1] == '.' && src[k+2] == '.'):
		m := skipExprSpace(src, k+1)
		if m >= len(src) || !isIdentStart(src[m]) {
			read.deep = true
			return
		}
		e := m
		for e < len(src) && isIdentChar(src[e]) {
			e++
		}
		after := skipExprSpace(src, e)
		if after < len(src) && (src[after] == '(' || src[after] == '[' ||
			(src[after] == '.' && !(after+2 < len(src) && src[after+1] == '.' && src[after+2] == '.')) ||
			(src[after] == '?' && after+1 < len(src) && src[after+1] == '.')) {
			read.deep = true
			return
		}
		read.addField(src[m:e])
	default:
		if callDepth > 0 {
			read.bareInCall = true
		}
		if whole {
			read.whole = true
		} else {
			read.opaque = true
		}
	}
}

// spansExpr reports whether src[start:end] is the whole expression apart from
// surrounding whitespace.
func spansExpr(src string, start, end int) bool {
	for i := 0; i < start; i++ {
		switch src[i] {
		case ' ', '\t', '\n', '\r':
		default:
			return false
		}
	}
	for i := end; i < len(src); i++ {
		switch src[i] {
		case ' ', '\t', '\n', '\r':
		default:
			return false
		}
	}
	return true
}

func skipExprSpace(s string, i int) int {
	for i < len(s) && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r') {
		i++
	}
	return i
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

// eventValue is a compiled @event value plus the two caching verdicts the
// emitter needs.
type eventValue struct {
	js string
	// cacheable marks a DATA-INDEPENDENT handler: the same function object on
	// every render, so it rides the per-instance `__h` cache (v1.29 D62 / SPEC
	// §31).
	cacheable bool
	// rowCacheable marks a handler that captures loop bindings and nothing
	// else: not `__h`-cacheable (its capture differs per row), but stable for
	// the LIFE of a row, so a persistent list block caches it on the row scope
	// (`s.h0 ??= …`, D170 stable loop handlers). The emitter still checks that every
	// captured binding belongs to a lowered loop before using it.
	rowCacheable bool
	// refs are the in-scope binding names the handler ARGUMENTS referenced,
	// minus the synthesized `event` parameter. The emitter uses them to confirm
	// every capture belongs to a lowered loop before caching on a row scope.
	refs []string
}

// compileEventValue compiles an @event value and reports its caching verdicts.
// It accepts the two SPEC §5 handler forms plus the D86 handler-valued
// conditional whose branches are each a handler form or null. A literal null
// emits no handler. facts, when non-nil, collects what the handler arguments
// read (the row's `roots` mask includes handler reads — D170 emission contract).
func compileEventValue(expr string, scope scopeMap, facts *exprFacts) (eventValue, error) {
	return compileEventValueMode(expr, scope, false, facts)
}

// compileEventValueMode is compileEventValue with the puzzle-check switch:
// bareAsReference emits a bare handler name as `this.events.name` rather than
// wrapping it in a call (see ResolveCheckEvent). Every runtime caller passes
// false, so the emitted render code is unchanged.
func compileEventValueMode(expr string, scope scopeMap, bareAsReference bool, facts *exprFacts) (eventValue, error) {
	expr = strings.TrimSpace(expr)
	eventParam := "event"
	if _, shadowed := scope["event"]; shadowed {
		// Preserve a loop item/counter named event: the DOM event parameter must
		// not shadow the outer .map((event) => …) binding.
		eventParam = "__ev"
	}
	if expr == "null" {
		return eventValue{js: "null"}, nil
	}
	if condition, truthy, falsy, ok := splitEventConditional(expr); ok {
		if condition == "" || truthy == "" || falsy == "" {
			return eventValue{}, fmt.Errorf("event handler must be a bare method name or a single call expression (got %q)", expr)
		}
		truthyJS, err := compileEventBranch(truthy, scope, eventParam, bareAsReference, facts)
		if err != nil {
			return eventValue{}, err
		}
		falsyJS, err := compileEventBranch(falsy, scope, eventParam, bareAsReference, facts)
		if err != nil {
			return eventValue{}, err
		}
		// The condition is evaluated during render and may toggle function ↔
		// null, so the conditional value itself must never be cached — by the
		// instance cache OR by a row scope.
		cond, _ := resolveExprScan(condition, scope, nil, facts)
		return eventValue{js: "(" + cond + ") ? " + truthyJS + " : " + falsyJS}, nil
	}
	return compileEventHandler(expr, scope, eventParam, bareAsReference, facts)
}

func compileEventBranch(expr string, scope scopeMap, eventParam string, bareAsReference bool, facts *exprFacts) (string, error) {
	if expr == "null" {
		return "null", nil
	}
	ev, err := compileEventHandler(expr, scope, eventParam, bareAsReference, facts)
	return ev.js, err
}

// compileEventHandler compiles one bare identifier or single call expression.
// The callee is qualified to this.events.* and call arguments are resolved with
// the DOM event in scope unless a loop binding named event already owns that
// name. Call forms are cacheable only when their arguments directly reference no
// loop-scope binding and contain no resolved render-data read; a form that
// references ONLY loop-scope bindings is row-cacheable instead.
func compileEventHandler(expr string, scope scopeMap, eventParam string, bareAsReference bool, facts *exprFacts) (eventValue, error) {
	if isJSIdentifier(expr) {
		if bareAsReference {
			return eventValue{js: "this.events." + expr, cacheable: true}, nil
		}
		return eventValue{js: "(" + eventParam + ") => this.events." + expr + "(" + eventParam + ")", cacheable: true}, nil
	}
	op := strings.IndexByte(expr, '(')
	if op < 0 {
		return eventValue{}, fmt.Errorf("event handler must be a bare method name or a single call expression (got %q)", expr)
	}
	callee := strings.TrimSpace(expr[:op])
	if !isJSIdentifier(callee) {
		return eventValue{}, fmt.Errorf("event handler callee must be a plain method name (got %q)", callee)
	}
	closeParen := matchBalanced(expr, op, '(', ')')
	if closeParen != len(expr)-1 {
		return eventValue{}, fmt.Errorf("event handler must be a single call expression (got %q)", expr)
	}
	argsRaw := strings.TrimSpace(expr[op+1 : closeParen])
	evScope := cloneScope(scope)
	_, eventIsBinding := evScope["event"]
	if !eventIsBinding {
		// Never overwrite a real binding named `event` (a {#for} item may own
		// the name): its rewrite value must survive.
		evScope["event"] = ""
	}
	argsJS := ""
	referencesLoopScope := false
	// The argument scan runs into its OWN facts so the synthesized `event`
	// parameter can be dropped from the reference list before the caller sees
	// it; roots and item reads still reach the caller's facts.
	argFacts := &exprFacts{}
	if argsRaw != "" {
		argsJS, referencesLoopScope = resolveExprScan(argsRaw, evScope, scope, argFacts)
	}
	if !eventIsBinding {
		delete(argFacts.locals, "event")
	}
	// A `this.…` argument is evaluated at FIRE time inside the closure, against
	// an instance that outlives every render, so it cannot make a row volatile —
	// D62 already classifies such an argument as data-independent. A `__d.…`
	// argument is different: it is captured from the render's snapshot, so its
	// roots stay in the mask and keep the row rebuilding.
	argFacts.usesThis = false
	argFacts.volatileRead = false
	// Loop locals in an argument are read at fire time off the LIVE row scope
	// too, so they neither count as opaque whole-value reads nor make a site
	// reading an enclosing row's local volatile — the same carve-out as `this`.
	for _, read := range argFacts.locals {
		read.opaque = false
		read.whole = false
		read.renderRead = false
	}
	facts.merge(argFacts)
	refs := make([]string, 0, len(argFacts.locals))
	for name := range argFacts.locals {
		refs = append(refs, name)
	}
	dataFree := !strings.Contains(argsJS, "__d.")
	return eventValue{
		js:           "(" + eventParam + ") => this.events." + callee + "(" + argsJS + ")",
		cacheable:    !referencesLoopScope && dataFree,
		rowCacheable: referencesLoopScope && dataFree,
		refs:         refs,
	}, nil
}

func cloneScope(scope scopeMap) scopeMap {
	out := make(scopeMap, len(scope)+1)
	for k, v := range scope {
		out[k] = v
	}
	return out
}
