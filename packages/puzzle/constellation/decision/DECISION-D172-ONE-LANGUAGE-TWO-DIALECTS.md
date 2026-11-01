---
name: >-
  D172 — Puzzle is one template language with two dialects (PuzzleKit and Sites), marketed as
  "Puzzle"
status: built
connections:
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-LANGUAGE-CORE
  - COMPONENT-TEMPLATE-PARSER
  - DECISION-D162-MONOREPO-PACKAGES
  - DECISION-D32-CLI-TOOLING
  - DOC-RELEASE-SURFACE
  - DECISION-D166-SNIPPETS
---

# D172 — One language, two dialects, one public name

## Context

The `.pzl` grammar has two hosts. PuzzleKit (this package) compiles it to
`PuzzleView` render functions in JavaScript. Magic Spells Sites (separate repo)
renders `.pzl` theme files server-side in Go at request time, with no
JavaScript engine. Both import the same parser module.

## Decision

**Puzzle is one template language with two dialects**, the way Liquid has a
core that Shopify extends.

**The core** means the same in every host:

- HTML markup, text and escape rules (`\{`/`\}`), whitespace
  ([[DECISION-D168-TEXT-RUN-WHITESPACE]]).
- `{ expr }` interpolation in text and in quoted and unquoted attribute values;
  a display transform is a function call `{ name(expr, args) }`.
- `{#if}`/`{:else}`, `{#for}`, `{#case}`, `{#raw}`, `{#svg}`.
- Components: capitalized tags, dotted family tags, props.
- **Slots: `<Children/>`, `<Slot>`/`<Slot name="…">`, fallback bodies.** A slot
  is a placeholder filled from outside the file: in a component the caller
  fills it; in a layout the host does, and **the plain `<Slot/>` in a layout is
  the page** in both dialects. A host may reserve named layout slots as a
  post-parse rule: Sites requires `head-content` (inside `<head>`),
  `header-group`, `footer-group`, `panel-group` and the plain `<Slot/>`
  exactly once each in a layout, and rejects any other layout slot name. No
  platform marker tags: platform-filled placeholders are slots.
- **Snippets** ([[DECISION-D166-SNIPPETS]]) — core grammar. Sites switches
  them off: its validator rejects `<Snippet>` and marker arguments and steers
  to a component with props plus a named slot.
- **The expression language** ([[DECISION-D176-EXPRESSION-LANGUAGE]]): one
  closed JavaScript-shaped grammar parsed by the shared `expr` package — paths,
  `.length`, literals, arithmetic, comparison, `&&`/`||`/`??`, ternary, arrow
  arguments, and calls to library functions, table methods and global
  namespaces. Semantics per construct: [[DECISION-D173-CORE-SEMANTICS]].

**The dialects** add to or restrict the core:

| | PuzzleKit | Sites |
|---|---|---|
| File structure | `<puzzle-view>`/`<puzzle-skeleton>` wrapper + `<script>` class (layouts too) | No wrapper; directory decides the kind; top-level `<schema>` |
| Adds | `@event` + modifiers, `<Portal>`, `<Component>`, `ref`/`key`/`flip`/`island`, implicit binding | `{#let}`, `\|` pipes, implicit props, Sites-only functions |
| Expressions | The core; an `@event` handler is the one door into the view's JS; `this` is not a template identifier | The core plus pipes (sugar for calls); the method table and most globals are switched off — transforms are pipes into functions |
| Naming a computed value | a `data()` field | `{#let}` |
| Restricts | — | `@event`, `<Portal>`, `<Snippet>` and marker arguments rejected; `ref`/`island` dropped with a warning; dotted tags rejected for now (D173 V16) |

Sites keeps Liquid-style filter names (`upcase`, `join`, `default`, …) as pipe
functions; PuzzleKit removed them in favor of JavaScript methods and operators
([[DECISION-D174-FUNCTION-LIBRARY]]).

**Architecture: one parser that knows every construct, with per-dialect
switches** — `parser.Options` in `packages/puzzle-lang/parser/options.go`.
The zero value is PuzzleKit's grammar exactly (every extension off, every
check on), so the compiler passes nothing:

- `Let` turns on `{#let}`; `Pipes` turns on `|` pipes (`expr.Options.Pipes`).
- `SkipIslandCheck`, `SkipSlotCheck`, `SkipRefCheck` turn off PuzzleKit's
  post-parse rules for a host that applies its own (Sites' slot rules depend
  on the file kind).
