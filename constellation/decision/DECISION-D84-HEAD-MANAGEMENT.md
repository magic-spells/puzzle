---
name: 'D84 — Route head management: reserved `meta` fields, SSG-first (v1.50)'
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-ROUTER
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D42-MEMORY-MODE
  - FILE-ROUTER
  - FILE-SSG-RUNTIME
  - FEATURE-V1-50-HEAD-MANAGEMENT
verified_at: '2026-07-24T06:55:21.936Z'
verified_sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
notes:
  - kind: decision
    text: >-
      Title-null suppression re-affirmed in code (2026-07-24). A 0.2.0 pre-release hardening pass
      briefly regressed `meta.title: null` back to INHERIT (a review verifier checked git history,
      not §45); reverted so all four reserved head fields share ONE uniform posture —
      `undefined`/omit inherits, explicit `null` STOPS the walk and suppresses (head.js
      resolveField: `value !== undefined`). A resolved-null title still leaves document.title / the
      shell <title> as-is (leave-alone, never blank). MIGRATION 0.1.x→0.2.0: pre-D84 #setTitle used
      `meta.title != null`, so a child/layout `title: null` INHERITED the parent title; under D84 it
      now SUPPRESSES. Apps relying on the old inherit-on-null must switch to `undefined`/omit.
    sha: d9591d6
  - kind: verified
    text: >-
      Title-null uniform suppression re-verified in head.js at d9591d6 (the batch-1 inherit
      regression is reverted); tests/ssg-head.test.js asserts suppression + the undefined-inherits
      case.
    sha: d9591d6e01cb9c358acfa4d641174d08e1f05b23
  - kind: verified
    text: >-
      Re-verified at 1400ec6 to cover the D89 amendment (head.js/headTags.js module split, syncTitle
      always-in + syncTags gated) appended to this card's body — prior stamp (d9591d6) predated that
      section. Confirmed syncTitle/syncTags exist as described.
    sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
---

# D84 — Route head management: reserved `meta` fields, SSG-first (v1.50)

Route `meta` grows four reserved head fields — `title` (existing),
`description`, `canonical`, `socialImage` — resolved per-field leaf→root and
rendered as managed head tags by BOTH the SSG shell injection and the SPA
navigation commit. One metadata contract, two delivery paths, with SSG as the
authoritative one (link-preview bots don't run the app). Closes the
"head-management API (per-route meta/og)" entry on §36's deferred list. See
[[DOC-SPEC]] §45.

## Context

SSG output today gets a `<title>` and nothing else: no description, no social
card, no canonical URL. `meta.title` is the only consumed key, resolved
nearest-defined leaf→root by `#setTitle` and mirrored by the prerender's
`resolveTitle`. Real sites need crawler-visible metadata in the generated
HTML, and the SPA side needs the same values kept true across client
navigation so titles/history entries/canonical state don't go stale.

## Decision

**Extend the existing route `meta` object — no second head DSL — with static
resolution rules and identity-marked managed tags.**

- **Fields (v1):** `title`, `description`, `canonical`, `socialImage`. Values
  are static strings or `null`. Each field resolves INDEPENDENTLY walking the
  destination chain leaf→root (the exact `#setTitle` walk); `undefined`
  inherits, `null` explicitly suppresses. No functions, no view/data-derived
  values, no raw HTML, no tag arrays. Custom `meta` keys remain untouched.
  Canonical is emitted as provided (callers supply absolute URLs).
  **Trimmed from the prompting proposal:** `robots` and `themeColor` — both
  are almost always shell-level constants; additive later if demanded.
- **Generated tags:** `title` → `<title>` + `og:title` + `twitter:title`;
  `description` → standard + `og:description` + `twitter:description`;
  `canonical` → `<link rel="canonical">` + `og:url`; `socialImage` →
  `og:image` + `twitter:image` + `twitter:card=summary_large_image`. Every
  managed tag carries `data-puzzle-head="<field>"` as its ownership marker —
  the framework only ever creates/updates/removes tags bearing it.
- **One resolver, two consumers** (`client-runtime/head.js`): the SSG pass
  resolves and string-injects into the shell (escaped; replace same-identity
  tags, insert the rest before `</head>`; narrow deterministic surgery, no
  HTML parser — the existing injectShell posture). The SPA side syncs managed
  nodes at the same commit-window point `#setTitle` occupies today, so head
  atomicity is inherited from D61: a failed/superseded navigation never
  touches the head. On hybrid takeover the SPA ADOPTS existing marker-bearing
  tags by identity — no duplicates.
- **Title semantics preserved byte-for-byte** for title-only apps: no title
  resolved anywhere → `document.title` untouched; memory mode remains a full
  document no-op (D42 — an embed must not touch the host page's head).

## Consequences

- Crawler- and unfurler-visible metadata lands in hybrid AND static output
  before any JS runs; SPA navigation keeps it truthful afterwards.
- Apps using managed fields should define root-route defaults so child routes
  can't leave stale inherited values — documented guidance, not enforced.
- `PrerenderedPage` gains `head` (existing `title` kept for compatibility);
  shell injectors accept it.

## Alternatives rejected

- A component-level `<Head>`/`<svelte:head>` equivalent — pulls head state
  into render trees, needs dedup/priority rules, and can't serve the SSG-first
  goal without running every component; route-level static data is the honest
  scope.
- Data-derived head values (functions of `data()`) — dynamic routes are
  skipped by SSG v1 anyway (no `staticPaths()` yet); a function surface would
  promise browser-only metadata that bots never see. Deferred with
  `staticPaths()`.
- Per-network override structures (og vs twitter variants) — YAGNI; the
  derived-tag mapping covers the 95% case.
- Arbitrary raw head HTML — an escaping/injection footgun with no resolution
  semantics.

## Amended by D89 — module split, title core vs managed tags

[[DECISION-D89-FEATURE-USAGE-TREESHAKE]] splits this feature across two modules
on a real seam. `head.js` keeps the pure resolver (`resolveHead`/`resolveField`,
the uniform null-suppression walk above) plus a one-line `syncTitle`;
`headTags.js` owns `MANAGED_TAGS`, the DOM `syncTags` loop, and `setTagValue`.
The router calls `syncTitle` unconditionally and `syncTags` behind
`__PUZZLE_HAS_HEAD_TAGS__`.

Two consequences beyond bundle size: a title-only app no longer runs ~10 no-op
`querySelector` probes per navigation (the tag loop previously ran for every
field, removing nothing), and the SSG string injector is unaffected — it imports
`MANAGED_TAGS` from `headTags.js` directly at build time, so prerendered head
tags are emitted regardless of the browser-side gate.

The gate's signal is deliberately coarse (a raw substring scan for
`description`/`canonical`/`socialImage`, since route `meta` lives in user JS the
compiler never parses). It is fail-safe — a false positive only leaves the module
in the bundle — and measured correct on all three real examples.
