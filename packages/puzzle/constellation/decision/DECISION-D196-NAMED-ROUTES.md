---
name: D196 — Named route targets for link(), url(), push() and replace()
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-FORMATTERS
  - COMPONENT-SSG
  - FILE-ROUTER
  - FILE-ROUTE-NAMES
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-RUNTIME
  - FILE-STATIC-MOUNT
  - FILE-TESTING
  - DOC-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-RELEASE-SURFACE
  - DECISION-D79-LINK-FUNCTION
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D182-NAVIGATION-RESULT
verified_at: '2026-11-21T22:33:06.881Z'
verified_sha: c4c10f303caeac8050633ea434af17e4d3a75001
---

# D196 — Named route targets for `link()`, `url()`, `push()` and `replace()`

## Context

Routes already take a `name`, but it was informational: every link and navigation spelled the path out (`link('/albums/' + album.id)`). Moving a route meant finding every string that built its URL, and a typo built a URL no route matched. Cory asked for named routes alongside paths: "if we can support both, then I feel like that's fine."

## Decision

- **One target shape.** `router.url()` (so the `link` library function), `router.push()`, `router.replace()` and a guard's redirect verdict take `{ name, params?, query?, hash? }` as well as a path string. Path strings keep working exactly as before. `router.prefetch()` takes a path string only.
- **One resolver.** `client-runtime/router/routeNames.js` turns a named target into the path string, and every caller then runs the path form unchanged: encoding, `routerBase`, the locale prefix (`link(target, { locale })` composes), the same-path no-op, guards. It is DOM-free and shared by the live Router, the hybrid prerender's `url()` shadow, the static router stub and the static page kernel, so a prerendered href and the browser's re-render cannot disagree.
- **The table.** Every route node with a string `name` registers its full path, parents and `path: ''` index children included, so nested routes resolve by full path. The `'*'` route is in the table with no URL. In development a name used by two nodes throws when the Router is constructed; production keeps the first.
- **Params.** Each whole `:param` segment is filled with `encodeURIComponent(String(value))`; the matcher's `decodeURIComponent` gives `data({ params })` the value back. `query` builds through `URLSearchParams` (an array repeats its key, `null`/`undefined` are dropped); `hash` takes `'faq'` or `'#faq'`.
- **Errors throw**, tagged `[puzzle]` and naming the route: an unknown name (development lists the named routes), the catch-all's name, a missing or empty param, and in development a param the pattern lacks or a key other than the four. `push()`/`replace()` throw synchronously on a bad target instead of resolving a `NavigationResult` ([[DECISION-D182-NAVIGATION-RESULT]] covers navigations, and a bad target is a coding error that never starts one). A bad target returned by a guard is a guard throw ([[DECISION-D87-ROUTE-GUARDS]]).
- **`link`** passes a plain object (`value.constructor === Object`) to `url()` and stringifies every other value, so a number, an array or a `URL` object renders as a path string. Without a router (the app before start) a named target renders `''`; `mountView`'s inert router throws and tells the test to pass a router.
- **Static output.** A static page ships no route table. The prerender's stub resolves names against the app's table and records that it did; a page that resolved a named target, or a `prerender: false` page of an app that names a route, carries the table as `<script type="application/json" data-puzzle-static-names>`. The kernel reads it lazily on the first named link and throws a clear error when it is missing. Pages without a named link carry no table.
- **Not built:** a `puzzle check` error for an unknown name. Routes are runtime JavaScript (often composed or imported), and a template link's argument is an arbitrary expression, so a check would either miss most cases or flag good ones. The runtime throw, and the build failure a prerender turns it into, catch the mistake instead.

## Alternatives rejected

- **A name string as the first argument** (`link('album', { id })`): it collides with a relative path and with D177's `{ locale }` second argument.
- **A `<Link>` component**: D79 chose plain `<a href="{ link(…) }">` so new-tab and copy-link work and no component ships.
- **Typed route names**: needs a generated declaration of the app's route table; out of scope for a runtime feature, and `params` stays loosely typed (`string | number`) until then.
- **Shipping the name table in every static page entry**: it costs every static page bytes to serve the few that link by name.

## Consequences

- Moving a route's path changes no named link.
- The live router builds one `Map` at construction; production cost is the resolver module: about 500 bytes gzip on hello-world and todos, whether or not an app names a route.
