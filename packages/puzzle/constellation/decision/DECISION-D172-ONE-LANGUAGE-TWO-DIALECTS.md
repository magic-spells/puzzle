---
name: >-
  D172 — Puzzle is one template language with two dialects (PuzzleKit and Sites), marketed as
  "Puzzle"
status: built
connections:
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - COMPONENT-TEMPLATE-PARSER
  - DECISION-D162-MONOREPO-PACKAGES
  - DECISION-D32-CLI-TOOLING
  - DOC-RELEASE-SURFACE
  - DECISION-D166-SNIPPETS
notes:
  - kind: state
    text: >-
      puzzle-lang v0.8.1 (Go-only) builds the dialect switches as `parser.Options` (puzzle-lang
      plan: FILE-PARSER-HOST, FILE-PARSER-LET): `Let` turns on {#let};
      `SkipIslandCheck`/`SkipSlotCheck`/`SkipRefCheck` turn off PuzzleKit's post-parse rules;
      `ParseMarkup` parses wrapper-less markup at a file position, and the splitter scanners are
      exported so Sites keeps only its `<schema>` lifting and migration tools. Every switch is OFF
      in the zero value, which is PuzzleKit's grammar. Deviation from this card: with {#let} off the
      error stays the old generic "unknown block {#let} (expected …)" rather than "{#let} is a Sites
      feature …", because PuzzleKit output must not change in a patch; the friendlier message is a
      later, deliberate change.
---

# D172 — One language, two dialects, one public name

## Context

The `.pzl` grammar has two hosts. PuzzleKit (this package) compiles it to
`PuzzleView` render functions in JavaScript. Magic Spells Sites (separate repo)
renders `.pzl` theme files server-side in Go at request time, with no
JavaScript engine, using a vendored, pinned copy of the parser.

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
  post-parse rule. Sites reserves `head-content` (placed inside `<head>`) and
  `header-group`, `footer-group`, `panel-group`; a Sites layout must contain
  each of those plus the plain `<Slot/>` exactly once, and rejects any other
  layout slot name. No platform marker tags: platform-filled placeholders are
  slots.
- **Snippets** ([[DECISION-D166-SNIPPETS]]), same semantics in every host.
- **The expression language** ([[DECISION-D176-EXPRESSION-LANGUAGE]]): one
  closed JavaScript-shaped grammar parsed by the shared `expr` package — paths,
  `.length`, literals, arithmetic, comparison, `&&`/`||`/`??`, ternary, arrow
  arguments, and calls to library functions, table methods and global
  namespaces. No pipes, `new`, `typeof`, regex or bitwise operators.
  Semantics per construct: [[DECISION-D173-CORE-SEMANTICS]].

**The dialects** add to or restrict the core:

| | PuzzleKit | Sites |
|---|---|---|
| File structure | `<puzzle-view>`/`<puzzle-skeleton>` wrapper + `<script>` class (layouts too) | No wrapper; directory decides the kind; top-level `<schema>` |
| Adds | `@event` + modifiers, `<Portal>`, `ref`/`key`/`flip`/`island`, implicit binding | `{#let}`, implicit props |
| Expressions | The core; an `@event` handler is the one door into the view's JS; `this` is not a template identifier | The core |
| Naming a computed value | a `data()` field | `{#let}` |
| Restricts | — | `@event`, `<Portal>` rejected; dotted tags rejected for now (D173 V16) |

**Architecture: one parser that knows every construct, with per-dialect
switches** (`parse(file, PuzzleKitDialect)` / `parse(file, SitesDialect)`). Core
constructs are always on; an extension switched off is a positioned error
naming where it belongs ("`{#let}` is a Sites feature; in Puzzle apps, name
values in the script"). A new construct is built once and enabled per dialect.
Tooling reads every `.pzl` file and picks the dialect per project
(`puzzle.config.js` vs Sites' `theme.json`).

**Dialects differ only by addition or restriction, never by redefinition.**
A construct may move from a dialect into the core (as `<Snippet>` did), never
back. A standard library function behaves the same in both hosts
([[DECISION-D174-STANDARD-FORMATTERS]]); anything else is host-specific and
named so. Same spelling, different behavior per host → new spelling instead.

**Public naming follows the Svelte pattern.** Everything markets **"Puzzle"**:
one name, one install (`npm install -g @magic-spells/puzzle`, `puzzle init`).
**PuzzleKit** is the docs' name for the app layer (router, store, adapters,
static output, CLI) where a page must tell it apart from the language. Never
"PuzzleJS"/"Puzzle.js"; puzzlejs.dev is only the address. The package and CLI
keep their names, `@magic-spells/puzzle` and `puzzle`.

## Alternatives

- **"Puzzle" and "PuzzleKit" as separately marketed products** — users would
  ask which to install, and it's always the same package.
- **Rename the package/CLI to `puzzlekit`** — breaks installs for no gain.
- **One identical language in both hosts** — Sites cannot run JS; PuzzleKit
  has no need for `{#let}`.
- **Sites as a grammar fork** — the editor grammars, lint/format plugins and
  one parser serve both; a fork drifts.
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
  The compiler uses it via a `go.mod` `replace`; outside consumers need a
  `packages/puzzle-lang/vX.Y.Z` tag, which Cory creates. Its FILE cards live in
  the puzzle-lang plan.
- **Dialect switches are not built yet**: the parser carries no Sites syntax.
  Next: move `{#let}` and `<schema>` lifting in behind the Sites switch, so
  Sites drops its vendored patches and imports a tagged module.
- **Sites has not adopted the core yet**: the D176 evaluator in Go, D173's
  semantics ("Sites, pending" on D173), `<Snippet>` (rejected with an error
  saying it is planned), and the layout-slot rule above. Parity is proven
  through the shared conformance tables in `puzzle-lang/conformance`
  (`expressions-parse.json`, `functions.json`); template-level fixtures
  (`.pzl` → AST/errors per dialect) are the planned extension.
- **Grammar changes are cross-host**: a core-construct change lands in
  `packages/puzzle-lang/parser`, the JS ports in puzzle-eslint /
  puzzle-prettier, the three editor grammars, and Sites' next parser sync.
  Dialect-aware tooling must exist before third-party Sites theme authors;
  it does not block the Puzzle launch.
- **Docs**: puzzlejs.dev documents the core plus the PuzzleKit dialect; Sites
  is not mentioned until public, then documented as "Puzzle, with these
  additions".
- **Intended end state (Cory, not scheduled)**: publish the core as a
  standalone language — core spec (with the add-or-restrict rule), the public
  Go module, a JS parser package consolidating the eslint/prettier ports, and
  the conformance fixtures. Do it when an outside user asks or Sites needs the
  public module.
