---
name: 'D167 — component families: dotted component tags + the family barrel convention'
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
verified_at: '2026-09-25T10:41:55.889Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
---

# D167 — component families: dotted component tags + the family barrel convention

Related components import as one unit and invoke with dot notation:

```html
<!-- import Frame from '@/components/Frame'; -->
<Frame>
  <Frame.Wrapper><Frame.Content>…</Frame.Content></Frame.Wrapper>
</Frame>
```

The **grammar** makes dotted component tags official and validated; the
**convention** groups a family in a directory with a plain JS barrel. `.pzl`
stays one class per file.

## Context

Compound components (`<Tabs.List>`) are standard in React, and Vue and Svelte
both support dot-notation tags backed by namespace imports — neither supports
multi-component files. Codegen emits a component tag's text verbatim as a JS
expression, so without validation a tag like `<Frame-x>` or `<Frame.>`
compiled into broken JS.

## Decision

- **A component tag is any tag whose first character is not ASCII `a`–`z`**
  (the only characters that begin an HTML element name). `<Card>`,
  `<Übersicht>`, `<概要>`, `<_foo>` are components; `<straße-karte>` is a custom
  element.
- **Tag names follow JavaScript identifier rules past ASCII**: start with
  `A`–`Z`, `a`–`z`, `_` or a non-ASCII `ID_Start` letter, continue with ASCII
  name characters (letters, digits, `_`, `-`, `:`) or `ID_Continue` runes, plus
  the `.` separator — the shared `jsident` rule (D176), so a tag takes any name
  its `<script>` can import. `$` never belongs to a tag name (`<$50` is text).
  In text, `<` followed by a letter of any script opens a tag; `<` + space is
  text.
- **A component name must be `Ident('.'Ident)*`**, each segment a `$`-free JS
  identifier. Anything else (`-`, `:`, empty segment, trailing dot, digit-led
  segment) is a positioned compile error. Lowercase tags (HTML, custom
  elements, namespaced SVG) are untouched.
- **Attribute and prop names may be non-ASCII**: `<Card größe={ 3 }>` →
  `props.größe`.
- **Marker names cannot be a family root**: `Children.X`, `Slot.X`,
  `Snippet.X`, `Portal.X`, `Component.X` are errors ([[DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS]]);
  built-ins match exactly, never dotted. `Component` is the runtime selection built-in (D180), and a user component/tag import with that name needs a rename.
- **Codegen is unchanged**: `<Frame.Wrapper>` emits
  `new ViewNode(Frame.Wrapper, …)`, resolved lexically like `Frame`. No
  registry, no import inspection. The `component_family` golden pins it.
- **Family convention (documented, not enforced)**:
  `app/components/Frame/{Frame,Wrapper,Content}.pzl` + `index.js` with
  `export default Object.assign(Frame, { Wrapper, Content })` plus named
  exports, so `import Frame` and `import { Frame, Wrapper }` both work.
- **`puzzle generate component Frame --family Wrapper,Content`** scaffolds the
  directory, one `.pzl` per member and the barrel. Root and member names must
  be PascalCase and not a marker name (the marker guard applies to plain
  `generate component` too; views are exempt). Family stubs use a
  composition-shaped template (`<div class={ classes }>` + `<Children/>` + a
  caller `class` override) so nesting members doesn't drop content. The
  printed import hint follows `--path` (`@` alias under `app/`, else the
  project-relative path).

## Alternatives

- **Multi-component `.pzl` files** — needs class-association syntax,
  multi-class extraction and a grammar sweep; Vue and Svelte declined it too,
  and snippets (D166) cover in-file sub-pieces.
- **Compiler auto-barrel for a directory** — implicit root selection, collides
  with a real `index.js`, invisible to TS, breaks "imports are plain JS
  esbuild resolves".
- **Capitalization as the component test with ASCII segments** — a `<script>`
  class may carry any JS identifier; an ASCII lexer read `<Straßenkarte …/>` as
  `<Stra>` + attribute `ßenkarte`.

## Consequences

- Validation lives in `packages/puzzle-lang/parser/parser.go`
  (`checkComponentName`); error tests pin the rejects.
- puzzle-eslint / puzzle-prettier need nothing (template bodies are opaque to
  them). The editor grammars must accept dotted tags and non-`a`–`z` component
  starts; they do not flag invalid dotted names — the compiler's positioned
  errors are the backstop.
- `puzzle check` (D165) types the member-expression tag like any emitted
  expression.
