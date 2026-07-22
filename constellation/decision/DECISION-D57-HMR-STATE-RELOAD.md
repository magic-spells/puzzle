---
name: "D57 — HMR as state-preserving dev reload: snapshot/restore across the SSE reload, not per-module swap"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D27-FAST-DEV-REBUILDS
  - FEATURE-HMR
  - COMPONENT-DEV-SERVER
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - DOC-SPEC
---

# D57 — HMR as state-preserving dev reload: snapshot/restore across the SSE reload, not per-module swap

Settled (v1.25). `puzzle dev`'s live reload becomes **state-preserving**: the
injected SSE client snapshots the running app (store contents + every mounted
view's local state) to `sessionStorage` immediately before `location.reload()`,
and the freshly booted app restores it. Editing a `.pzl` mid-flow — a modal
open, a form half-filled, deep in a nested route — no longer resets the app.

## Context

[[FEATURE-HMR]] named per-module hot swap as the candidate scope, with the
module boundary as its hardest open question. Two facts changed the calculus:
(1) D27 made warm rebuilds ~10–15ms and the app is a SINGLE esbuild bundle —
on localhost a full reload's latency is negligible, so the only real loss from
reloading is STATE; (2) per-module swap needs browser-side import-graph
machinery (a module registry, a per-module compile endpoint, import-map
resolution of `@magic-spells/puzzle` and sibling `.pzl` imports) — a large,
invasive surface (compiler + dev server + runtime) purchased only to avoid a
~50ms reload. Preserving state across the reload meets the card's acceptance
(sibling form state, route, store contents all survive) at a fraction of the
machinery.

## Decision

- **Reload + transplant, not swap.** Every rebuild keeps the full-page reload
  (the new bundle always runs whole — no stale closures, no double listeners,
  no partial graphs). The state crosses over via a one-shot
  `sessionStorage` blob (`__puzzleHMR`).
- **Dev flag with production DCE.** The build defines `__PUZZLE_DEV__`
  (esbuild `Define`): `true` in dev builds, `false` in production, where
  `MinifySyntax` (already on) strips every guarded branch — zero production
  bytes and zero production behavior. The runtime guard treats UNDEFINED as
  true (`typeof` probe), so the unbundled runtime under vitest — and a user
  bundling the runtime with their own tools — keeps the hooks present but
  inert (nothing calls them without the injected dev client).
- **Snapshot** (dev client → `window.__PUZZLE_APP__.__devSnapshot()`, then
  `location.reload()`):
  - **Store:** all records in the `_persist()` wire shape (`type →
    [toJSON()]`), via a shared serializer — hydration-exempt from validation
    exactly like `_load()` (D48 posture).
  - **View state:** a dev-only module-level registry of live mounted
    PuzzleView instances; each contributes its `getData()` filtered through a
    conservative JSON-safe walk — functions, DOM nodes, store records, and
    any structure containing them are DROPPED (data() re-derives those from
    the restored store); primitives and plain objects/arrays (form fields,
    toggles, drafts) survive. Keyed `${class name}:${per-class mount index}`
    — deterministic across the reload because the same URL mounts the same
    chain in the same order.
  - **Route:** carried by the URL itself (history/hash). Memory mode is
    exempt (no dev-server story). Scroll already persists (v1.10).
- **Restore** (end of `PuzzleApp.mount()`, after the initial navigation):
  read + DELETE the blob (one-shot), discard if older than ~10s (a later
  manual F5 must cold-start), hydrate the store (after any user-configured
  `storage` load — the snapshot is newer and wins on pk conflicts via the
  existing skip-dup guard), then `setData(saved)` into each live view whose
  key matches. Every step fail-soft: a corrupt blob, a missing view, a
  storage error → cold start, never a crash.
- **The edited component restores too** (restore-all). The card allowed
  resetting it, but keeping a form's state while editing THAT form's template
  is the whole point of the feature; a shape mismatch self-heals on the next
  edit (setData keys the new data() doesn't read are inert). Per-changed-file
  skip (codegen source-path stamps + an SSE payload naming changed files)
  is deferred until restore-all misbehaves in practice.

## Consequences

- Meets [[FEATURE-HMR]] acceptance: edit a component while a sibling holds
  form state → the change appears, the sibling's state, route, and store all
  survive. Local `setData` state survives EVERYWHERE, not just in siblings —
  stronger than the card asked.
- Known, accepted edges (dev-only, all fail-soft): focus and text-selection
  are lost across the reload; DOM islands (D44) re-seed; a skeleton-gated
  async view whose `data()` commits after restore can clobber restored
  defaults for that view; class-name collisions or a data()-driven variable
  mount order can mis-key a view's state (it just cold-starts).
- Per-module hot swap is now explicitly a POSSIBLE FUTURE on top of this (the
  snapshot/restore machinery is what it would need anyway for the edited
  module's subtree); revisit only if reload cost — focus loss, island
  re-seeding — proves painful in real use.
- Rejected alternatives: **esbuild-native module HMR** (esbuild has no HMR
  runtime; we'd build the registry + endpoint + import maps ourselves);
  **in-page whole-bundle re-execution** (dynamic re-import of `dist/app.js`
  without a reload — flashless and focus-preserving, but old-bundle teardown
  is leak-prone: two live module graphs, doubled globals, stale closures —
  the reload gives process-level hygiene for free); **injecting
  `sessionStorage` as the app's `storage`** (would change app semantics —
  per-write persistence the app didn't opt into).
