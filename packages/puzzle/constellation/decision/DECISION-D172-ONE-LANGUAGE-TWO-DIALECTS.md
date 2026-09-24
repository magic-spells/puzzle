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
notes:
  - kind: decision
    text: >-
      2026-09-23 (Cory) — publishing the core as a standalone language is the intended end state,
      for people who want to use Puzzle outside PuzzleKit and Sites. It is four artifacts: the core
      language spec (with the add-or-restrict, never-redefine rule for dialects); the parser as a
      public Go module; a JS parser package (e.g. `@magic-spells/puzzle-parser`, consolidating the
      splitter/lexer ports now vendored in `../puzzle-eslint` and `../puzzle-prettier`); and the
      shared conformance fixtures. The host-block extension hook is what lets a third party build
      its own dialect. Not scheduled: do it when an outside user asks or when Sites needs the public
      Go module, whichever comes first. The follow-ups in Consequences are the path there.
---

# D172 — One language, two dialects, one public name

## Context

The `.pzl` template grammar now has two hosts. PuzzleKit (the SPA framework in
this package) compiles it to `PuzzleView` render functions in JavaScript.
Magic Spells Sites (a separate repo, `magic-spells/sites`) renders `.pzl` theme
files server-side in Go at request time, using a vendored, pinned copy of
`compiler/internal/parser`. The two already differ, deliberately:

- **Sites adds:** `{#let}` template variables, top-level `<schema>`,
  `<SitesHead/>`, and implicit component props. A file's kind comes from its
  directory, so there is no `<puzzle-view>` wrapper.
- **Sites restricts:** expressions are a defined subset evaluated in Go (no
  calls; formatters are the only way to run code). `@event`, `<Portal>` and
  `<Snippet>` are compile errors.
- **PuzzleKit adds:** the script section (`data()`, `setData`, lifecycle),
  `@event` callbacks, and full JavaScript expressions. It has no template
  variables; the script section is where values get named.

## Decision


**Puzzle is one template language with two dialects**, the way Liquid has a
core that Shopify extends with its own tags and objects.

- **Puzzle (the core):** `{ expr | formatter }` interpolation and the
  formatter call syntax; `{#if}`/`{:else}`, `{#for}`, `{#case}`, `{#raw}`,
  `{#svg}`; capitalized component tags with props (including dotted family
  tags); `<Children/>` and named `<Slot>`s with fallback bodies; the text and
  escape rules. Both hosts accept every core construct.
- **The PuzzleKit dialect:** the core plus everything in this package's SPEC
  that assumes a browser runtime.
- **The Sites dialect:** the core plus the Sites additions above, minus the
  Sites restrictions. Sites owns and documents it.

**The rule that keeps two dialects maintainable: they differ only by addition
or restriction, never by redefinition.** A dialect can add a construct the
other doesn't have (`{#let}`, `<schema>`, the script section), or reject one
the other accepts (Sites rejects `@event`). It never gives shared syntax a
different meaning. A core construct parses the same way and means the same
thing in both, so one parser, one set of editor grammars and one formatter
serve both dialects, and only the host layers (PuzzleKit's codegen, Sites'
evaluator and renderer) differ. **Formatters follow the same rule:** a
standard set with the same name has the same behavior in both hosts
(implemented twice, in JS and in Go); anything else is host-specific and named
so. A proposal that would need the same spelling to behave differently per
host gets a new spelling instead.

**Public naming follows the Svelte pattern.** puzzlejs.dev, the README and the
package all market **"Puzzle"**: one name, one install
(`npm install -g @magic-spells/puzzle`, then `puzzle init`). **PuzzleKit** is
the docs' name for the app layer (router, data store, adapters, static output,
the CLI) where a page needs to tell it apart from the language. Sites says its
themes "are written in Puzzle". Always "Puzzle" in prose, never "PuzzleJS"
or "Puzzle.js"; puzzlejs.dev is only the address.

**The package and CLI keep their names:** `@magic-spells/puzzle` and `puzzle`.

## Alternatives

- **Separate products: "Puzzle" the language and "PuzzleKit" the framework,
  marketed side by side**. Rejected: every new user would first have to ask
  which one to install, and the answer would always be the same package. The
  split belongs in the docs, not in the headline.
- **Rename the package/CLI to `puzzlekit` before public launch**. Rejected:
  it breaks every existing install for no gain once the headline is "Puzzle".
- **One identical language in both hosts**. Rejected: Sites has no JavaScript
  engine (multi-tenant, server-side), so it cannot take full JS expressions.
  PuzzleKit has a script section, so it has no need for `{#let}`. Forcing
  either host into the other's constraints costs both.
- **Treat Sites as a fork of the grammar**. Rejected: the editor grammars, the
  lint/format plugins and one parser serve both, and a fork would drift.

## Consequences

- **The parser accepts the union of both dialects, and each host rejects the
  constructs it doesn't support** with a positioned error. Sites already works
  this way for `@event`/`<Portal>`/`<Snippet>`.
- **Follow-up: an official parser extension hook for host-defined blocks.**
  Sites currently patches one line of the vendored `parseBlock` (the
  unknown-block branch calls `sitesParseBlock`), and every sync depends on that
  patch applying exactly once. A supported hook there lets Sites drop the patch.
  Later, once the parser is a public Go module, Sites can drop the vendoring
  too.
- **Follow-up: dialect-aware tooling.** Both dialects use `.pzl`, so the three
  editor grammars and the eslint/prettier plugins will meet `{#let}`,
  `<schema>` and wrapper-less theme files. They must handle the Sites dialect
  before third-party theme authors write for Sites. This does not block the
  Puzzle launch.
- **Docs structure:** the puzzlejs.dev language section documents the core plus
  the PuzzleKit dialect. Sites is not mentioned until it is public; its docs
  then describe "Puzzle, with these additions".
- **Grammar changes are now cross-host.** A change to a core construct lands
  in this parser, the JS ports in `../puzzle-eslint` / `../puzzle-prettier`,
  the three editor grammars, **and** Sites' next parser sync. Shared
  conformance fixtures (`.pzl` → AST/errors, run by every implementation) are
  the planned way to keep them in agreement.
- No code moves and nothing is renamed in this repo; the monorepo layout of
  D162 stands.
