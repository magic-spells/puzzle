---
name: v1.50 — Route head management (D84)
status: verified
connections:
  - DECISION-D84-HEAD-MANAGEMENT
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-ROUTER
  - FILE-ROUTER
  - FILE-SSG-RUNTIME
verified_at: '2026-07-24T00:26:25.226Z'
verified_sha: 0858d1e52af13ecfe031278ca8e1db496ca3ff2c
notes:
  - kind: verified
    text: >-
      Merged (PR #15) and verified: +29 tests; hybrid + static builds carry data-puzzle-head tags
      pre-JS; real-Chrome check — 8 managed tags on load, navigation removes suppressed fields and
      restores on back, adoption never duplicates. Note the D84 semantic delta: explicit title:null
      now suppresses (pre-D84 inherited).
    sha: 0858d1e52af13ecfe031278ca8e1db496ca3ff2c
---

# v1.50 — Route head management (D84)

Reserved `meta` head fields — `title`, `description`, `canonical`,
`socialImage` — resolved per-field leaf→root (`null` suppresses) and rendered
as `data-puzzle-head`-marked managed tags by both the SSG shell injection and
the SPA commit path. Ship [[DECISION-D84-HEAD-MANAGEMENT]].

Builds on v1.49's snapshot/commit-path work — queued behind
[[FEATURE-V1-49-QUERY-REPLACE]] (shared `router.js` / `ssg/index.js`
surface).

## Scope

- In (runtime): NEW `client-runtime/head.js` (`resolveHead(chain)` +
  `syncHead` with identity adoption); the router's `#setTitle` site becomes
  the head sync (memory mode stays a document no-op; title-only apps
  byte-identical; no-title-anywhere leaves `document.title` alone).
- In (SSG): `renderRoute` resolves `head` (page keeps `title` for
  compatibility); `injectShell`/`injectStaticShell` replace same-identity
  managed tags and insert the rest before `</head>` — escaped string surgery,
  no HTML parser. Hybrid takeover adopts existing marked tags (no
  duplicates).
- In (types): `Route['meta']` reserved fields + `PrerenderedPage.head`.
- Out (per D84): `robots`/`themeColor`, data-derived head values, per-network
  overrides, raw head HTML, component-level head declarations.

## Acceptance

- Static + hybrid output carry crawler-visible tags before JS runs; SPA
  navigation updates/removes managed tags atomically with the commit; failed
  navigation never touches the head; hostile values escape; unmanaged head
  elements untouched; full suites green.
