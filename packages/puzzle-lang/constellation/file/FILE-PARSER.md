---
name: template parser entry
status: verified
path: parser/parser.go
language: go
summary: >-
  Recursive-descent template parser and grammar validation: every expression position handed to
  expr.Parse through exprs.go, the {#for}/{#case}/{:when} header shapes, {#unless} as a negated
  condition, HTML void elements closed at their start tag, binding-name checks, and D167
  component-name validation.
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: verified
    text: >-
      0.8.0 release-prep sweep. Each bound file was diffed against the b1a8642a baseline. scan.go is
      byte-identical, since only the path moved into puzzle-lang. sections.go changed only its
      textutil import path and one comment. parser.go gained the D173 V1 chain rule (parseChain,
      isFormatterName, the {#for}/{:when} pipe bans) and the D167 name check. slot.go gained D166
      snippet markers and the D173 V13 per-path pass. The bodies now say so. The test count is 12
      files. `go vet` and `go test ./...` pass in packages/puzzle-lang.
    sha: a602784a9822fa3ff63123e597f72624b3c9ffff
---

Source binding for the template parser. Behavioral intent stays on the owning component card, COMPONENT-TEMPLATE-PARSER in the connected `puzzle` plan (`repo=puzzle`); this card anchors that contract to `packages/puzzle-lang/parser/parser.go` (the Puzzle language module, D172; `path` is relative to this plan root, `packages/puzzle-lang`).

Where the 0.8.0 rules live in this file:

- **Every expression position is one `expr.Parse`** (DECISION-D176-EXPRESSION-LANGUAGE, D173 V1), called through `parseExprAt` in `exprs.go` with the enclosing bindings in scope: interpolations (`parseInterpolationExpr`), brace-only attribute values and `@event` values (`buildAttr`; handler options for the latter), the `{#if}`/`{:else if}`/`{#unless}`/`{#case}` headers (`parseBlock`), `{:when}` value lists (`parseWhenValues`/`splitWhenValues`, which split on top-level commas only), and the `{#for}` header (`parseForHeader`, `splitForHeader`, `peelForCounter`, `splitForIn`), which splits `item in collection, i` or `a...b, x` and hands each piece to `expr`. The file holds no chain or pipe code: a `|` reaches `expr.Parse`, which rejects it with the pipe steer.
- **`{#unless c}`** stores `!` over the parsed condition, so `{#unless}` has one tree shape.
- **A second `{:else}`** in `{#if}`, `{#unless}` or `{#case}` is reported by `parseBlock` at the stray clause ("a second {:else} in {#if} opened at L:C — {:else} must be the last clause"), beside the existing `{:else if}`- and `{:when}`-after-`{:else}` checks, instead of surfacing as "unclosed {#if}".
- **HTML void elements** (`voidElements`: `area base br col embed hr img input link meta source track wbr`, matched exactly and lowercase) close at their start tag: `parseElement` marks a void start tag self-closing, so `<br>`, `<br/>` and `<br />` build the same AST and what follows a `<br>` belongs to the parent. `checkCloser` reports a void closing tag (`</input>`, a stray `</br>`) at the closer: "<input> is a void element and has no closing tag — remove the </input>". The rule holds inside `{#raw}`, where HTML stays structural; a capitalized tag (`<Input>`) is a component and never void.
- **Binding names** — a `{#for}` item or counter, a `<Snippet>` parameter, a generated binding — are checked by `loopBindingIdentError`, `snippetParamIdentError` and `generatedBindingIdentError` against `expr`'s one binding-name rule; `{#for i in 1...5}` steers to `{#for 1...5, i}`.
- **Capitalized tag names** are validated as `Ident('.'Ident)*` (`checkComponentName`, `isIdentSegment`; D167).

Two sibling files in `parser/` have no FILE card of their own, and their contracts live on COMPONENT-TEMPLATE-PARSER: `depth.go` (`OverNestingDepth`, D164 — a token-level nesting scan for the playground; it skips void start tags and stray void closers, so for a well-formed template it counts exactly the AST's containers: one per non-self-closing, non-void tag, block opener or `{:else if}` clause) and `inlinesvg.go` (`ScanSVGFile`, D46 — it skips a leading UTF-8 byte-order mark before the prolog scan, with error positions kept in file coordinates). TEST-COMPILER-PARSER covers both.

Design-doc references in this module's comments are repo-relative (`packages/puzzle/constellation/doc/DOC-COMPILER-DESIGN.md`), because the doc lives in the framework plan, not here.
