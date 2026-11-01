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
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D79 — Path-shaped template links: `router.url()` + the router-bound `link()` function

Templates write links path-shaped in every router mode: `href="{ link('/collections/' + c.id) }"`. Changing `routerMode` or `routerBase` needs no template edits, and no `#` appears in app code (D34). Spec: [[DOC-SPEC]] §6, §9, §15.

The href attribute is the one surface a click interceptor cannot repair: cmd-click, open-in-new-tab and copy-link read the attribute itself, so a plain `/x` href in a hash-routed app on a static host 404s. The encoding must happen at render time.

## Decision

- **`encodeURL(path, mode, base)`** (exported from `router/router.js`) is the single encoder; `Router.url(path)`, the static router stub and the hybrid prerender ctx all call it, so prerendered and client hrefs cannot drift. Path in, mode-encoded out: path routing (no mode object) → `base + path`; otherwise the mode object's `encode(path, base)` (D159) — hash → `'#' + base + path`, memory → unchanged.
- A string not starting with `/` passes through untouched (external URLs, `mailto:`, `#anchor`, already-encoded `#/x`, `''`) — the navigate-away escape hatch. Query/hash suffixes ride along. Non-string input to `router.url()` throws.
- **`link()` is registered by `makeFormatterRegistry`** from the app's live `url` encoder, **only if absent** — an app-supplied `link` wins (it is a PuzzleKit-only built-in, not a standard function). The closure reads the router lazily, so a re-mount never strands a stale one. Fail-soft: nullish → `''`, otherwise `url(String(value))`.
- Prerender and the static kernel wire the same registry, so prerendered hrefs match the client's.
- **Locale prefixes** ([[DECISION-D177-LOCALE-URL-PREFIXES]]): under `i18n.routing: 'prefix'`, `link(path)` / `router.url(path)` add the active locale's prefix. `link(path, { locale: 'es' })` encodes for that configured tag (case-insensitive; an unconfigured one throws a `RangeError`); `{ locale: false }` skips the prefix but keeps `routerBase` — for a file that exists once. `linkLocale` reads the option; **`localeBase(routerBase, locale, defaultLocale)`** composes the base, and all four encoders call it — `Router.url`, the router's write side, the static stub (`localizeRouterStub`) and the hybrid prerender's `url` shadow. A parity test pins them. Without prefix routing `link` ships the one-argument form (`__PUZZLE_HAS_LOCALE_ROUTING__`).

## Alternatives rejected

- **A `Link` component** — import ceremony, attr/class passthrough and slot forwarding to compute one attribute.
- **Compile-time href rewriting** — mode-dependent compiled output, and the compiler can't tell an in-app route from a deliberate document link.
- **Hash-mode interceptor claiming plain `/x` hrefs** — breaks the escape hatch and still leaves new-tab/copy-link wrong.
- **A pure tree-shaken built-in** — `link` needs the live router.