- `MaxDepth` bounds nesting for `ParseMarkup`, so an untrusted file cannot
  exhaust the recursive parser's stack.
- `ParseMarkup` parses wrapper-less markup at a file position, and the
  splitter's scanners are exported (`parser/host.go`), so a host lifts its own
  top-level blocks (Sites: `<schema>`, `<script>`, `<style>`) and reads the
  file exactly as the parser will.

The parser always accepts core constructs; a host switches one off in its own
validator (Sites does for `<Snippet>`). An extension switched off in the
parser is a positioned error: `|` steers to the call form ("`| name` pipes are
Sites theme syntax — in a Puzzle app write `name(value)`"); `{#let}` with
`Let` off is the ordinary unknown-block error. A new construct is built once
and enabled per dialect.

**Dialects differ only by addition or restriction, never by redefinition.**
A construct may move from a dialect into the core (as `<Snippet>` did), never
back. A standard library function behaves the same in both hosts
([[DECISION-D174-FUNCTION-LIBRARY]]); anything else is host-specific and
named so. Same spelling, different behavior per host → new spelling instead.

**Public naming follows the Svelte pattern.** Everything markets **"Puzzle"**:
one name, one install (`npm install -g @magic-spells/puzzle`, `puzzle init`).
**PuzzleKit** is the docs' name for the app layer (router, store, adapters,
static output, CLI) where a page must tell it apart from the language. Never
"PuzzleJS"/"Puzzle.js"; puzzlejs.dev is only the address. The package and CLI
keep their names, `@magic-spells/puzzle` and `puzzle`.

## Alternatives rejected

- **"Puzzle" and "PuzzleKit" as separately marketed products** — users would
  ask which to install, and it's always the same package.
- **Rename the package/CLI to `puzzlekit`** — breaks installs for no gain.
- **One identical language in both hosts** — Sites cannot run JS; PuzzleKit
  has no need for `{#let}`.
- **Sites as a grammar fork, or a vendored patched parser** — the editor
  grammars, lint/format plugins and one parser serve both; a fork drifts.
- **Small core parser + host extension hooks** — more machinery, tooling can't
  read another dialect, worse errors. Hooks return only for a third-party
  dialect, layered on the switches.
- **Dedicated layout marker tags** (`<SitesHead/>`, `<SiteContent/>`, …) — they
  read as components but are placeholders, which is what a slot is.
- **Data-style placeholder `{ site.content }`** — interpolation renders
  values; injecting markup regions is what slots are for.

## Consequences

- **The parser is its own Go module**, `packages/puzzle-lang`
  (`github.com/magic-spells/puzzle/packages/puzzle-lang`: `parser`, `expr`,
  `conformance`, `jsident`, `textutil`; [[DECISION-D162-MONOREPO-PACKAGES]]).
  The compiler uses it via a `go.mod` `replace`; Sites requires it at a
  `packages/puzzle-lang/vX.Y.Z` tag, which Cory creates. A Sites-only change
  can ship as a puzzle-lang tag with no framework release. Its FILE cards live
  in the puzzle-lang plan.
- **Parity is proven by shared conformance tables** in
  `puzzle-lang/conformance` (`expressions-parse.json`, `functions.json`), which
  both hosts run at the same tag. Template-level fixtures (`.pzl` → AST/errors
  per dialect) are not built.
- **Grammar changes are cross-host**: a core-construct change lands in
  `packages/puzzle-lang/parser`, the JS ports in puzzle-eslint /
  puzzle-prettier, the three editor grammars, and Sites' next puzzle-lang
  bump.
- **Dialect-aware tooling is not built**: the plugins and editor grammars
  read every `.pzl` as PuzzleKit. Picking the dialect per project
  (`puzzle.config.js` vs Sites' `theme.json`) must exist before third-party
  Sites theme authors; it does not block the Puzzle launch.
- **Docs**: puzzlejs.dev documents the core plus the PuzzleKit dialect; Sites
  is not mentioned until public, then documented as "Puzzle, with these
  additions".
- **Intended end state (Cory, not scheduled)**: publish the core as a
  standalone language — core spec (with the add-or-restrict rule), the public
  Go module, a JS parser package consolidating the eslint/prettier ports, and
  the conformance fixtures. Do it when an outside user asks.
