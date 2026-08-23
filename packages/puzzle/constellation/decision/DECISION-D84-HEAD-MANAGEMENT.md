---
name: 'D84 — Route head management: reserved `meta` fields, SSG-first (v1.50)'
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D42-MEMORY-MODE
  - FILE-ROUTER
  - FILE-SSG-RUNTIME
  - FEATURE-V1-50-HEAD-MANAGEMENT
verified_at: '2026-08-23T19:55:26.372Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
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
`description`, `canonical`, `socialImage` — resolved per-field leaf→root, with
`document.title` assigned on every SPA navigation and the managed
`og:`/`twitter:`/description/canonical tags baked into each prerendered page at
build time. One metadata contract, no second head DSL. Closes the
"head-management API (per-route meta/og)" entry on §36's deferred list. See
[[DOC-SPEC-ROUTER]] §45.

## Context

SSG output without this gets a `<title>` and nothing else: no description, no
social card, no canonical URL. `meta.title` was the only consumed key. Real
sites need crawler-visible metadata in the generated HTML, and the SPA side
needs the tab title kept true across client navigation.

## Decision

**Extend the existing route `meta` object — no second head DSL — with static
resolution rules and identity-marked managed tags.**

- **Fields (v1):** `title`, `description`, `canonical`, `socialImage`. Values
  are static strings or `null`. Each field resolves INDEPENDENTLY walking the
  destination chain leaf→root (the `meta.title` walk); `undefined`
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
- **One resolver, two disjoint deliveries** (`client-runtime/head.js`): the
  SSG pass resolves and string-injects the managed tags into the shell
  (escaped; replace same-identity tags, insert the rest before `</head>`;
  narrow deterministic surgery, no HTML parser — the existing injectShell
  posture). The browser assigns `document.title` at the same commit-window
  point the pre-D84 title sync occupied, so head atomicity is inherited from
  D61: a failed or superseded navigation never touches it. The browser does
  **not** sync managed tags in any output mode — see the delivery section below.
- **Title semantics preserved byte-for-byte** for title-only apps: no title
  resolved anywhere → `document.title` untouched; memory mode remains a full
  document no-op (D42 — an embed must not touch the host page's head).

## Consequences

- Crawler- and unfurler-visible metadata lands in hybrid AND static output
  before any JS runs.
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
- A browser-side managed-tag sync, gated by a build define on feature usage —
  see the delivery section: crawlers never client-navigate, so the runtime
  loop removed nothing anyone could read, while costing per-navigation DOM
  probes and a coarse source scan to decide whether to ship it.

## Delivery: managed tags are build-time only

The feature is split across two modules on a real seam. `head.js` holds the
pure resolver (`resolveHead`/`resolveField`, the uniform null-suppression walk
above) plus the one-line `syncTitle`, and is the only half the browser runs.
`headTags.js` owns the `MANAGED_TAGS` table, and its sole consumer is the SSG
string injector (`ssg/index.js`), which reads it under Node at prerender time
([[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]], [[DECISION-D89-FEATURE-USAGE-TREESHAKE]]).
The router's `#syncHead` therefore does exactly
`syncTitle(resolveHead(entry.chain))` and nothing more, and no browser bundle
in any output mode contains `headTags.js` — plain tree-shaking, no build gate.

The reason there is one delivery path rather than two: crawlers and unfurlers
GET each URL fresh and never client-navigate, so the tags baked into a page are
always the copy they read. Only an in-page consumer querying
`document.head` AFTER a client navigation could observe a runtime rewrite, and
that is explicitly out of scope. Under `output: 'spa'`, which has no prerender
pass, `description`/`canonical`/`socialImage` are accepted but inert.

Everything above about resolution, null suppression, and the leaf→root walk is
unchanged by the split; only the delivery is single-pathed.
