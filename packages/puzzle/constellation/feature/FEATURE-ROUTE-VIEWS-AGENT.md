---
name: router.views and the agent route field
status: built
release: RELEASE-V0-9-0
change: feature
branch: feat/route-views-agent
connections:
  - DECISION-D183-ROUTE-VIEWS-AGENT-FIELD
  - FILE-ROUTE-VIEWS
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - TEST-ROUTER-NAVIGATION
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D177-LOCALE-URL-PREFIXES
---

# router.views and the agent route field

Part of the 0.9.0 agent-API round. An agent kit listed an app's pages by walking `router.routeEntries` and reading leaf `meta` flags, with an app-side test to catch undescribed routes. Decision record: [[DECISION-D183-ROUTE-VIEWS-AGENT-FIELD]].

## Design

`client-runtime/router/routeViews.js` owns both halves. `routeViews(entries)` maps the router's compiled leaf entries to frozen `{ path, params, name, meta, title, agent, chain }` records; `title` goes through `resolveHeadField` (null → `undefined`) and `agent` through a nearest-defined leaf→root walk.

The Router adds one private field and one getter: `get views() { return (this.#views ??= routeViews(this.#routes)); }`. The catch-all lives in `#catchAll`, never in `#routes`, so it is left out for free.

`checkAgentRoutes(entries, catchAll)` is called next to `warnShadowedPaths` inside the constructor's existing `__PUZZLE_DEV__` block. It validates every node's `agent` (catch-all included). Then, only if some route declared one, it groups leaves by resolved name, collecting the distinct agent objects behind each, and warns once per name declared by more than one object, listing every path; leaves inheriting one parent object never warn. A last warning lists the leaves that resolve to `undefined`. Module-level functions and once-state, so production DCE drops them with the call.

The prerender is untouched: it never reads `agent`, and `routeEntries` is unchanged.

## Current page

A consumer finds the current page's entry by identity, with no path matching: `router.views.find((v) => v.chain.at(-1) === router.current.route)` (undefined on the catch-all).

## Files

- `client-runtime/router/routeViews.js` — new: `routeViews`, `checkAgentRoutes`.
- `client-runtime/router/router.js` — import, `#views`, the `views` getter, the dev-check call.
- `types/index.d.ts` — `Route.agent`, `RouteAgent` (extra keys `unknown`), `RouteView`, `Router.views`.
- `tests/router-views.test.js` — entry shape, catch-all excluded, freezing and caching, title resolution (inherited, null-suppressed, `{ t }`), agent inheritance and re-exposure, navigation not blocked, each dev error and warning (duplicate names across distinct objects, no warning for one inherited object), silence without `agent`, nested layouts, lazy routes, locale prefix routing, prerender.
- `tests-types/consumer.ts` — `agent` values (an extra key, and two rejected values), reading `router.views`, read-only checks.

## Size

hello-world 23039 → 23148 bytes gzip (+109), todos 27207 → 27318 (+111). The dev check strings are absent from the production bundle.
