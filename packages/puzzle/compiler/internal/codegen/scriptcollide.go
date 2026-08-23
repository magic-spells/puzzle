package codegen

import (
	"fmt"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/jsident"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// scriptcollide.go — the <script>-import collision WARNING (v0.1 hardening).
//
// A template expression can only read data() fields: resolveExpr rewrites every
// non-scope, non-global, non-keyword identifier ROOT to `__d.<name>` (expr.go).
// So a name that is actually an IMPORT in <script> — `{ count > MAX }` with MAX
// imported — silently becomes `__d.MAX` → undefined at render, with no
// diagnostic. This pass detects that collision and emits a Warning (out-of-band:
// the generated JS is untouched, so goldens never move).
//
// Deliberately conservative — false negatives are fine, false positives are not:
//   - the collision set is IMPORT bindings only (named / default / namespace).
//     Top-level const/let/var/function/class names were considered and OMITTED: a
//     module-level helper whose name coincides with a real data() field would
//     produce a spurious warning (the template correctly reads the field). Imports
//     are far less likely to shadow a data field, so they are the strong signal.
//   - both scans are string/comment/regex-aware via the shared parser.LexSkip
//     scanner, so an identifier inside a string literal or comment is never
//     matched (the Go compiler still never truly parses the opaque <script>).

// jsTok is one lexical token of the opaque <script> body for the import scan:
// an identifier run, a single punctuation byte, or an opaque unit (string,
// template literal, comment, or regex literal — content irrelevant here).
type jsTok struct {
	ident  string // non-empty for an identifier token
	ch     byte   // non-zero for a punctuation token
	opaque bool   // a skipped string / comment / regex literal
	// comment narrows opaque to the two comment forms. The binding scans treat
	// every opaque unit alike, but the class-name scan does not: a comment is
	// whitespace to the grammar (`export default /* x */ class Foo {}` is a real
	// declaration) while a string or regex breaks keyword adjacency.
	comment bool
	off     int // byte offset of the token's first byte in the scanned body
}

// tokenizeJS lexes s into jsToks, skipping whitespace and treating strings,
// comments, and regex literals as single opaque tokens via parser.LexSkip (the
// same regex-vs-division disambiguation the balanced scanners use).
//
// It runs ONCE per compile, over the <script> body, and the stream feeds all
// three consumers that used to scan those bytes independently: the import-
// collision warning, the reserved-binding check, and the class-name extraction
// (classname.go). Sharing it also means the regex/division state is carried
// cumulatively from the start of the body for every consumer, rather than each
// restarting from a fresh prevEndsExpr partway through.
func tokenizeJS(s string) []jsTok {
	var toks []jsTok
	prevEndsExpr := false
	for i := 0; i < len(s); {
		c := s[i]
		if next, pee, consumed := parser.LexSkip(s, i, prevEndsExpr); consumed {
			if isIdentStart(c) {
				toks = append(toks, jsTok{ident: s[i:next], off: i})
			} else {
				toks = append(toks, jsTok{opaque: true, comment: isCommentStart(s, i), off: i})
			}
			prevEndsExpr = pee
			i = next
			continue
		}
		if !isASCIISpace(c) {
			toks = append(toks, jsTok{ch: c, off: i})
		}
		prevEndsExpr = parser.LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return toks
}

// scriptImportBindings returns the set of LOCAL identifiers bound by top-level
// `import` statements in the opaque <script> body. It covers default, named
// (honoring `as` renames — the local name is bound, not the imported name),
// and namespace (`* as ns`) forms; bare side-effect imports bind nothing.
// Dynamic `import(...)` and `import.meta` are not binding forms and are skipped.
func scriptImportBindings(toks []jsTok) map[string]bool {
	set := map[string]bool{}
	depth := 0 // only `import` at (){}[] depth 0 is a top-level statement
	for i := 0; i < len(toks); {
		t := toks[i]
		if t.ch != 0 {
			switch t.ch {
			case '(', '[', '{':
				depth++
			case ')', ']', '}':
				if depth > 0 {
					depth--
				}
			}
			i++
			continue
		}
		if depth == 0 && t.ident == "import" {
			i = collectImportClause(toks, i+1, func(name string, _ int) { set[name] = true })
			continue
		}
		i++
	}
	return set
}

// collectImportClause reads an import statement's binding clause starting at
// toks[j] (the token after `import`), reports every local binding (name plus the
// byte offset of its identifier) to bind, and returns the index just past the
// statement. It fully consumes the clause's braces, so the caller's depth
// counter stays balanced.
func collectImportClause(toks []jsTok, j int, bind func(name string, off int)) int {
	// Comments are import-grammar whitespace, including between the `import`
	// keyword and a TS `type` modifier.
	for j < len(toks) && toks[j].comment {
		j++
	}
	if j >= len(toks) {
		return j
	}
	// Dynamic import(...) or import.meta — not a binding form.
	if toks[j].ch == '(' || toks[j].ch == '.' {
		return j
	}
	// `import type ...` is type-only when `type` is followed by a named,
	// namespace, or default binding. esbuild erases the whole clause before the
	// compiler's injected import lands, so none of those identifiers collide.
	// The one value-space exception is `import type from 'x'`: that imports the
	// default export into a binding literally named `type`.
	if toks[j].ident == "type" {
		if k, ok := nextNonCommentToken(toks, j+1); !ok ||
			toks[k].ch == '{' || toks[k].ch == '*' ||
			(toks[k].ident != "" && toks[k].ident != "from") {
			return consumeTypeOnlyImportClause(toks, j+1)
		}
	}

	inNamedClause := false
	for j < len(toks) {
		t := toks[j]
		if t.opaque {
			if t.comment {
				j++
				continue
			}
			// A string here is a bare `import 'x'` specifier: no bindings. Consume it
			// and an optional trailing ';'.
			j++
			if j < len(toks) && toks[j].ch == ';' {
				j++
			}
			return j
		}
		if t.ch != 0 {
			switch t.ch {
			case '{':
				inNamedClause = true
			case '}':
				inNamedClause = false
			}
			j++
			continue
		}
		if t.ident != "" {
			switch t.ident {
			case "from":
				j++ // 'from'
				if k, ok := nextNonCommentToken(toks, j); ok && toks[k].opaque && !toks[k].comment {
					j = k + 1 // module specifier string
				}
				if j < len(toks) && toks[j].ch == ';' {
					j++
				}
				return j
			case "as":
				// `X as local` / `* as ns` — the LOCAL binding is the next ident.
				j++
				if k, ok := nextNonCommentToken(toks, j); ok && toks[k].ident != "" {
					bind(toks[k].ident, toks[k].off)
					j = k + 1
				}
				continue
			default:
				// TS 4.5 inline modifiers: `type X` and `type X as Y` are
				// erased and introduce no value binding. `{ type }` still imports a
				// binding named `type`, while `{ type as Y }` is a normal rename.
				if inNamedClause && t.ident == "type" && inlineTypeOnlySpecifier(toks, j+1) {
					j = skipNamedImportSpecifier(toks, j+1)
					continue
				}
				// A binding name — UNLESS the next token is `as` (then the local name
				// is the one after `as`, added by the case above; the pre-`as` name is
				// the exported name, not a local binding).
				if k, ok := nextNonCommentToken(toks, j+1); ok && toks[k].ident == "as" {
					j = k
					continue
				}
				bind(t.ident, t.off)
				j++
				continue
			}
		}
	}
	return j
}

// nextNonCommentToken returns the next token that participates in import
// grammar. Comments are whitespace; other opaque units are module specifiers.
func nextNonCommentToken(toks []jsTok, j int) (int, bool) {
	for j < len(toks) && toks[j].comment {
		j++
	}
	return j, j < len(toks)
}

// consumeTypeOnlyImportClause consumes through the module specifier without
// reporting bindings. Stopping at the specifier (rather than requiring a
// semicolon) preserves automatic-semicolon-insertion behavior for the caller.
func consumeTypeOnlyImportClause(toks []jsTok, j int) int {
	for j < len(toks) {
		if toks[j].opaque && !toks[j].comment {
			j++
			if j < len(toks) && toks[j].ch == ';' {
				j++
			}
			return j
		}
		if toks[j].ch == ';' {
			return j + 1
		}
		j++
	}
	return j
}

// inlineTypeOnlySpecifier reports whether `type` starts a TS inline type-only
// specifier. Only `type` followed by `,`, `}`, or `as` is a value import; every
// other shape is conservatively type-only because a false value binding would
// reject otherwise-legal TypeScript.
func inlineTypeOnlySpecifier(toks []jsTok, j int) bool {
	k, ok := nextNonCommentToken(toks, j)
	if !ok {
		return true
	}
	return toks[k].ch != ',' && toks[k].ch != '}' && toks[k].ident != "as"
}

func skipNamedImportSpecifier(toks []jsTok, j int) int {
	for j < len(toks) && toks[j].ch != ',' && toks[j].ch != '}' {
		j++
	}
	return j
}

// scriptTopLevelBindings returns every MODULE-SCOPE binding in the opaque
// <script> body — import locals (via the same clause reader the warning scan
// uses) plus the names declared by a top-level const/let/var/function/class —
// mapped to the byte offset of the binding identifier. Only brace/paren-depth-0
// declarations count: a helper declared inside a function body merely shadows.
//
// This set feeds an EXACT-name check (checkReservedScriptBindings), not the
// heuristic warning above, so the tradeoff is inverted from that scan's: a miss
// falls through to esbuild's duplicate-binding error (today's behavior), while a
// false hit would reject legal code. Deliberately skipped, therefore:
//   - destructuring patterns (`const { ViewNode } = x`), which bind nothing here;
//   - the second and later declarators of a list (`const a = 1, __s = 2`);
//   - `function`/`class` whose preceding token shows an EXPRESSION position — a
//     named class expression (`const A = class ViewNode {}`) binds its name
//     inside the expression only.
func scriptTopLevelBindings(toks []jsTok) map[string]int {
	set := map[string]int{}
	bind := func(name string, off int) {
		if _, dup := set[name]; !dup {
			set[name] = off
		}
	}
	depth := 0
	// prev is the previous SIGNIFICANT token; strings, comments, and regex
	// literals are transparent so a comment above a declaration does not hide the
	// statement boundary. Start of file is a boundary.
	prev := jsTok{ch: ';'}
	for i := 0; i < len(toks); {
		t := toks[i]
		switch {
		case t.ch != 0:
			switch t.ch {
			case '(', '[', '{':
				depth++
			case ')', ']', '}':
				if depth > 0 {
					depth--
				}
			}
		case t.opaque:
			i++
			continue
		case depth == 0 && prev.ch != '.':
			switch t.ident {
			case "import":
				prev = jsTok{ch: ';'} // the statement ends at the clause
				i = collectImportClause(toks, i+1, bind)
				continue
			case "const", "let", "var":
				// `declare const X` (TS) is type-only: erased by the loader, so it
				// binds nothing in the emitted module. `declare function`/`declare
				// class` are covered by startsDeclaration, which rejects `declare`.
				if prev.ident != "declare" {
					bindDeclaredName(toks, i+1, bind)
				}
			case "function", "class":
				if startsDeclaration(prev) {
					bindDeclaredName(toks, i+1, bind)
				}
			}
		}
		prev = t
		i++
	}
	return set
}

// bindDeclaredName binds the declared identifier at toks[j], skipping a
// generator `*`. A non-identifier (or a reserved word, e.g. the `extends` of an
// anonymous default class) is one of the forms this scan skips.
func bindDeclaredName(toks []jsTok, j int, bind func(name string, off int)) {
	if j < len(toks) && toks[j].ch == '*' {
		j++
	}
	if j < len(toks) && toks[j].ident != "" && !jsident.IsReservedBindingIdentifier(toks[j].ident) {
		bind(toks[j].ident, toks[j].off)
	}
}

// startsDeclaration reports whether prev — the previous significant token — puts
// a following `function`/`class` in STATEMENT position, i.e. makes it a
// declaration that binds at module scope rather than an expression.
func startsDeclaration(prev jsTok) bool {
	if prev.ch != 0 {
		return prev.ch == ';' || prev.ch == '}'
	}
	return prev.ident == "export" || prev.ident == "default" || prev.ident == "async"
}

// checkReservedScriptBindings fails the compile when the <script> binds, at
// module scope, one of the names codegen appends its own declaration for
// (emitted: the local names of the injected import line, in emission order). The
// injected import lands AFTER the verbatim script, so such a binding is a
// duplicate declaration — one esbuild reports against a line that appears in no
// .pzl, at a skewed position. Catching it here keeps the diagnostic in the
// user's source. Renaming was rejected: the script's bytes are the user's.
//
// The set is per-file and exact: `__s` is legal in a module that never coerces a
// value for display, and the function-scope helpers (`__d`, `__f`) never collide
// because they are shadowed inside the render body, not redeclared.
func checkReservedScriptBindings(scripts string, toks []jsTok, emitted []string, file string, scriptsPos parser.Position) error {
	bindings := scriptTopLevelBindings(toks)
	if len(bindings) == 0 {
		return nil
	}
	for _, name := range emitted {
		off, hit := bindings[name]
		if !hit {
			continue
		}
		pos := scriptsPos.Advance(scripts[:off])
		what, why := reservedBindingImport(name)
		return &parser.ParseError{
			File: file, Line: pos.Line, Col: pos.Col,
			Message: fmt.Sprintf(
				"<script> binds %q at module scope, a name reserved by the compiler: it imports %s after the <script> (%s), so the two declarations collide — rename the <script> binding",
				name, what, why),
		}
	}
	return nil
}

// reservedBindingImport names what the compiler imports as `name` and why THIS
// file imports it, so the error explains a reservation the .pzl cannot see.
func reservedBindingImport(name string) (what, why string) {
	switch name {
	case "ViewNode":
		return "ViewNode", "every compiled module builds its render tree with it"
	case "SLOT_TAG":
		return "SLOT_TAG", "this template contains a slot"
	case "PORTAL_TAG":
		return "PORTAL_TAG", "this template contains a <Portal>"
	case "__s":
		return "the display helper as __s", "this template coerces an interpolation for display"
	default:
		return name, "the shared module for a {#svg} asset in this template"
	}
}

// importLocalName returns the local binding a named-import specifier introduces
// ("displayValue as __s" → "__s").
func importLocalName(spec string) string {
	if i := strings.LastIndex(spec, " as "); i >= 0 {
		return spec[i+len(" as "):]
	}
	return spec
}

// collectDataCollisions scans an emitted render expression for `__d.<name>`
// member reads whose <name> is in imports, appending each name (once, via seen)
// to *out. The scan skips strings/comments/regex through parser.LexSkip, so a
// literal "__d.x" inside a user string never registers a false positive.
func collectDataCollisions(emitted string, imports, seen map[string]bool, out *[]string) {
	if len(imports) == 0 {
		return
	}
	s := emitted
	prevEndsExpr := false
	for i := 0; i < len(s); {
		c := s[i]
		if next, pee, consumed := parser.LexSkip(s, i, prevEndsExpr); consumed {
			// The `__d` identifier run followed immediately by ".<name>" is a data
			// member read emitted by resolveExpr (LexSkip stops the run at the '.').
			if isIdentStart(c) && s[i:next] == "__d" && next < len(s) && s[next] == '.' {
				k := next + 1
				start := k
				for k < len(s) && isIdentChar(s[k]) {
					k++
				}
				if k > start {
					if name := s[start:k]; imports[name] && !seen[name] {
						seen[name] = true
						*out = append(*out, name)
					}
				}
			}
			prevEndsExpr = pee
			i = next
			continue
		}
		prevEndsExpr = parser.LexPlainEndsExpr(s[i], prevEndsExpr)
		i++
	}
}
