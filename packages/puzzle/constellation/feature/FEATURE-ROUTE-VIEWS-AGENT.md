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

`checkAgentRoutes(entries, catchAll)` is called next to `warnShadowedPaths` inside the constructor's existing `__PUZZLE_DEV__` block. It validates every node's `agent` (catch-all included), then, only if some route declared one, warns once per duplicate resolved name and once with the list of leaves that resolve to `undefined`. Module-level functions and once-state, so production DCE drops them with the call.

The prerender is untouched: it never reads `agent`, and `routeEntries` is unchanged.

## Files

- `client-runtime/router/routeViews.js` — new: `routeViews`, `checkAgentRoutes`.
- `client-runtime/router/router.js` — import, `#views`, the `views` getter, the dev-check call.
- `types/index.d.ts` — `Route.agent`, `RouteAgent`, `RouteView`, `Router.views`.
- `tests/router-views.test.js` — entry shape, catch-all excluded, freezing and caching, title resolution (inherited, null-suppressed, `{ t }`), agent inheritance and re-exposure, navigation not blocked, each dev error and warning, silence without `agent`, nested layouts, lazy routes, locale prefix routing, prerender.
- `tests-types/consumer.ts` — `agent` values (and two rejected ones), reading `router.views`, read-only checks.

## Size

hello-world 23039 → 23148 bytes gzip (+109), todos 27207 → 27318 (+111). The dev check strings are absent from the production bundle.

## Proposed follow-up (not built)

Finding the current page's entry needs the consumer to match `router.current.path` against each `path`. The router already holds the committed leaf entry, so the smallest fix is a `view` field on the `router.current` snapshot: `this.views[this.#routes.indexOf(entry)]` (undefined on the catch-all). It is one property in the `current` getter but would build the `views` cache on first `current` read, so it was left for review.
