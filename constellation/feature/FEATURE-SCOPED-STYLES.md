---
name: Scoped styles (<styles scoped>)
status: verified
connections:
  - DECISION-D59-SCOPED-STYLES
  - DECISION-D12-TAILWIND-FIRST
  - DECISION-D35-NO-SASS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-PUZZLE-FILE
  - DOC-SPEC
verified_at: '2026-07-14T07:08:22.704Z'
verified_sha: f867f10b5a09efb6fbf650f0d5432cc0edc17332
---

# Scoped styles (`<styles scoped>`)

**Shipped in v1.27** (D59) — the card's own "may resolve won't-build" hedge
resolved the other way once native `@scope` reached cross-engine Baseline,
converting scoping from a CSS-parsing problem (the D35-class complexity this
card dreaded) into a string-wrapping one. Contract in [[DOC-SPEC]] §29;
rationale and rejected alternatives in [[DECISION-D59-SCOPED-STYLES]].

## What shipped

- A bare `scoped` attribute — the only attribute `<styles>` accepts
  (previously attrs were silently discarded; now valued/dynamic/unknown/
  duplicate are positioned compile errors with did-you-mean) — confines the
  block to the component's own rendered subtree.
- Mechanism: `codegen.ScopeID(path)` (`pzl-` + 8-hex FNV-1a of the
  compiler-relative slash-normalized path, the single id source) → one
  valueless static `data-<scopeId>` stamped on the template root vnode in
  all modes (view-mode skeletons reuse the stamped attrs, covered for free)
  → the esbuild plugin collects the block wrapped as
  `@scope ([data-<scopeId>]) { …verbatim… }`. The Go compiler never parses
  a selector.
- **No lower boundary in this cut**: scoped = "doesn't leak out"; rules
  still cascade into children; `@scope` proximity resolves equal-specificity
  collisions child-first (the card's acceptance case). A hard `to (…)`
  boundary remains additive-later.
- Unscoped blocks byte-identical (existing goldens untouched — the
  byte-identity proof).

## Acceptance (met)

Two components with colliding selectors in scoped blocks do not affect each
other (proximity + per-file scope roots); global blocks byte-identical to
before. Parser + codegen + plugin tests, `scoped_styles` golden pair; all Go
packages + 540 vitest green.

## Known edge

Root-only stamping means a component whose TEMPLATE ROOT is another
component tag gets the stamp as a prop, which produces no DOM attribute — a
scoped block on such a file matches nothing (inherent to root-only; plain
element roots are the normal case). Recorded in D59's consequences.
