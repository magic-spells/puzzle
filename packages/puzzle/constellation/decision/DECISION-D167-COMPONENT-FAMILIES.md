---
name: 'D167 — component families: dotted component tags + the family barrel convention (v1.80)'
status: verified
connections:
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - DOC-PUZZLE-FILE
  - FILE-CODEGEN
  - DECISION-D176-EXPRESSION-LANGUAGE
notes:
  - kind: deviation
    text: >-
      Built as specified (PR #104) with three refinements found during the build and review: (1)
      family stubs use a composition-shaped template (`<div class={ classes }>` with `<Children/>`
      and a caller `class` override) rather than the stock closed `<button>` component stub —
      nesting `<Frame.Wrapper/>` inside `<Frame>` would otherwise silently drop every member; plain
      `generate component` output is byte-identical to before. (2) Family member names validate as
      PascalCase, stricter than the grammar's `[A-Za-z_][A-Za-z0-9_]*` segment rule — a member
      becomes a class name and a filename, and `generate component wrapper` was already rejected.
      (3) The reserved-marker guard also landed on plain `generate component` (pre-existing gap:
      `generate component Slot` scaffolded a component unreachable from templates); views stay
      exempt, being routed by class. Also: the printed import hint follows `--path` — a family dir
      under `app/` prints the `@` alias form, anything else the project-relative path.
  - kind: state
    text: >-
      Editor grammar sweep done (2026-08-31), stacked as `feat/0.7.0-grammar` on each repo's pending
      `feat/0.6.0-grammar` branch: puzzle-vscode PR #2 (component open/close regexes accept
      `(?:\.Ident)*`; the marker lookahead also had to exclude `.` so `<Slot.Custom>` reads as a
      component), puzzle-sublime PR #2 (`puzzle_component_name` accepts dotted segments; HTML's
      `tag_name_break` already stops markers at a `.`), puzzle-zed PR #2 (no grammar change —
      `tag_name` already accepts dots — corpus test + highlight comment only). Sublime syntax tests
      can only run inside Sublime Text; the others ran green. None of the grammars flag invalid
      dotted names (`<Frame.>`, `<Frame-x>`) — the framework's positioned errors are the backstop.
  - kind: verified
    text: >-
      Re-checked for the 0.8.0 release against compiler/internal/codegen/codegen.go. A component tag
      still reaches emitElement as n.Name, verbatim with isComponent=true. The D173 V4 `?.` guarding
      applies only to value expressions, never to the tag, so `<Frame.Wrapper>` still emits `new
      ViewNode(Frame.Wrapper, …)`, and the component_family golden pins it. The name validation now
      lives in packages/puzzle-lang/parser/parser.go (D172 move), with unchanged behavior. The
      card's claims hold.
    sha: a602784a9822fa3ff63123e597f72624b3c9ffff
verified_at: '2026-09-25T10:41:55.889Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
---

# D167 — component families: dotted component tags + the family barrel convention (v1.80)

Related components import as one unit and invoke with dot notation:

```js
import Frame from '@/components/Frame';
```

```html
<Frame>
  <Frame.Wrapper>
    <Frame.Content>…</Frame.Content>
  </Frame.Wrapper>
</Frame>
```

Two halves: the **grammar** makes dotted component tags official (validated,
tested), and the **convention** groups a family in a directory with a plain JS
barrel. `.pzl` stays strictly one class per file.

## Context

Compound-component ergonomics (`<Tabs.List>`, Radix-style) are standard in
React, and both Vue (`<script setup>` "namespaced components") and Svelte
officially support dot-notation component tags backed by namespace imports —
neither supports multi-component SFC files. Puzzle's codegen already emitted a
component tag's text verbatim as a JS expression, so `<Frame.Wrapper>`
*accidentally* compiled to `new ViewNode(Frame.Wrapper, …)` — but nothing
validated component names at all: a component tag spelled `Frame-x` or
`Frame.` compiled cleanly into syntactically broken JS. Meanwhile a Frame/
Wrapper/Content family cost three import lines.

## Decision

- **A component tag is any tag that cannot be an HTML element.** A tag is a
  component when its first character is anything other than an ASCII
  lowercase letter `a`–`z`, the only characters that can begin an HTML element
  name. `<Card>`, `<Übersicht>`, `<概要>`, `<Frame.Übersicht>`, `<ärmel>` and
  `<_foo>` are components; `<straße-karte>` is a custom element.
