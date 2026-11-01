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
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D42-MEMORY-MODE
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - FILE-ROUTER
  - FILE-SSG-RUNTIME
  - FILE-HEAD-TAGS
  - TEST-PRERENDER-OUTPUT
  - FLOW-PRERENDER
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/head.js
  - client-runtime/headTags.js
  - compiler/internal/build/route_head_warning.go
---

# D84 — Route head management: reserved `meta` fields; managed tags are build-time only

Route `meta` carries four reserved head fields — `title`, `description`, `canonical`, `socialImage`. The prerender modes bake the managed tags into each page's HTML; the browser only keeps `document.title` in sync. Spec: [[DOC-SPEC-ROUTER]] §45.

## Decision

- **Values** are static strings or `null`; `title` and `description` may also be a translation reference `{ t: 'key' }` ([[DECISION-D177-LOCALE-URL-PREFIXES]]), resolved by `headText(value, i18n)` in `head.js` through the app's (or prerender pass's) i18n service. No functions, data-derived values, raw HTML or tag arrays; other `meta` keys are untouched.
- **Resolution:** each field resolves independently (`resolveHeadField`), walking the destination chain leaf → root: `undefined`/omitted inherits, explicit `null` stops the walk and suppresses. A resolved-null title leaves `document.title` / the shell `<title>` as they are (never blanked).
- Canonical is emitted as given (supply absolute URLs); under locale prefix routing a root-relative or same-origin canonical is localized per page.
- **Generated tags:** `title` → `<title>` + `og:title` + `twitter:title`; `description` → `description` + `og:`/`twitter:description`; `canonical` → `<link rel="canonical">` + `og:url`; `socialImage` → `og:image` + `twitter:image` + `twitter:card=summary_large_image`. Each carries `data-puzzle-head="<field>"`; the framework only touches tags bearing it.
- **hreflang alternates** (prefix routing only): `<link rel="alternate" hreflang>` per locale plus `x-default`, tagged `data-puzzle-head="alternate"` — a managed *set*: every shell alternate is stripped and the page's own set inserted.
- **Build time** (`ssg/index.js` + `headTags.js`'s `MANAGED_TAGS`): the SSG resolves all fields (`resolveHead`) and string-injects the escaped tags into the shell — replace same-identity tags, insert the rest before `</head>`, no HTML parser. `headTags.js`, `resolveHead` and `HEAD_FIELDS` never reach a browser bundle (plain tree-shaking).
- **Browser:** the router's `#syncHead` is `syncTitle(headText(resolveHeadField(entry.chain, 'title'), i18n))` inside the D61 commit window, so a failed or superseded navigation never touches it (`headText` only behind `__PUZZLE_HAS_I18N__`). Every navigation, every mode except memory (D42 — an embed never touches the host's head). The static kernel syncs a `{ t }` title on load and after a locale remount.
- **Crawlers never client-navigate**, so the baked per-page tags are what they read. After a client navigation in hybrid, managed tags in the live DOM keep navigation zero's values — pinned by `tests/router-head.test.js`.
- **Build warnings** (`route_head_warning.go`, lexing only `app/**/routes.{js,ts}` — comment/string/regex/template aware, key-position match inside `meta: { … }`, so prose never trips them): in plain SPA output (no `output` set) `description`/`canonical`/`socialImage` are inert and `warnDeadSPARouteMeta` says so with file:line:col; a `{ t }` head value in a project with no `i18n` block warns in every mode (`warnUntranslatedRouteMeta`) — at runtime it prints nothing and warns once in dev.

## Alternatives rejected

- **A `<Head>` component** — pulls head state into render trees, needs dedup rules, and can't serve SSG without running every component.
- **Browser-side managed-tag sync** (gated by a build-time usage scan) — the scan was wrong both ways (`title`-derived `og:title` missed; a model field named `description` tripped it), and it served only in-page readers after client navigation, which are out of scope.
- **Suppress SSG tag injection when unused** — strips the tags crawlers actually read.
- **Per-network overrides, raw head HTML, `robots`/`themeColor`** — YAGNI / injection footgun / shell-level constants.
- **Data-derived head values** — not built: every page a `staticPaths` route generates (D179) shares the route's static `meta`.
