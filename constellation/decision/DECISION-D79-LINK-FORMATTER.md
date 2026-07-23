---
name: 'D79 — Path-shaped template links: `router.url()` + the router-bound `link` formatter (v1.46)'
status: built
connections:
  - COMPONENT-ROUTER
  - COMPONENT-FORMATTERS
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC
  - DOC-ROUTER
  - DECISION-D34-HASH-ROUTING
  - DECISION-D51-ROUTER-BASE-PATH
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - FILE-ROUTER
  - FILE-FORMATTER-REGISTRY
---

# D79 — Path-shaped template links: `router.url()` + the router-bound `link` formatter (v1.46)

Template hrefs become path-shaped and mode-agnostic: `router.url(path)` encodes
a path-shaped route into the mode-appropriate href (`/x` history with base
prefix, `#/x` hash with in-fragment base, unchanged in memory), and a built-in
`link` formatter — `href="{ '/collections/' + c.id | link }"` — exposes it to
templates. Closes the one seam where [[DECISION-D34-HASH-ROUTING]]'s "no `#`
ever appears in app code" was not yet true. See [[DOC-SPEC]] §6, §9, §15.

## Context

D34 made the router *API* path-shaped in every mode — `push('/user/123')`,
route defs, `current.path`, params never see a `#` — but `<a href>` in
templates still had to hand-write the mode-specific shape: `href="#/library"`
in hash mode, base-prefixed `href="/app/library"` under a history-mode
`routerBase` ([[DECISION-D51-ROUTER-BASE-PATH]] deliberately left the base to
"the URL and `<a href>`"). Switching `routerMode` or `routerBase` therefore
meant rewriting every link in every template — the opposite of D34's one-line
mode change. The href attribute is also the one place a runtime click
interceptor cannot fix after the fact: cmd-click, open-in-new-tab, and
copy-link read the attribute itself, so a plain `/x` href in a hash-mode app
on a static host 404s no matter what the interceptor does with a left-click.

## Decision

**A runtime-only pair: a `Router.url(path)` primitive plus a built-in `link`
formatter registered by `PuzzleApp` at mount, after the router exists.**
Sub-decisions, each with its rejected alternative:

- **`router.url(path)` is the render-time inverse of the interceptor/URL
  parsing.** Path-shaped in, mode-encoded href out: history → `base + path`,
  hash → `'#' + base + path`, memory → unchanged (no URL carrier; the
  interceptor already treats memory like base-less history). A string not
  starting with `/` passes through untouched (external URLs, `mailto:`, bare
  `#anchor`, already-encoded `#/x`, `''`) — the escape hatch for genuine
  navigate-away links stays free. Non-string input is a `[puzzle]` throw
  (fail-fast API); query/anchor suffixes ride along by construction (pure
  prefixing, symmetric with `#currentPath`).
- **A formatter, not a `Link` component.** A component that exists to compute
  one attribute needs import ceremony in every `.pzl`, attr/class passthrough,
  and slot forwarding — and the interceptor already owns the click side.
  `{ path | link }` parses in attribute values today (the attribute
  mini-grammar shares `parseInterpolationExpr`), is explicit at the use site,
  and composes with plain JS expressions. **Rejected.**
- **Not a compile-time rewrite.** The Go build does load the config, but
  rewriting hrefs at codegen would make compiled output mode-dependent
  (forking golden files, `pzlc` single-file compiles, and pre-compiled
  components per mode), and the compiler cannot distinguish an in-app route
  from a deliberate same-host document link. Render functions stay
  mode-agnostic; the mode is resolved at render time. **Rejected.**
- **Registered by the app, not shipped as a pure built-in.** Built-ins are
  pure named exports fed through the D31 tree-shake manifest; `link` needs the
  live router. `PuzzleApp.mount()` registers it right after constructing the
  router — **only if absent**, so a user-supplied `link` in
  `config.formatters` wins (the same if-absent idiom as the required
  built-ins). The closure reads `this.router` off the app lazily, so
  unmount/re-mount never strands a stale router. The D31 scanner ignores the
  name (not on the built-ins allowlist — same handling as any custom
  formatter), and the D43 guard means templates using `| link` on an older
  runtime degrade to pass-through with one console.error instead of crashing.
- **Formatter body is fail-soft, per formatter convention.** Nullish → `''`,
  non-strings coerced via `String()` then passed through `url()` (a coerced
  non-path like `'5'` doesn't start with `/` and passes through). The throw
  lives only on the direct `router.url()` API.
- **The hash-mode interceptor does NOT start claiming plain `/x` hrefs.**
  Auto-intercepting would silently break the navigate-away escape hatch and
  still leave the attribute wrong for new-tab/copy-link (above). Fixing the
  attribute at render time is the only correct place. **Rejected.**

## Consequences

- App templates can be written path-shaped in every mode; `routerMode` and
  `routerBase` become one-line config changes with **no template edits** —
  D34's §15 claim ("no `#` ever appears in app code") now covers hrefs too,
  and D51's base-prefixing chore in history mode disappears behind the same
  formatter.
- SSG inherits the behavior for free: prerender runs the same
  `PuzzleApp.mount()` wiring, so static HTML gets correctly-shaped hrefs from
  the app's real config.
- No compiler change of any kind; no config-surface change (§2 untouched).
  Amends §6 (built-in formatter list), §9 (router surface), §15 (link
  seam) — additive, v1.46.
- `examples/music` (the hash-mode acceptance example) is converted to
  `| link` links and is now mode-portable, serving as the acceptance case.

## Alternatives rejected

- `Link` component — 10x the surface of a formatter for one attribute; fights
  Puzzle's plain-HTML ethos.
- Compile-time href rewriting — mode-dependent compiled output; cannot
  classify in-app vs navigate-away links; forks goldens/`pzlc`.
- Auto-intercepting plain `/x` hrefs in hash mode — breaks the escape hatch,
  cannot fix new-tab/copy-link.
- Shipping `link` as a pure tree-shaken built-in — needs the live router;
  built-ins are pure by contract (D31).
