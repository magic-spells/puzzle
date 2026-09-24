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
  - kind: gotcha
    text: >-
      One existing construct already breaks the never-redefine rule: a formatter pipe inside an
      UNQUOTED attribute value. In Sites, `title={ price | money }` runs the `money` formatter
      (Sites lifts it into SitesFormattedAttr). In PuzzleKit the whole brace body is pasted as
      JavaScript, so the same source compiles to a bitwise OR, `__d.price | __d.money` (verified
      with pzlc on 2026-09-23). Text interpolation `{ price | money }` and quoted `title="{ price |
      money }"` agree in both dialects. Proposed resolution: make the pipe-as-formatter reading
      core, so PuzzleKit splits a top-level `|` in an unquoted attribute into a formatter chain the
      way Sites does (`||` stays logical OR). That is technically breaking for a bitwise OR in an
      attribute expression, which is almost certainly a bug wherever it appears today. Needs its own
      decision when scheduled.
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

**The core** is everything that means the same thing in every host:

- HTML markup, text, and the text/escape rules (including `\{`/`\}`).
- `{ expr | formatter(args) }` interpolation, in text AND in attribute values
  (quoted and unquoted), plus the formatter call syntax.
- `{#if}`/`{:else}`, `{#for}`, `{#case}`, `{#raw}`, `{#svg}`.
- Components: capitalized tags, dotted family tags, props.
- `<Children/>` and `<Slot name="…">` with fallback bodies. Both dialects use
  them. The meaning is shared ("an outlet filled from outside this file"); each
  host decides what fills it (PuzzleKit: caller content or the route's view;
  Sites: the page template, section stack or a section group).
- **The core expression language** is the portable subset Sites defines:
  paths, literals, arithmetic, comparison, `&&`/`||`/`??`, ternary.

**The dialects** add to the core, or restrict it:

| | PuzzleKit | Sites |
|---|---|---|
| File structure | `<puzzle-view>`/`<puzzle-layout>`/`<puzzle-skeleton>` wrapper + `<script>` class | No wrapper; the directory decides the kind; top-level `<schema>` |
| Adds | `@event` + modifiers, `<Portal>`, `<Snippet>`, `ref`/`key`/`flip`/`island`, implicit binding | `{#let}`, `<SitesHead/>`, implicit props |
| Expressions | Full JavaScript (a superset of the core) | The core subset only |

**Architecture: one parser that knows every construct, with per-dialect
switches.** The shared lexer/parser has every construct from both dialects
built in. Core constructs are always on. Extension constructs are built in but
off unless the dialect a host passes turns them on
(`parse(file, PuzzleKitDialect)` / `parse(file, SitesDialect)`). An extension
that is switched off is a positioned error that names where it belongs ("`{#let}`
is a Sites feature; in Puzzle apps, name values in the script"). All syntax
lives in one place, so a new construct is built once and enabled per dialect,
never copied or patched in. The editor grammars and lint/format plugins
understand every `.pzl` file and only need to know which dialect a project
uses, which they can read from the project (`puzzle.config.js` vs Sites'
`theme.json`).

**The rule that keeps two dialects maintainable: they differ only by addition
or restriction, never by redefinition.** A dialect may switch a construct on
or leave it off; it never gives shared syntax a different meaning. **Formatters
follow the same rule:** a standard set with the same name behaves the same in
both hosts (implemented twice, in JS and in Go); anything else is
host-specific and named so. A proposal that would need the same spelling to
behave differently per host gets a new spelling instead.

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
- **A small core parser plus extension hooks that each host plugs its syntax
  into** (how Sites wires in `{#let}` today, through a one-line patch to its
  vendored copy). Rejected for now: with two dialects, both first-party, hooks
  add machinery, leave the tooling unable to read another dialect's files, and
  give worse errors ("unknown block" instead of "that's a Sites feature").
  Hooks come back only if a third party builds its own dialect, and they can
  be layered on top of the switches without undoing them.

## Consequences


- **The parser accepts every construct and each host switches on its own.**
  Sites' post-parse rejection of `@event`/`<Portal>`/`<Snippet>` becomes the
  dialect switch being off.
- **Follow-up: move Sites' syntax into the shared parser behind the Sites
  switch:** `{#let}`, `<schema>` lifting, `<SitesHead/>`, and the unquoted
  attribute formatter pipe (which becomes core, see the gotcha note). Sites
  then drops its `sitesPatches` entry and the syntax files in its vendored
  copy, keeping only its evaluator and renderer. Later, once the parser is a
  public Go module, Sites stops vendoring altogether.
- **Follow-up: dialect-aware tooling becomes dialect selection.** The three
  editor grammars and the eslint/prettier plugins learn the Sites constructs
  once (one grammar) and pick the dialect per project. They must do this before
  third-party theme authors write for Sites. It does not block the Puzzle
  launch.
- **Docs structure:** the puzzlejs.dev language section documents the core plus
  the PuzzleKit dialect. Sites is not mentioned until it is public; its docs
  then describe "Puzzle, with these additions".
- **Grammar changes are now cross-host.** A change to a core construct lands
  in this parser, the JS ports in `../puzzle-eslint` / `../puzzle-prettier`,
  the three editor grammars, **and** Sites' next parser sync. Shared
  conformance fixtures (`.pzl` → AST/errors per dialect, run by every
  implementation) are the planned way to keep them in agreement.
- No code moves and nothing is renamed in this repo yet; the monorepo layout of
  D162 stands.
