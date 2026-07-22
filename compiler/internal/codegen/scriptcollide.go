package codegen

import "github.com/magic-spells/puzzle/compiler/internal/parser"

// scriptcollide.go — the <scripts>-import collision WARNING (v0.1 hardening).
//
// A template expression can only read data() fields: resolveExpr rewrites every
// non-scope, non-global, non-keyword identifier ROOT to `__d.<name>` (expr.go).
// So a name that is actually an IMPORT in <scripts> — `{ count > MAX }` with MAX
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
//     matched (the Go compiler still never truly parses the opaque <scripts>).

// jsTok is one lexical token of the opaque <scripts> body for the import scan:
// an identifier run, a single punctuation byte, or an opaque unit (string,
// template literal, comment, or regex literal — content irrelevant here).
type jsTok struct {
	ident  string // non-empty for an identifier token
	ch     byte   // non-zero for a punctuation token
	opaque bool   // a skipped string / comment / regex literal
}

// tokenizeJS lexes s into jsToks, skipping whitespace and treating strings,
// comments, and regex literals as single opaque tokens via parser.LexSkip (the
// same regex-vs-division disambiguation the balanced scanners use).
func tokenizeJS(s string) []jsTok {
	var toks []jsTok
	prevEndsExpr := false
	for i := 0; i < len(s); {
		c := s[i]
		if next, pee, consumed := parser.LexSkip(s, i, prevEndsExpr); consumed {
			if isIdentStart(c) {
				toks = append(toks, jsTok{ident: s[i:next]})
			} else {
				toks = append(toks, jsTok{opaque: true})
			}
			prevEndsExpr = pee
			i = next
			continue
		}
		if !isASCIISpace(c) {
			toks = append(toks, jsTok{ch: c})
		}
		prevEndsExpr = parser.LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return toks
}

// scriptImportBindings returns the set of LOCAL identifiers bound by top-level
// `import` statements in the opaque <scripts> body. It covers default, named
// (honoring `as` renames — the local name is bound, not the imported name),
// and namespace (`* as ns`) forms; bare side-effect imports bind nothing.
// Dynamic `import(...)` and `import.meta` are not binding forms and are skipped.
func scriptImportBindings(scripts string) map[string]bool {
	set := map[string]bool{}
	if scripts == "" {
		return set
	}
	toks := tokenizeJS(scripts)
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
			i = collectImportClause(toks, i+1, set)
			continue
		}
		i++
	}
	return set
}

// collectImportClause reads an import statement's binding clause starting at
// toks[j] (the token after `import`), adds every local binding to set, and
// returns the index just past the statement. It fully consumes the clause's
// braces, so the caller's depth counter stays balanced.
func collectImportClause(toks []jsTok, j int, set map[string]bool) int {
	if j >= len(toks) {
		return j
	}
	// Dynamic import(...) or import.meta — not a binding form.
	if toks[j].ch == '(' || toks[j].ch == '.' {
		return j
	}
	for j < len(toks) {
		t := toks[j]
		if t.opaque {
			// A string here is a bare `import 'x'` specifier: no bindings. Consume it
			// and an optional trailing ';'.
			j++
			if j < len(toks) && toks[j].ch == ';' {
				j++
			}
			return j
		}
		if t.ident != "" {
			switch t.ident {
			case "from":
				j++ // 'from'
				if j < len(toks) && toks[j].opaque {
					j++ // module specifier string
				}
				if j < len(toks) && toks[j].ch == ';' {
					j++
				}
				return j
			case "as":
				// `X as local` / `* as ns` — the LOCAL binding is the next ident.
				j++
				if j < len(toks) && toks[j].ident != "" {
					set[toks[j].ident] = true
					j++
				}
				continue
			default:
				// A binding name — UNLESS the next token is `as` (then the local name
				// is the one after `as`, added by the case above; the pre-`as` name is
				// the exported name, not a local binding).
				if j+1 < len(toks) && toks[j+1].ident == "as" {
					j++
					continue
				}
				set[t.ident] = true
				j++
				continue
			}
		}
		// Punctuation inside the clause ('{', '}', ',', '*'): skip.
		j++
	}
	return j
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
