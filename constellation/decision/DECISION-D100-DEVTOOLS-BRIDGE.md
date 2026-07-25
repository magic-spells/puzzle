---
name: D100 — DevTools runtime bridge + wire protocol; extension in its own repo (v1.63)
status: verified
connections:
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D60-DROP-CONSOLE-OPT-OUT
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - COMPONENT-PUZZLE-APP
  - COMPONENT-STORE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-DEVSTATE
  - DOC-SPEC
verified_at: '2026-07-25T03:05:46.023Z'
verified_sha: acb9aefb0dcb65bd4cbd379d1f8877dbb089700c
notes:
  - kind: verified
    text: >-
      Real-Chrome smoke passed (Cory, 2026-07-24): load-unpacked extension against a live `puzzle
      dev` app (stays, port 3400, framework 0.3.0) — connected handshake with correct
      framework/protocol versions, 18 live views tracked, flush keys streaming, Views tree with
      module paths and props inspection all working. One cosmetic follow-up in the extension repo:
      detail-pane header/props layout squished in short docks (value previews collapse to ellipsis).
    sha: acb9aefb0dcb65bd4cbd379d1f8877dbb089700c
---

Puzzle gets a Chrome DevTools extension. The framework ships only a dev-only
**runtime bridge** (`client-runtime/devtools.js`) speaking a versioned wire
protocol; the extension itself lives in its own public repo,
`magic-spells/puzzle-devtools`, and never imports framework internals.

## Not a reversal of D60

D60 re-rejected a **devtools hook as app-config surface** — a field every app
author would see in a config D8 keeps deliberately minimal. This is a different
object: a **dev-only wire protocol** with zero config surface and zero
production bytes. No app author writes anything; the extension injects
`window.__PUZZLE_DEVTOOLS_HOOK__` at `document_start`, and the bridge notices
it — or, absent the hook, does nothing at all. `window.__PUZZLE_APP__` (D57)
remains the manual-console story; the bridge is its structured sibling.

## Context

The 2026-07 framework-gap survey ranked a DevTools extension the highest-value
unbuilt item, for a specific reason: Puzzle already **maintains the data the
hard panels need**. `subscribersByKey`/`keysBySubscriber` answer "which views
re-render when this record changes" exactly — a question React and Svelte
users answer by guessing — and the two-layer state model (`data()` model layer
vs `setData()` local layer) is the framework's most confusing concept and is
invisible without tooling.

## Decision

**Repo split (Cory's call).** Extension in `magic-spells/puzzle-devtools`
(public from day one): independent release cadence (Chrome Web Store vs npm),
separate issues/PRs, a different contributor audience. The ONLY interface
between the repos is the protocol documented in SPEC §55; the extension repo
mirrors the message constants and links to the SPEC rather than sharing code.

**Bridge shape.** `client-runtime/devtools.js` follows `devstate.js`'s
conventions exactly (module-scope `DEV` const is legal at module level; inline
probes inside class methods elsewhere). Core call sites are one-liners beside
existing dev-gated code: the `__PUZZLE_APP__` publish/clear (app),
`_deliverNotifications` (store flush — keys + notified set in scope), the
`warnMissingSlots` spot in `#commitState` (router), and devstate's existing
`registerView`/`unregisterView` (views — reused, not duplicated). Two inert
internal readers land on `PuzzleView` beside `_localState()`: `_modelState()`
and `_vnodeTree()` (the `__devSnapshot` empty-method-residue precedent).

**Protocol v1** (SPEC §55 is the contract): envelope
`{ puzzle: 1, v: 1, type, payload }`; events `hello` / `app-mounted` /
`app-unmounted` / `view-mounted` / `view-destroyed` / `flush` /
`route-commit`; requests `snapshot:views|records|subscriptions|route`,
`inspect:view`, `edit:record` (through the real `record.update()` so
validation applies), `highlight:view`, `log:view|record` (binds `$p`).
Versions are exchanged in `hello`; the panel supports a range and shows a
clear mismatch state rather than misrendering.

**View tree discovery** walks every live view's vnode tree (component
instances hang off `vnode.component`) and derives roots as views that are no
one's child — deliberately avoiding any read of the router's private state.

**Extension architecture** (other repo): MV3; `page-hook.js` injected at
`document_start` owns the hook object and buffers events until a panel
connects; content script relays; background service worker routes per-tab; the
panel is a **Puzzle app** (dogfooding — protocol messages upsert into a Puzzle
store, panels are plain reactive views), themed to Chrome DevTools' light/dark.
v1 ships the Views panel (model/local layers side by side) and the Store
record inspector; the subscriptions graph, router panel, and timeline follow.

## Consequences

- Zero production bytes: the `__PUZZLE_DEV__` define folds every call site and
  the module tree-shakes away — pinned by extending the existing
  `TestBuildDevDefineDCE` prod/dev assertions to `__PUZZLE_DEVTOOLS_HOOK__`.
- Zero cost without the extension: no hook object → every notify call is a
  cheap no-op in dev too.
- The flush event rides the store's existing batching — the firehose problem
  is solved by D63's scheduling, not by new throttling.
- Mixed versions in the wild are a protocol-negotiation problem by design,
  not a repo-layout problem.
- The panel app depends on `@magic-spells/puzzle` via a `file:` link until
  0.2.0 publishes — one more reason to publish.

## Alternatives rejected

- **Extension in the main repo** — initially recommended (protocol churn is a
  two-repo tax while young), overridden by Cory for independent releases and
  a separate contributor surface; accepted because the version-negotiated
  protocol must exist anyway once mixed versions are in the wild.
- **Extension-injected instrumentation of `__PUZZLE_APP__` with no framework
  bridge** — works only because dev builds are unminified, and monkey-patching
  store/router internals from outside drifts with every release; the
  framework-owned bridge version-locks instead.
- **A browser side panel instead of a DevTools panel** — wrong register;
  framework inspection happens where Elements/Console are. May complement
  later.
- **Rebuilding a console panel** — Chrome's is one tab away; the panel surfaces
  Puzzle-semantic events only.
- **An event-emitter API on `PuzzleApp`** — public API surface for a dev tool;
  the D60 line still holds.
