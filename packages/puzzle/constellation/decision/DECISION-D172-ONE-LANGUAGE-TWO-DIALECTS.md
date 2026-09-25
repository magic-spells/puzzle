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
  - kind: state
    text: >-
      The parser lives in `packages/puzzle-lang`, a separate Go module that `packages/puzzle/go.mod`
      requires through a `replace => ../puzzle-lang`. Its FILE cards bind to `../puzzle-lang/...`,
      outside this plan's code root, so stale_report cannot track them.
---

# D172 — One language, two dialects, one public name

## Context

The `.pzl` template grammar now has two hosts. PuzzleKit (the SPA framework in
this package) compiles it to `PuzzleView` render functions in JavaScript.
Magic Spells Sites (a separate repo, `magic-spells/sites`) renders `.pzl` theme
files server-side in Go at request time, using a vendored, pinned copy of the
parser (taken from `compiler/internal/parser`, which now lives in the
`packages/puzzle-lang` Go module). The two already differ, deliberately:

- **Sites adds:** `{#let}` template variables, top-level `<schema>`, and
  implicit component props. A file's kind comes from its directory, so there is
  no `<puzzle-view>` wrapper. (Its head-tags marker, `<SitesHead/>`, becomes a
  layout slot; see Decision.)
- **Sites restricts:** expressions are a defined subset evaluated in Go (no
  calls; formatters are the only way to run code). `@event` and `<Portal>` are
  compile errors. `<Snippet>` is a compile error today only because Sites has
  not implemented it yet; it is core (see Decision).
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
- **Slots: `<Children/>` and `<Slot>`/`<Slot name="…">` with fallback bodies.**
  A slot always means "a placeholder filled from outside this file"; the file's
  role decides who fills it. In a component, the caller does. In a layout, the
  host does, and **the plain `<Slot/>` in a layout is the page** in both
  dialects (PuzzleKit: the router's current view; Sites: the page template and
  its sections). A host may reserve named layout slots. Sites reserves
  `<Slot name="head-content"/>` (the platform's head tags, placed inside
  `<head>`; deliberately not Shopify's `content_for_header`, whose "header"
  reads as the visible site header) and `-group` names for the site's section
  groups: `<Slot name="header-group"/>`, `<Slot name="footer-group"/>`,
  `<Slot name="panel-group"/>`. **A Sites layout must contain every one of
  those slots, plus the plain `<Slot/>`, exactly once**, so every theme gives
  the platform the same places to render into and the customizer the same
  groups to edit; a missing one is a compile error naming it. A fallback body
  renders when the host has nothing for that slot, so
  `<Slot name="header-group">…a default header…</Slot>` works. Which layout
  slot names exist and which are required is a host rule checked after
  parsing. No marker tags such as `<SiteContent/>` are needed:
  platform-filled placeholders are slots.
- **Snippets: `<Snippet fits="…" params>`** ([[DECISION-D166-SNIPPETS]]), the
  per-item template a caller hands a component that owns a loop (a table cell,
  a list row, a carousel slide). Core because nothing about it needs a browser:
  a server renderer stamps the body per item with the caller's scope plus the
  parameters, which is the easy case. Same semantics in every host: `fits`,
  bare-attribute parameter declarations, the leaf rule, forwarding through a
  wrapper's `<Children/>`. PuzzleKit implements it today; Sites has not built
  it yet (planned), and until then rejects it with an error saying so.
- **The core expression language** is the portable subset Sites defines:
  paths, literals, arithmetic, comparison, `&&`/`||`/`??`, ternary.

**The dialects** add to the core, or restrict it:

