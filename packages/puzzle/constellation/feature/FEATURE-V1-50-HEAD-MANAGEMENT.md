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
  - FEATURE-V1-49-QUERY-REPLACE
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Merged (PR #15) and verified: +29 tests; hybrid + static builds carry data-puzzle-head tags
      pre-JS; real-Chrome check — 8 managed tags on load, navigation removes suppressed fields and
      restores on back, adoption never duplicates. Note the D84 semantic delta: explicit title:null
      now suppresses (pre-D84 inherited).
    sha: 0858d1e52af13ecfe031278ca8e1db496ca3ff2c
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-2-0
change: feature
---

# v1.50 — Route head management (D84)

Reserved `meta` head fields — `title`, `description`, `canonical`,
`socialImage` — resolved per-field leaf→root (`null` suppresses). The browser
assigns `document.title`; the managed `data-puzzle-head` tags are baked into
prerendered HTML by the SSG shell injection, the one copy every crawler reads.
Ship [[DECISION-D84-HEAD-MANAGEMENT]].

Builds on v1.49's snapshot/commit-path work — queued behind
[[FEATURE-V1-49-QUERY-REPLACE]] (shared `router.js` / `ssg/index.js`
surface).

## Scope

- In (runtime): `client-runtime/head.js` — `resolveHead(chain)` plus the
  one-line `syncTitle`. The router's title site resolves the whole head and
  assigns `document.title` from it, and does nothing else with the head
  (memory mode stays a document no-op; title-only apps byte-identical;
  no title resolved anywhere leaves `document.title` alone).
- In (SSG): `renderRoute` resolves `head` (page keeps `title` for
  compatibility); `injectShell`/`injectStaticShell` replace same-identity
  managed tags, remove non-resolving ones, and insert the rest before
  `</head>` — escaped string surgery, no HTML parser. `headTags.js`
  (`MANAGED_TAGS`) is build-time only and has no browser importer, so the
  hybrid takeover leaves the prerendered tags exactly as they are
  ([[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]]).
- In (types): `Route['meta']` reserved fields + `PrerenderedPage.head`.
- Out (per D84): `robots`/`themeColor`, data-derived head values, per-network
  overrides, raw head HTML, component-level head declarations, and a
  browser-side managed-tag sync.

## Acceptance

- Static + hybrid output carry crawler-visible tags before JS runs; SPA
  navigation updates `document.title` atomically with the commit; a failed
  navigation never touches the head; hostile values escape; unmanaged head
  elements — and any `<title>`/`data-puzzle-head` in rendered body markup —
  are untouched; full suites green.
- Semantic delta from pre-D84 behavior: an explicit `meta.title: null` now
  suppresses rather than inheriting. Apps relying on inherit-on-null must
  omit the field instead.
