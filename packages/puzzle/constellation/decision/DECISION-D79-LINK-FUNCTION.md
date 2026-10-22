---
name: 'D79 — Path-shaped template links: router.url() + the router-bound link() function'
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-FORMATTERS
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DECISION-D34-HASH-ROUTING
  - DECISION-D51-ROUTER-BASE-PATH
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - FILE-ROUTER
  - FILE-FORMATTER-REGISTRY
  - COMPONENT-SSG
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D79 — Path-shaped template links: `router.url()` + the router-bound `link()` function

Templates write links path-shaped in every router mode:
`href="{ link('/collections/' + c.id) }"`. Changing `routerMode` or `routerBase`
needs no template edits, and no `#` appears in app code (D34). Spec:
[[DOC-SPEC]] §6, §9, §15.

## Context

The href attribute is the one surface a click interceptor cannot repair:
cmd-click, open-in-new-tab and copy-link read the attribute itself, so a plain
`/x` href in a hash-mode app on a static host 404s. The encoding must happen at
render time.

## Decision

- **`encodeURL(path, mode, base)`** (exported from `router/router.js`) is the
  single encoder; `Router.url(path)`, the static router stub and the hybrid
  prerender ctx all call it (copies drifted before and emitted unprefixed
  prerendered hrefs under `routerBase`). Path-shaped in, mode-encoded out:
  history → `base + path`, hash → `'#' + base + path`, memory → unchanged.
  A string not starting with `/` passes through (external URLs, `mailto:`,
  `#anchor`, already-encoded `#/x`, `''`) — the navigate-away escape hatch.
  Query/hash suffixes ride along. Non-string input to `router.url()` throws.
- **`link()` is registered by `makeFormatterRegistry`** from the app's live
  `url` encoder, **only if absent** — an app-supplied `link` wins (overriding it
  is ordinary; it is a PuzzleKit-only built-in, not a standard name). The closure
  reads the router lazily, so re-mount never strands a stale one. The body is
  fail-soft: nullish → `''`, otherwise `url(String(value))`.
- Prerender and the static kernel wire the same registry, so prerendered hrefs
  match the client's.
- **Locale prefixes** ([[DECISION-D177-LOCALE-URL-PREFIXES]]): under
  `i18n.routing: 'prefix'` `link(path)` / `router.url(path)` add the active
  locale's prefix. `link(path, { locale: 'es' })` encodes for that configured
  tag (matched case-insensitively; an unconfigured one throws a `RangeError`);
  `{ locale: false }` skips the prefix and keeps `routerBase` — for a file that
  exists once. `linkLocale` reads the option; **`localeBase(routerBase, locale,
  defaultLocale)`** composes the base, and all four encoders call it —
  `Router.url`, the router's write side (its composed `#base`), the static stub
  (`localizeRouterStub`) and the hybrid prerender's `url` shadow. A parity test
  pins them. Without prefix routing `link` ships the one-argument form and the
  options are not read.

## Alternatives

- **A `Link` component** — rejected: import ceremony, attr/class passthrough and
  slot forwarding to compute one attribute.
- **Compile-time href rewriting** — rejected: mode-dependent compiled output,
  and the compiler can't tell an in-app route from a deliberate document link.
- **Hash-mode interceptor claiming plain `/x` hrefs** — rejected: breaks the
  escape hatch and still leaves new-tab/copy-link wrong.
- **A pure tree-shaken built-in** — rejected: `link` needs the live router.
