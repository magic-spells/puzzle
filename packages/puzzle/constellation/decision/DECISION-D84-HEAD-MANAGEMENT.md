---
name: 'D84 — Route head management: reserved meta fields; managed tags are build-time only'
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D42-MEMORY-MODE
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - FILE-ROUTER
  - FILE-SSG-RUNTIME
  - FILE-HEAD-TAGS
  - TEST-PRERENDER-OUTPUT
  - FLOW-PRERENDER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/head.js
  - client-runtime/headTags.js
  - compiler/internal/build/route_head_warning.go
---

# D84 — Route head management: reserved `meta` fields; managed tags are build-time only

Route `meta` carries four reserved head fields — `title`, `description`,
`canonical`, `socialImage`. The prerender modes bake the managed tags into each
page's HTML; the browser only keeps `document.title` in sync. Spec:
[[DOC-SPEC-ROUTER]] §45.

## Decision

- **Values** are static strings or `null`. Each field resolves independently
  (`resolveHeadField` in `head.js`), walking the destination chain leaf → root:
  `undefined`/omitted inherits, explicit `null` stops the walk and suppresses. A
  resolved-null title leaves `document.title` / the shell `<title>` as they are
  (never blanked). No functions, data-derived values, raw HTML or tag arrays;
  other `meta` keys are untouched. Canonical is emitted as given (supply
  absolute URLs).
- **Generated tags:** `title` → `<title>` + `og:title` + `twitter:title`;
  `description` → `description` + `og:`/`twitter:description`; `canonical` →
  `<link rel="canonical">` + `og:url`; `socialImage` → `og:image` +
  `twitter:image` + `twitter:card=summary_large_image`. Each managed tag carries
  `data-puzzle-head="<field>"`; the framework only touches tags bearing it.
- **Build time** (`ssg/index.js` + `headTags.js`'s `MANAGED_TAGS`): the SSG
  resolves all fields (`resolveHead`) and string-injects the escaped tags into
  the shell — replace same-identity tags, insert the rest before `</head>`, no
  HTML parser. `headTags.js`, `resolveHead` and `HEAD_FIELDS` never reach a
  browser bundle (plain tree-shaking, no define).
- **Browser:** the router's `#syncHead` is
  `syncTitle(resolveHeadField(entry.chain, 'title'))` inside the D61 commit
  window, so a failed or superseded navigation never touches it. Ungated, every
  navigation, every mode except memory (D42 — an embed never touches the host's
  head). No title resolved → `document.title` untouched.
- **Crawlers never client-navigate**, so the baked per-page tags are what they
  read. After a client navigation in hybrid, managed tags in the live DOM keep
  navigation zero's values — pinned by `tests/router-head.test.js`. SEO is what
  the prerender modes are for.
- **Under `output: 'spa'`** `description`/`canonical`/`socialImage` are inert;
  `warnDeadSPARouteMeta` (`route_head_warning.go`) warns with file:line:col. It
  lexes only `app/**/routes.{js,ts}` (comment/string/regex/template aware,
  key-position match inside a `meta: { … }` object), so prose never trips it.

Root routes should set defaults so children can't inherit stale values
(guidance, not enforced).

## Alternatives

- **A `<Head>` component** — rejected: pulls head state into render trees,
  needs dedup rules, and can't serve SSG without running every component.
- **Data-derived head values** — deferred with `staticPaths()`: SSG skips
  dynamic routes, so bots would never see them.
- **Browser-side managed-tag sync, gated by a build-time usage scan** —
  removed: the substring scan was wrong both ways (`title`-derived `og:title`
  missed; a model field named `description` tripped it), and the sync served
  only in-page readers after client navigation, which are unsupported.
- **Suppress SSG tag injection when unused** — rejected: strips the tags
  crawlers actually read.
- **Per-network overrides, raw head HTML, `robots`/`themeColor`** — rejected
  (YAGNI / injection footgun / shell-level constants).
