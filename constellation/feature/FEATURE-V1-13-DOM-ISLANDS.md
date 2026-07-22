---
name: "v1.13 — DOM islands + backspace/delete key filters"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D45-BACKSPACE-DELETE-FILTERS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-EVENTS
  - DOC-SPEC
---

# v1.13 — DOM islands + backspace/delete key filters

The amendment that unblocks the Grimoire example (Notion-style block editor): a declarative "this subtree's DOM is owned by someone else" primitive, plus two missing key filters. Driven by [[DECISION-D44-DOM-ISLANDS]] and [[DECISION-D45-BACKSPACE-DELETE-FILTERS]].

## Intent

Always-on `contenteditable` surfaces (and third-party DOM mounts generally) need the patcher to seed children once and then keep its hands off, while attributes/listeners on the element keep patching. v1's only route was the implicit empty-children + `mounted()` seeding convention — undiagnosable when violated. Editor keyboard handling also wants `@keydown:backspace`/`@keydown:delete`.

## Scope

**In:**
- `island` static attribute on plain elements: template children mount as seed content, are never reconciled afterward (old children carried forward on patch); element attrs/listeners patch normally; attribute stripped from the DOM like `key`; key change = sanctioned re-seed. Compile errors: dynamic `island={expr}`; `island` on a component tag; component/slot inside an island subtree; `island` on the `<puzzle-view>` root.
- `backspace`/`delete` in the D38 key-filter tables (parser `eventKeyFilters` + runtime `KEY_FILTERS`, kept mirrored).

**Out (rejected):** controlled contenteditable binding; components inside islands; DOM-visible island attribute; system-modifier combos (`:ctrl:enter`) — see the decision cards.

## Outcome

Shipped in v1.13; documented in [[DOC-SPEC]] §17 (+ §5/§6), [[DOC-TEMPLATE-SYNTAX]], [[DOC-EVENTS]]. Runtime: `patch()` carries old children forward and returns before `patchChildren` when `'island' in attrs`; `setAttr`/`removeAttr` strip `island` like `key`; `KEY_FILTERS` +2. Compiler: `eventKeyFilters` +2; new parser post-pass `validateIslands` (compiler/internal/parser/island.go) runs from both `ParseTemplate` and `ParseSkeleton`, walking block bodies and component children — four positioned errors per D44 (MixedAttr values classified dynamic). Codegen untouched: a bare `island` flows through as `island: true` in emitted attrs (pinned by the new `island` golden; existing goldens byte-identical). Tests: 7 island jsdom tests (seed mount, no DOM attr, carried-children invariant across two re-renders, attr+listener patch on the island element, keyed move with node identity, tag/key re-seed) + 2 key-filter tests + Go parser tables — 285 vitest + all Go packages green.
