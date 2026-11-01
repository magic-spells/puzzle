---
name: D183 — router.views and the agent route field
status: built
connections:
  - FILE-ROUTE-VIEWS
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - TEST-ROUTER-NAVIGATION
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D177-LOCALE-URL-PREFIXES
---

# D183 — router.views and the agent route field

## Context

A tool that describes an app to an agent (which pages exist, what they are called, which to keep out) has to read the route table. The Router's only route data is `routeEntries`, an untyped getter over the compiled matcher entries for build-time analysis. A consumer would re-walk each chain, re-resolve titles, and invent its own hide/describe flags in `meta`.

## Decision

**`router.views`** is a getter returning a frozen array of frozen entries, one per compiled leaf in declaration order. The catch-all is left out (it lives in `#catchAll`, never in `#routes`). It is built once per router, on first read (`this.#views ??= routeViews(this.#routes)`):

- `path`: the leaf's full pattern (`'/:workspace/tasks/:taskId'`), base- and locale-free like every other router path (D51, D177).
- `params`: the pattern's `:param` names, in order (a frozen copy).
- `name`: the leaf route's `name`.
- `meta`: the leaf's own `meta` object, as defined. Not inherited, not frozen.
- `title`: `meta.title` resolved leaf→root by `resolveHeadField`, the tab-title resolver (D84): a string, `{ t }`, or `undefined`. An explicit `null` suppression reads as `undefined`.
- `agent`: the resolved `agent` field (below), or `undefined`.
- `chain`: the route definitions root→leaf (a frozen copy of the array; the definitions themselves are the app's objects).

The current page's entry is found by identity: `router.views.find((v) => v.chain.at(-1) === router.current.route)` (no match on the catch-all).

**`agent`** is a top-level route field, a sibling of `guard`/`layout`/`transitionMode`, per D87's rule that framework flags are top-level and `meta` is the app's:

- `agent: false` hides a route; on a parent it hides the subtree.
- `agent: { name, about }` names and describes a page (`about` optional). Other keys are allowed, typed `unknown`, and passed through.
- **Precedence: nearest-defined, leaf→root.** The first level, walking up from the leaf, whose `agent` is not `undefined` decides. A child's own object re-exposes it under a hidden parent, a child's `false` hides it under a described parent, and a parent's object is inherited by every child that sets nothing. Several leaves inheriting one object share its name; that is one described section, not a conflict.
- Puzzle never acts on it. Navigation does not block a hidden route, and the prerender ignores the field. Consumers filter `router.views`.

**Development checks** (`checkAgentRoutes`, called beside `warnShadowedPaths` in the Router constructor's `__PUZZLE_DEV__` block, so production drops them):

- An `agent` value that is not `false` and not an object with a string `name` (and, if present, a string `about`) throws, on any node of any chain, the catch-all included: `[puzzle] agent on route "x" must be false or { name: string, about?: string } (got …)`.
- A name declared by two or more *different* agent objects warns once per name, listing every leaf path that resolves to it. Leaves sharing one inherited object never warn.
- Once any route declares `agent`, one warning lists the leaves whose resolved value is `undefined`. An app that never uses the field gets no warning.

The warnings print once per module (per name for duplicates), so the SSG pass building several routers prints each once.

`client-runtime/router/routeViews.js` holds `routeViews` and `checkAgentRoutes`; tests are in `tests/router-views.test.js`.

## Alternatives rejected

- **Flags in `meta` (`meta.agent`, `meta.view`, `meta.about`)**: D87 keeps framework-read fields top-level; `meta` is free-form app data, and a framework reading names out of it would collide with apps already using those keys.
- **Leaf-only `agent`**: hiding an admin area would mean flagging every leaf, and a new child route would silently appear.
- **Parent `false` as absolute**: a public help page under a hidden section would need the route tree restructured.
- **Enforcing `agent: false` on navigation**: it is a description for tools, not access control; guards (D87) own navigation.
- **Publishing `routeEntries` instead**: those are mutable matcher internals (regexes, lazy state); a typed, frozen projection lets the internals change.
- **Building the array per read, or eagerly in the constructor**: per-read allocates on every poll; eager costs every app that never reads it.
- **A `view` field on the `router.current` snapshot**: `current` is read on every navigation by router and app internals, so it would build the views table in every routed app. The identity lookup costs nothing until a tool asks; a separate lazy getter is the shape to add if a shortcut proves wanted.
- **Warning on any repeated name**: a parent's object inherited by its children is the normal way to describe a section; only distinct objects reusing a name are a mistake.
- **Production validation**: the route table is static, the first dev run catches a bad value, and the message would ship in every bundle.

## Consequences

Tools read one typed, frozen list instead of router internals, and an app's agent map is checked by the framework in development rather than by an app test. The getter, its cache field and `routeViews()` ship in every routed app; the checks do not.
