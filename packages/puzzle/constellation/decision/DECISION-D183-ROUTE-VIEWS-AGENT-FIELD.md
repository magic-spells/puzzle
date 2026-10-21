---
name: D183 — router.views and the agent route field
status: built
connections:
  - FEATURE-ROUTE-VIEWS-AGENT
  - FILE-ROUTE-VIEWS
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D177-LOCALE-URL-PREFIXES
---

## Context

A tool that describes an app to an agent (which pages exist, what they are called, which to keep out) has to read the route table. The only route data on the Router was `routeEntries`, an untyped getter returning the compiled matcher entries for build-time analysis. A consumer re-walked each entry's chain itself, re-resolved titles, and kept hide/describe flags in `meta` under its own names, with an app-side test to catch a leaf that said neither.

## Decision

**`router.views`** is a getter returning a frozen array of frozen entries, one per compiled leaf in declaration order. The catch-all is left out. It is built once per router, on first read, from the compiled entries:

- `path` — the leaf's full pattern (`'/:workspace/tasks/:taskId'`), base- and locale-free like every other router path (D51, D177).
- `params` — the pattern's `:param` names, in order (a frozen copy).
- `name` — the leaf route's `name`.
- `meta` — the leaf's own `meta` object, as defined. It is not inherited and not frozen.
- `title` — `meta.title` resolved leaf→root by `resolveHeadField`, the tab-title resolver (D84): a string, `{ t }`, or `undefined`. An explicit `null` suppression reads as `undefined`.
- `agent` — the resolved `agent` field (below), or `undefined`.
- `chain` — the route definitions root→leaf (a frozen copy of the array; the definitions themselves are the app's objects).

**`agent`** is a top-level route field, a sibling of `guard`/`layout`/`transitionMode`, per D87's rule that framework flags are top-level and `meta` is the app's:

- `agent: false` hides a route; on a parent it hides the subtree.
- `agent: { name, about }` names and describes a page (`about` optional). Other keys are allowed and passed through.
- **Precedence: nearest-defined, leaf→root.** The first level, walking up from the leaf, whose `agent` is not `undefined` decides. A child's own object therefore re-exposes it under a hidden parent, a child's `false` hides it under a described parent, and a parent's object is inherited by every child that sets nothing — so two such children share one name.
- Puzzle never acts on it. Navigation does not block a hidden route, and the prerender and SSG ignore the field. Consumers filter `router.views`.

**Development checks**, run once in the Router constructor behind `__PUZZLE_DEV__` (zero production bytes):

- An `agent` value that is not `false` and not an object with a string `name` (and, if present, a string `about`) throws, on any node of any chain, the catch-all included: `[puzzle] agent on route "x" must be false or { name: string, about?: string } (got …)`.
- A resolved name used by two leaves warns once.
- Once any route declares `agent`, one warning lists the leaves whose resolved value is `undefined`. An app that never uses the field gets no warning.

The warnings are once per message for the module, so the SSG pass building several routers prints each once.

## Alternatives rejected

- **Flags in `meta` (`meta.agent`, `meta.view`, `meta.about`)** — D87 keeps framework-read fields top-level; `meta` is free-form app data, and a framework reading names out of it would collide with apps already using those keys.
- **Leaf-only `agent`** — hiding an admin area would mean flagging every leaf, and a new child route would silently appear.
- **Parent `false` as absolute** — a public help page under a hidden section would need restructuring the route tree.
- **Enforcing `agent: false` on navigation** — it is a description for tools, not access control; guards (D87) own navigation.
- **Publishing `routeEntries` instead** — those are mutable matcher internals (regexes, lazy state); a typed, frozen projection lets the internals change.
- **Building the array per read, or eagerly in the constructor** — per-read allocates on every poll; eager costs every app that never reads it.
- **Production validation** — the route table is static and the first dev run catches a bad value; the message would ship in every bundle.

## Consequences

Tools read one typed, frozen list instead of reaching into router internals, and an app's agent map is checked by the framework in development rather than by an app test. The getter, the cache field and `routeViews()` ship in every routed app (about +110 bytes gzip); the checks do not. Finding the entry for the current route still means matching `router.current` against `path`; see the FEATURE card for the proposed follow-up.
