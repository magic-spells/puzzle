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
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D134 — capitalized composition markers

| Spelling | Role |
|---|---|
| `<Children/>` | the **default marker** — untagged call-site content renders here |
| `<Slot/>` | the same unnamed marker; in a view/layout, the **router outlet** (D30) |
| `<Slot name="x"/>` | a **named slot** — call-site children tagged `slot="x"` render here |
| `slot="x"` (call site) | routes a direct child to a named slot (D53) |

`<Snippet>` ([[DECISION-D166-SNIPPETS]]) and `<Portal>` ([[DECISION-D144-PORTAL]])
are the other reserved markers. A paired marker body is fallback content
([[DECISION-D141-MARKER-FALLBACK-BODIES]]); valued attributes on
`<Children>`/`<Slot>` hand data to a caller's `<Snippet>` (D166).

## Context

Capitalization means "the framework resolves this tag": components from your
imports, markers from the grammar. The old lowercase `slot` carried three roles
(default marker, named slots, router outlet), which confused its own authors
and degrades LLM template generation; one token per meaning fixes both.

## Decision

- **`<Children/>` is the default marker.** `ref` and event handlers are
  errors (a marker is a render target); bare attributes steer to `<Snippet>`
  parameters.
- **`<Slot/>` splits by attribute, not spelling.** Bare: the default marker /
  router outlet. `name="x"`: a named slot — `name` is static and non-empty;
  `"default"` and `"children"` are reserved and steer to `<Children/>`.
  "Outlet in views, `<Children/>` in components" is a documented convention
  over one mechanism; the compiler cannot tell a view from a component.
- **Uniqueness is per render path** (D173 V13): one default marker
  (`<Children/>` and `<Slot/>` share the bucket) and one `<Slot name="x">` per
  name; exclusive `{#if}`/`{#case}` branches are separate paths, and a marker
  in a `{#for}` body is one site. Checked per template and skeleton body.
- **Forwarding** (D71): `<Card><Children/></Card>` hands the enclosing
  template's default content through Card. A named slot inside a component
  invocation is a compile error; the router fills only the default bucket.
- **Retired lowercase spellings are positioned steering errors**:
  `<children>` → `<Children/>`, `<slot name>` → `<Slot name="…"/>`, bare
  `<slot>` names both replacements, `<portal>` → `<Portal>`, `<snippet fits…>`
  → `<Snippet>`. None of this applies inside `{#raw}`, where every tag is a
  literal element.
- **`Children`, `Slot`, `Snippet`, `Portal` are reserved tag names**, matched
  exactly before component resolution; as a dotted family root they are an
  error ([[DECISION-D167-COMPONENT-FAMILIES]]).

## Alternatives

- **Lowercase spellings as aliases** — two spellings per role recreate the
  confusion.
- **`<slot name="children">` for the default** — verbose, keeps every role on
  one word.

## Consequences

Validation lives in `packages/puzzle-lang/parser` (`parser.go` marker branch,
`slot.go`). External mirrors track the grammar: puzzle-eslint / puzzle-prettier
and the three editor grammars.