- **Tag names follow JavaScript's identifier rules past ASCII.** A tag name
  starts with `A`–`Z`, `a`–`z`, `_` or a non-ASCII `ID_Start` letter, and
  continues with the ASCII name characters (letters, digits, `_`, `-`, `:`)
  or `ID_Continue` runes, plus the `.` family separator — the
  `jsident.IsIDStart`/`IsIDContinue` rule the expression language and the
  compiler's `<script>` scan share (D176), so a component tag takes any name
  its `<script>` can import. `$` is never part of a tag name, so `<$50` stays
  text. In text, a `<` directly followed by a letter of any script opens a
  tag, so `値<上限` is the same "unexpected character" error `a<b` always was;
  a `<` followed by a space is text.
- **Dotted component tags are official grammar.** A component tag's name
  must be a valid member path: `Ident('.'Ident)*`, each segment a `$`-free
  JavaScript identifier. Any other component name (`-`, `:`, an empty
  segment, a trailing dot, a segment that starts with a digit such as
  `<Frame.٣x>`) is a positioned compile error — closing the broken-JS emission
  hole. Lowercase tags (HTML elements, custom elements with dashes,
  namespaced SVG) are untouched.
- **Attribute and prop names may be non-ASCII** on any tag:
  `<Card größe={ 3 }>` passes the prop the child reads as `props.größe`.
- **Reserved roots stay reserved.** A dotted name whose first segment is
  `Children`, `Slot`, `Snippet`, or `Portal` is a positioned error steering
  away from the marker names (extends D134's "capitalization means the
  framework resolves it": markers are exact-match, and a marker name cannot
  be a component root).
- **Codegen is unchanged.** The tag text is emitted verbatim as the ViewNode
  tag expression; `Frame.Wrapper` resolves lexically against module scope at
  runtime, exactly like a plain `Frame`. No registry, no import inspection.
- **The family convention is a directory + plain JS barrel** — convention
  over mechanism, documented not enforced:
  `app/components/Frame/{Frame,Wrapper,Content}.pzl` + `index.js` with
  `export default Object.assign(Frame, { Wrapper, Content })` plus named
  exports, so both `import Frame` and `import { Frame, Wrapper }` work.
- **`puzzle generate component Frame --family Wrapper,Content`** scaffolds
  the directory, one `.pzl` per member, and the barrel. Member names are
  validated as identifiers. Without `--family`, `generate component` is
  unchanged.

## Alternatives

- **Native multi-component `.pzl` files** — rejected to keep the format
  simple: multiple templates per file need class-association syntax,
  multi-class extraction, per-class mode decisions, and a grammar change
  sweeping eslint/prettier/editor grammars. Vue and Svelte both declined the
  same feature; snippets (D166) already cover in-file sub-pieces.
- **Compiler auto-barrel** (synthesize a virtual namespace module for a
  directory of `.pzl` files) — rejected: implicit root selection and
  filename→property rules, collides with Node directory resolution the
  moment a real `index.js` appears, invisible to TS, and breaks the "imports
  are real JS that esbuild resolves with zero framework opinions" property.
- **Capitalization as the component test, with ASCII segments** (a component
  tag starts with `A`–`Z`, each segment `[A-Za-z_][A-Za-z0-9_]*`) — rejected:
  a `<script>` class may carry any JavaScript identifier name (`Übersicht`,
  `概要`, `Straßenkarte`), and an ASCII-only tag lexer read
  `<Straßenkarte ort={ titel } />` as `<Stra>` with an attribute `ßenkarte`
  (a ReferenceError at render) and `<Übersicht />` as text. Only `a`–`z` can
  begin an HTML element name, so every other first character names a
  component without ambiguity.

## Consequences


- Parser gains component-name validation (component branch of parseElement);
  goldens pin the member-expression emission; error tests pin the rejects.
- A leading `_` names a component (`<_foo>`), since `_` cannot begin an HTML
  element name; no corpus file spells an element that way.
- `puzzle-eslint` / `puzzle-prettier` need no change — neither lexes template
  tags or classifies components (the section splitter treats a template body
  as opaque, and prettier passes it through). The editor grammar repos
  (vscode/sublime/zed) must accept dotted component tags and a component start
  that is any identifier letter other than `a`–`z`; their ASCII `[A-Z]`
  component class predates the Unicode rule.
- `puzzle check` (D165) must type the member-expression tag like any emitted
  expression — verified as part of the build.
- Docs sweep: SPEC template section, DOC-TEMPLATE-SYNTAX, PUZZLE_FILE, the
  agent skill, README.
