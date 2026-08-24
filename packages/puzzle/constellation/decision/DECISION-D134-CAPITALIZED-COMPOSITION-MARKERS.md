---
name: D134 — capitalized composition markers (v1.64)
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
  - FILE-PARSER
  - FILE-COMPILER-INTERNAL-PARSER-SLOT
  - FILE-CODEGEN
  - FILE-VIEW-MANAGER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D134 — capitalized composition markers (v1.64)

The composition markers are capitalized. Two tags, three roles:

| Spelling | Role |
|---|---|
| `<Children/>` | the **default marker** — untagged call-site content renders here |
| `<Slot/>` | the **router outlet** (D30, semantics unchanged) |
| `<Slot name="x"/>` | a **named slot** — call-site children tagged `slot="x"` render here |
| `slot="x"` attr (call site) | routes a direct child to a named slot (D53, unchanged) |

Retired: the lowercase `<children>` and `<slot>` spellings in every form. Each
retired spelling is a positioned compile error steering to its capitalized
replacement. A marker's paired body is fallback content
([[DECISION-D141-MARKER-FALLBACK-BODIES]] owns that question).

## Context

The markers were lowercase, on the grounds that a capitalized tag means an
imported component class. The framework's owner reads them the opposite way:
markers are framework-provided tags — much closer to components than to HTML
vocabulary — and the lowercase spellings misfile them as elements. Under D134
capitalization uniformly means "the framework resolves this tag": components
from your imports, markers from the grammar.

The lowercase `slot` word also carried three roles at once — the default
marker (D16), named insertion points (D53), and the router outlet (D30) — plus
a fourth *position* under D71 forwarding. The case-only distinction between
`<slot/>` and `<Slot/>` never held in practice: the repo's own examples used
lowercase bare `<slot/>` as the router outlet, and the framework's author
misread bare `<slot/>` in a component as needing a separate children concept —
direct evidence the overload confuses even its owners. It also degrades LLM
template generation: a grammar where each token has one meaning is what makes
generated templates correct on the first try.

## Decision

- **`<Children/>` is the default marker.** No attributes (any is a positioned
  compile error; `ref` keeps the D72 render-target message). Renders the
  invocation's untagged direct children — or, in a routed view/layout, the
  default bucket.
- **`<Slot/>` stays the router outlet; `<Slot name="x"/>` is a named slot.**
  The role split is by attribute, not spelling: a Slot is a hole someone else
  fills — the router fills the bare one, the call site fills named ones.
  `name` is static, non-empty, and unique per template body; `"default"` and
  `"children"` are reserved (both steer to `<Children/>`). D53's remaining
  local-shape rules (no dynamic/interpolated name, no other attributes)
  carry over verbatim. The compiler cannot enforce "outlet in views only" — a
  view and a component are the same `.pzl` format — so bare `<Slot/>` in views
  vs `<Children/>` in components is a **documented convention over one
  mechanism**, not two mechanisms.
- **Retired spellings are steering errors.** `<children…>` → "the default
  marker is spelled `<Children/>` since v1.64 (D134)"; `<slot name="x"…>` →
  `<Slot name="x"/>`; bare `<slot…>` names both replacements (`<Children/>`
  for call-site content, `<Slot/>` for the router outlet).
- **`Children` joins `Slot` as a reserved tag name.** parseElement matches
  markers before component resolution, so a component with either name is
  unreachable from templates by construction.
- **Unchanged mechanics** (D53/D71, respelled only): one default marker per
  body with `<Children/>` and `<Slot/>` sharing the uniqueness bucket; the
  call-site `slot="x"` rules (static, direct children only, stripped from
  output); forwarding — `<Card><Children/></Card>` hands the enclosing
  template's default content through Card, `<Slot/>` identical in that
  position; named markers inside an invocation remain compile errors; the
  router fills the default bucket only, so a named slot in a routed view
  renders nothing.

## Alternatives rejected

- **Keep the lowercase spellings as legal aliases** — two live spellings per
  role recreates the exact confusion the role split existed to end.
- **Spell the default `<slot name="children">`** — verbose, and keeps every
  role on one word; the overload survives.

## Consequences

Parser (parser.go parseElement marker branches + slot.go validation), codegen
marker emission, a11y scanner clause, and a sweep of examples, the two
go:embed scaffold templates, the agent skill, SPEC §24, and
[[DOC-TEMPLATE-SYNTAX]]. Breaking change, shipped in 0.4.0 (pre-1.0 minor).
External mirrors must track the grammar: puzzle-eslint / puzzle-prettier
(vendored section splitters) and the sublime/vscode/zed grammar repos.