| | PuzzleKit | Sites |
|---|---|---|
| File structure | `<puzzle-view>`/`<puzzle-skeleton>` wrapper + `<script>` class (layouts are `<puzzle-view>` files too) | No wrapper; the directory decides the kind; top-level `<schema>` |
| Adds | `@event` + modifiers, `<Portal>`, `ref`/`key`/`flip`/`island`, implicit binding | `{#let}`, implicit props |
| Expressions | Full JavaScript (a superset of the core) | The core subset only |
| Not yet built | — | `<Snippet>` (core; planned) |

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
or leave it off; it never gives shared syntax a different meaning. A construct
may move from a dialect into the core (an addition, as `<Snippet>` did), never
the other way. **Formatters follow the same rule:** a standard set with the
same name behaves the same in both hosts (implemented twice, in JS and in Go);
anything else is host-specific and named so. A proposal that would need the
same spelling to behave differently per host gets a new spelling instead.

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
- **Dedicated layout marker tags in Sites** (`<SitesHead/>` today; a planned
  `<SiteHead/>`/`<SiteContent/>`/`<HeaderGroup/>`/`<FooterGroup/>` set).
  Rejected: they are capitalized, so they read as components, yet they are
  placeholders the platform fills, which is what a slot already is. Named
  layout slots say the same thing with core syntax, match PuzzleKit's plain
  layout `<Slot/>`, get fallback bodies for free, and shrink the Sites dialect.
- **A data-style placeholder such as `{ site.content }`** (Shopify's
  `{{ content_for_layout }}`). Rejected: interpolation renders values from the
  render context; injecting rendered markup regions is what slots are for.

## Consequences

- **The parser accepts every construct and each host switches on its own.**
  Sites' post-parse rejection of `@event`/`<Portal>` becomes the dialect switch
  being off.
- **Done (0.8.0): the parser is its own Go module.** It lives in
  `packages/puzzle-lang` (module
  `github.com/magic-spells/puzzle/packages/puzzle-lang`, packages `parser`,
  `jsident`, `textutil`), outside any `internal/`, so another host can import
  it ([[DECISION-D162-MONOREPO-PACKAGES]] lists it). It moved unchanged: no
  dialect switches yet, and no Sites syntax. The compiler builds it from the
  working tree through a `go.mod` `replace`. Outside consumers need a
  `packages/puzzle-lang/vX.Y.Z` tag, created by hand next to `vX.Y.Z`. Sites
  still vendors its pinned copy until it switches to importing a tagged
  version.
- **Follow-up: move Sites' syntax into the shared parser behind the Sites
  switch:** `{#let}`, `<schema>` lifting, and the unquoted attribute formatter
  pipe (which becomes core, see the gotcha note). Sites then drops its
  `sitesPatches` entry and the syntax files in its vendored copy, keeping only
  its evaluator and renderer. Once a tagged `packages/puzzle-lang` release
  carries the switches, Sites imports it and stops vendoring altogether.
- **Follow-up in Sites: layout slots** (built as Sites PR #9,
  `feat/layout-slots`, 2026-09-24; not merged yet). `<SitesHead/>` becomes
  `<Slot name="head-content"/>`; the page body is the plain `<Slot/>`; section
  groups use `-group` slot names (`header-group`, `footer-group`,
  `panel-group`). Sites requires all five in every layout exactly once, keeps
  `head-content` inside `<head>`, rejects any other layout slot name, and
  refuses to publish or deploy a theme that fails the check.
- **Follow-up in Sites: `<Snippet>` support**, after the dialect switches land.
  Rewrite Sites' DECISION-TEMPLATE-GRAMMAR (which rejects it today), render a
  snippet body per item in the Go renderer with the caller's scope plus the
  declared parameters, and prove parity with PuzzleKit through the shared
  conformance fixtures.
- **Follow-up: dialect-aware tooling becomes dialect selection.** The three
  editor grammars and the eslint/prettier plugins learn the Sites constructs
  once (one grammar) and pick the dialect per project. They must do this before
  third-party theme authors write for Sites. It does not block the Puzzle
  launch.
- **Docs structure:** the puzzlejs.dev language section documents the core plus
  the PuzzleKit dialect. Sites is not mentioned until it is public; its docs
  then describe "Puzzle, with these additions".
- **Grammar changes are now cross-host.** A change to a core construct lands
  in this parser (`packages/puzzle-lang/parser`), the JS ports in
  `../puzzle-eslint` / `../puzzle-prettier`, the three editor grammars, **and**
  Sites' next parser sync. Shared conformance fixtures (`.pzl` → AST/errors per
  dialect, run by every implementation) are the planned way to keep them in
  agreement.
- Nothing is renamed: the package and CLI keep their names, and the rest of
  D162's monorepo layout stands.
