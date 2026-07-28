---
name: 'D134 — capitalized composition markers, no fallback bodies (v1.64)'
status: built
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D71-SLOT-FORWARDING
  - DECISION-D74-CHILDREN-MARKER
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - FILE-PARSER
  - FILE-COMPILER-INTERNAL-PARSER-SLOT
  - FILE-CODEGEN
  - FILE-VIEW-MANAGER
---

# D134 — capitalized composition markers, no fallback bodies (v1.64)

The composition markers are capitalized and self-closing. Two tags, three
roles:

| Spelling | Role |
|---|---|
| `<Children/>` | the **default marker** — untagged call-site content renders here |
| `<Slot/>` | the **router outlet** (D30, semantics unchanged) |
| `<Slot name="x"/>` | a **named slot** — call-site children tagged `slot="x"` render here |
| `slot="x"` attr (call site) | routes a direct child to a named slot (D53, unchanged) |

Retired: the lowercase `<children>` and `<slot>` spellings in every form, and
**fallback bodies on every marker** — a marker with content (even an empty
paired `<Children></Children>`) is a positioned compile error. An unfilled
marker renders nothing.

## Context

D74 split the roles but kept the markers lowercase, rejecting `<Children/>`
on the grounds that a capitalized tag means an imported component class. The
framework's owner reads them the opposite way: markers are framework-provided
tags — much closer to components than to HTML vocabulary — and the lowercase
spellings misfile them as elements. Under D134 capitalization uniformly means
"the framework resolves this tag": components from your imports, markers from
the grammar.

Fallback bodies are the other friction. Content inside a marker makes it
half-element — bodies to parse, recursively expand, serialize, and guard at
every boundary (islands, `{#svg}`, the a11y scan) — and the repo's own
examples and scaffold templates never used the capability once. A 2026-07-27
review candidate lived in exactly that corner; deleting the surface deletes
the bug class.

## Decision

- **`<Children/>` is the default marker.** Self-closing REQUIRED. No
  attributes (any is a positioned compile error; `ref` keeps the D72
  render-target message). Renders the invocation's untagged direct children —
  or, in a routed view/layout, the default bucket — and nothing when unfilled.
- **`<Slot/>` stays the router outlet; `<Slot name="x"/>` is a named slot.**
  The role split is by attribute, not spelling: a Slot is a hole someone else
  fills — the router fills the bare one, the call site fills named ones.
  `name` is static, non-empty, and unique per template body; `"default"` and
  `"children"` are reserved (both steer to `<Children/>`). D53's remaining
  local-shape rules (no dynamic/interpolated name, no other attributes)
  carry over verbatim.
- **No fallback anywhere.** "Render default content when unfilled" is the
  owning component's concern — a prop or an `{#if}` in its own template. No
  is-slot-filled probe is added; that is deferred until real demand, not
  designed here.
- **Retired spellings are steering errors.** `<children…>` → "spelled
  `<Children/>` since v1.64 (D134)"; `<slot name="x"…>` → `<Slot name="x"/>`;
  bare `<slot…>` names both replacements (`<Children/>` for call-site content,
  `<Slot/>` for the router outlet). A body on any marker errors with
  "composition markers are self-closing — fallback content is not supported
  (D134)".
- **`Children` joins `Slot` as a reserved tag name.** parseElement matches
  markers before component resolution, so a component with either name is
  unreachable from templates by construction.
- **Unchanged mechanics** (D53/D71/D74, respelled only): one default marker
  per body with `<Children/>` and `<Slot/>` sharing the uniqueness bucket;
  the call-site `slot="x"` rules (static, direct children only, stripped from
  output); forwarding — `<Card><Children/></Card>` hands the enclosing
  template's default content through Card, `<Slot/>` identical in that
  position; named markers inside an invocation remain compile errors; the
  router fills the default bucket only, so a named slot in a routed view now
  renders nothing.
- **Emission shrinks.** Every marker is `new ViewNode(SLOT_TAG)` or
  `new ViewNode(SLOT_TAG, { name })` — the third-argument fallback array
  leaves the grammar, so codegen's fallback cases and the runtime's fallback
  expansion branch (viewManager `expandNode`'s unfilled path) are deleted,
  and the §43 a11y scan no longer descends into slot fallbacks.

## Alternatives rejected

- **Keep the lowercase spellings as legal aliases** — two live spellings per
  role recreates the exact confusion D74 existed to end.
- **Keep fallback bodies on the new spellings** — unused in every example and
  template; the cost is permanent grammar + runtime + serializer surface and
  a demonstrated source of review findings.
- **Allow an empty paired form (`<Children></Children>`)** — one legal shape
  keeps the parser, the error messages, and the external grammar mirrors
  simple; the error steers to the self-closed form.
- **An is-slot-filled probe** — scoped-slot-adjacent design; deferred.

## Consequences

Parser (parser.go parseElement marker branches + slot.go validation rewrite),
codegen (marker emission minus fallback; `children_fallback` goldens deleted),
runtime (viewManager fallback expansion deleted; SSG serializer shares the
expansion and needs no separate change), a11y scanner clause, and a sweep of
examples, the two go:embed scaffold templates, the agent skill, SPEC §24, and
[[DOC-TEMPLATE-SYNTAX]]. Breaking change, ships in 0.4.0 (pre-1.0 minor).
External mirrors must track the grammar: puzzle-eslint / puzzle-prettier
(vendored section splitters) and the sublime/vscode/zed grammar repos.
