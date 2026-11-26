---
name: D134 — capitalized composition markers
status: verified
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D71-SLOT-FORWARDING
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - FILE-CODEGEN
  - FILE-VIEW-MANAGER
  - DECISION-D199-UPGRADE-PASS
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# D134 — capitalized composition markers

Capitalization means "the framework resolves this tag": components come from
your imports, markers from the grammar. Each composition role gets its own
token, because one word carrying several roles confused authors and degrades
LLM template generation.

| Spelling | Role |
|---|---|
| `<Children/>` | the **default marker** — untagged call-site content renders here |
| `<Outlet/>` | the **router outlet** in a layout or view — the routed page renders here (D30) |
| `<Slot name="x"/>` | a **named slot** — call-site children tagged `slot="x"` render here |
| `slot="x"` (call site) | routes a direct child to a named slot (D53) |

`<Snippet>` ([[DECISION-D166-SNIPPETS]]), `<Portal>` ([[DECISION-D144-PORTAL]])
and `<Component>` ([[DECISION-D180-COMPONENT-SLOT]]) are the other reserved
tags. A paired marker body is fallback content
([[DECISION-D141-MARKER-FALLBACK-BODIES]]); valued attributes on
`<Children>`/`<Slot name>` hand data to a caller's `<Snippet>` (D166).

## Decision

- **`<Children/>` is the default marker.** `ref` and event handlers are errors (a
  marker is a render target); bare attributes steer to `<Snippet>` parameters.
- **One tag per role.** `<Children/>` is what the caller writes, `<Outlet/>` is
  what the router puts, `<Slot name="x"/>` is a named position the caller fills.
  `<Slot>` always takes a static, non-empty `name`; `"default"` and `"children"`
  are reserved and steer to `<Children/>`. A `<Slot>` with no name is a
  positioned error naming all three tags (the 0.10 upgrade path is
  [[DECISION-D199-UPGRADE-PASS]]).
- **`<Outlet/>` and `<Children/>` are one mechanism with two names.** Both fill
  the template's default position and compile to the same node, so the rename
  changes no emitted code. `<Outlet>` takes no attributes (`name` and `ref` get
  their own messages) and may be paired with a fallback body. The directory
  convention (D20: `app/layouts/**` and `app/views/**` are routed) tells the
  compiler which file kind it has, so an `<Outlet/>` in a component compiles
  with a warning steering to `<Children/>` rather than an error.
- **Uniqueness is per render path** (D173 V13): one default marker (`<Children/>`
  and `<Outlet/>` share the bucket) and one `<Slot name="x">` per name; exclusive
  `{#if}`/`{#case}` branches are separate paths, and a marker in a `{#for}` body
  is one site. Checked per template and per skeleton body.
- **Forwarding** (D71): `<Card><Children/></Card>` (or `<Card><Outlet/></Card>` in a
  layout) hands the enclosing template's default content through Card. A named slot inside a component invocation is a
  compile error; the router fills only the default bucket.
- **Lowercase spellings are positioned steering errors**: `<children>` →
  `<Children/>`, `<slot name>` → `<Slot name="…"/>`, bare `<slot>` names `<Children/>`
  and `<Outlet/>`, `<outlet>` → `<Outlet/>`, `<portal>` → `<Portal>`, `<snippet fits…>` → `<Snippet>`. None of
  this applies inside `{#raw}`, where every tag is a literal element.
- **`Children`, `Outlet`, `Slot`, `Snippet`, `Portal` are reserved tag names**,
  matched exactly before component resolution; as a dotted family root they are
  an error ([[DECISION-D167-COMPONENT-FAMILIES]]), and `Outlet.pzl`, like
  `Component.pzl`, is a reserved filename.
- Validation lives in `packages/puzzle-lang/parser` (`parser.go` marker branch,
  `slot.go`). External mirrors track the grammar: puzzle-eslint, puzzle-prettier
  and the three editor grammars.

## Alternatives rejected

- **A bare `<Slot/>` as the router outlet** — one word then meant three things
  (the router's page, the caller's content, a named position), and a reader
  had to know which kind of file they were in to tell which. `<Outlet/>` says
  what fills it.
- **Keeping a bare `<Slot/>` as a warning-only alias of `<Outlet/>`** — a
  deprecated spelling that still compiles keeps appearing in generated and
  copied code; the error names the replacement and `puzzle check --fix` makes
  the change.
- **An error for `<Outlet/>` in a component** — it still works there (same
  mechanism), and a component that a layout forwards into is a legitimate
  edge; a warning teaches the convention without breaking the build.
- **Lowercase spellings as aliases** — two spellings per role recreate the
  confusion.
- **`<slot name="children">` for the default** — verbose, and keeps every role on
  one word.
