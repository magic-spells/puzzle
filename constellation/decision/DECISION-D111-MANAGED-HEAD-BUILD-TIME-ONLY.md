---
name: D111 — managed head tags are build-time only; the runtime sync and its usage gate are deleted (amends D89)
status: verified
connections:
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D84-HEAD-MANAGEMENT
  - COMPONENT-ROUTER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-HEAD-TAGS
verified_at: '2026-07-25T05:24:34.861Z'
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
notes:
  - kind: verified
    text: >-
      Verified end to end at merged main: headTags.js exports only MANAGED_TAGS with ssg/index.js as
      its sole importer; router.js #syncHead is syncTitle(resolveHead(chain)); bundleDefines emits
      __PUZZLE_HAS_FLIP__ alone; ScanUsage reads only .pzl; WatchBuilder tracks one define bit.
      Follow-through applied this pass: SPEC §45 and DOC-RELEASE-SURFACE still described SPA-side
      tag syncing.
    sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
---

`syncTags` is gone from the browser. Managed head tags (`og:*`, `twitter:*`,
`canonical`) are produced **only** by the SSG at build time, baked per page into
prerendered HTML. The `__PUZZLE_HAS_HEAD_TAGS__` define, its whole-project byte
scan, and the `Usage.HasHeadTags` plumbing are deleted with it. The browser tab
title is unaffected: `syncTitle` remains ungated and runs on every navigation in
every mode.

## Context

[[DECISION-D89-FEATURE-USAGE-TREESHAKE]] gated `headTags.js` behind a build-time
guess at whether an app used head metadata — a raw substring scan of every
first-party `.js`/`.ts`/`.pzl` file for `description`/`canonical`/`socialImage`.
That guess was wrong in both directions:

- **False negative.** `MANAGED_TAGS` derives `og:title`/`twitter:title` from the
  `title` field, which the scan never probed. A title-only hybrid app shipped
  with the sync folded away while the SSG still baked `og:title` into every
  page — so after the first client navigation those tags were stale for the life
  of the session, unupdatable and unremovable.
- **False positive.** `description` is an ordinary English word. A model field
  named `description` (`examples/kanban-morph`) turned the gate on for an app
  emitting no managed tags at all, costing ~1.4 KB plus ~10 dead
  `head.querySelector` probes per navigation.

Patching the probe set (adding `title`) fixed the first at the cost of widening
the second to nearly every app, since `title` appears in 87 of 18 examples' files
against `description`'s 7. That patch is superseded by this decision.

## Decision

Delete the runtime sync rather than keep guessing when to ship it.

**Crawlers never client-navigate.** Google, Slack, Twitter and Facebook each
issue a plain GET for one specific URL. In `hybrid` and `static` that URL maps to
a real file whose head tags the SSG already baked correctly, per page. Runtime
DOM syncing only ever served something reading
`document.querySelector('meta[property="og:title"]')` *after* a client-side
navigation — an in-page share widget. That is explicitly not supported.

This states the mode contract plainly: **SEO is what the prerender modes are
for.** A SPA does not do SEO, and no longer half-pretends to by writing tags into
a DOM no crawler reads.

The SPA case is not a marginal call — it is what a SPA *is*. The shape Puzzle
serves in that mode is application software: a banking dashboard, a design tool,
a kanban board. Those live behind auth, no crawler ever reaches them, and
"per-panel social preview metadata" is not a coherent thing to want. Keeping
`og:title` in lockstep with the active panel of a project-management tool was
machinery in service of nobody.

The deletion is structural, not another gate. The two consumers of
`headTags.js` were already cleanly split — `ssg/index.js` imported only
`MANAGED_TAGS` (Node, build time), `router/router.js` imported only `syncTags`
(browser). Removing that one router import leaves `syncTags` with no browser
importer, so ordinary tree-shaking drops it and **no define is needed at all**.
`MANAGED_TAGS` stays, consumed solely by the SSG.

`ScanUsage` consequently reads only `.pzl` files: formatter chains and `flip`
are template facts, and the head-tag grep was the sole reason it ever opened a
`.js`/`.ts` file. Every dev rebuild now reads strictly fewer files.

## Alternatives rejected

- **Add `title` to the probe set.** Shipped earlier the same day; correct but
  taxes all 18 example apps to fix a bug reachable in one mode, and leaves the
  false-positive direction worse than before.
- **Make the gate mode-aware** (`title` probed only when `output: 'hybrid'`).
  Correct and cheap, but still carries a heuristic, a define, and a
  watch-rebuild invalidation to decide something that turns out not to be needed
  at all.
- **Suppress the SSG's tag injection when the gate is off**, so both sides agree
  at zero bundle cost. Strictly worse: it strips the per-page tags that real
  crawlers actually consume, trading a stale-DOM edge case for no social tags.

## Consequences

- **Behavior change in hybrid.** After a client-side navigation the managed tags
  in the live DOM keep navigation zero's values. Prerendered HTML — what every
  crawler fetches — remains correct per page. `tests/router-head.test.js` now
  pins this: the takeover path asserts SSG-emitted tags are left byte-identical.
- **`meta.description`/`canonical`/`socialImage` are dead config under
  `output: 'spa'`.** They resolve and are then unused. A compiler warning was
  initially declined as unnecessary ceremony, then ADDED in the 0.3.0
  pre-publish round (Cory-approved): the silent acceptance was a trap, and an
  honest signal turned out to exist — `warnDeadSPARouteMeta`
  (`compiler/internal/build/route_head_warning.go`) lexes ONLY conventionally
  named `app/**/routes.{js,ts}` modules (comment/string/regex/template-aware,
  key-position match at depth 1 inside a `meta: { … }` object) and warns with
  file:line:column under plain SPA output only. This is NOT the retired D89
  byte scan coming back: one file convention, real tokens, zero prose
  false-positives (pinned by tests), fires only when the key is genuinely
  route-head config.
- SPAs and hybrid apps shed ~1.4 KB minified and ~10 `querySelector` probes per
  navigation. Static never shipped it (no router).
- D89's `flip` half is untouched and still shipping; only its head-tags half is
  retired. `__PUZZLE_HAS_FLIP__` and its scan remain.
- `client-runtime/headTags.js` is now a build-time-only module. It stays in the
  published package because the `./ssg` entry needs it.
