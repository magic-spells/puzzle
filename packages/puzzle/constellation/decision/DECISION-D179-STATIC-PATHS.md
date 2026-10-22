---
name: 'D179 — staticPaths: prerendering parameterised routes from a build-time list'
status: built
connections:
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D177-LOCALE-URL-PREFIXES
  - COMPONENT-SSG
  - FILE-STATIC-MOUNT
  - DOC-SPEC-BUILD
  - DOC-SPEC-ROUTER
---

# D179 — `staticPaths`

Shipped in 0.9.0 (PR #216).

## Context

The prerender skipped every route with a `:param` (with a warning), because it
cannot know which values exist. "Static site" mostly means blogs, docs and
product pages, so `/blog/:slug` is exactly the route people need prerendered —
and with locale prefixes ([[DECISION-D177-LOCALE-URL-PREFIXES]]) a multilingual
blog would otherwise get its fixed pages translated and none of its posts.

Everything else already existed: the prerender runs each page's `data()` in
Node, store reads that miss are fetched through the app's adapter, and the
page carries the build's read state.

## Decision

A route may declare `staticPaths`, in the route table (`app/routes.js`):

```js
{
  path: '/blog/:slug',
  view: BlogPost,
  staticPaths: async ({ store }) => {
    const posts = await store.loadMany('post');
    return posts.map((post) => ({ slug: post.slug }));
  },
}
// shorthand: one page per record of a model, params read from its fields
{ path: '/principles/:id', view: Principle, staticPaths: 'principle' }
```

- **Value**: an array, a function (sync or async) returning one, or a model
  name. Each entry is an object with every param in the route's full path. The
  function gets `{ store, config, locale? }` on its own context and runs after
  `beforeMount`. Types: `StaticPathsEntry`, `StaticPathsContext`,
  `StaticPathsFn`.
- **Leaf routes only.** `staticPaths` on a route with children, or on a route
  with no `:param`, is a build error. The router has no wildcard or optional
  params; the bare `*` catch-all has no `:param` and so errors too.
- **Model shorthand**: an unregistered model, or a param with no matching
  field in the model's schema, is a build error (a model with no schema skips
  the field check). `store.loadMany(model)` is called only when an adapter is
  configured and the model has a bound `loadMany`; then `store.findMany(model)`
  is read, so records seeded in `beforeMount` count either way. Records with an
  empty or nullish field are skipped with one warning per route.
- **Build only.** The browser never calls it. It runs once per prerender pass,
  so once per locale under prefix routing — a site may list different posts
  per language.
- **One page per entry**, rendered like a fixed route with those params:
  `dist/blog/cookies/index.html`, `dist/es/blog/cookies/index.html`.
- **Values**: strings (numbers converted); `%` and `\` are escaped inside the
  value, then the router's `encodeURL` runs, so `a b` → `a%20b`, `é` →
  `%C3%A9`, and the matcher decodes each back. A value equal to `.` or `..`,
  or containing `/`, `?` or `#`, is a build error naming route, entry, param
  and value ("slugify it") — hosts decode those before the file lookup, and
  dot segments would overwrite other pages.
- **Errors and warnings**: an entry missing a param is a build error naming the
  route. Duplicates render once, with a warning. An empty list renders nothing
  (skip reason `'empty staticPaths'`). A parameterised route without
  `staticPaths` keeps the skip warning, which names the field.
- **Static output**: all pages of a route share one page module, slug
  `blog--_slug` (`:` becomes `_`, which Windows file names allow). Each page
  carries `<script type="application/json" data-puzzle-static-route>` with its
  path and params; the generated entry merges it into the route JSON for these
  routes only, and the kernel threads `route.params` into the route snapshot
  and every `preload` without reading `location`. Fixed-route modules are
  byte-identical; the shared kernel chunk grew 16 B gzip. An unlisted value is
  a 404.
- **Hybrid output**: an unlisted value still works — the SPA shell takes over
  and fetches in the browser. A generated path that an earlier route matches
  first in the live router is skipped with reason `shadowed` and a warning, so
  takeover never renders a different view than the prerender.
- **Collisions** with a fixed route's page: in static output the fixed route
  wins its file, with a warning; in hybrid a fixed route declared after the
  `:param` route is already skipped as shadowed.
- **Locales** (D177): `hreflang` alternates, the first-visit redirect script
  and the sitemap list only the locales whose lists contain the page; a page
  only the default locale has gets no redirect script.
- **Prerender structure** (`client-runtime/ssg/index.js`): `planRoutes` makes
  each route's skip/reuse/shell/render decision once, then each locale runs
  `entriesFor` → `renderEntry`. Pages carry a `pattern` in the summary; the Go
  dev route graph keys generated pages by it.
- **Dev rebuilds** ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]): a
  `staticPaths` route outside `only` still re-runs its list (and so
  `beforeMount`) to enumerate the reused pages — the one exception to D155's
  skip. A new entry has no last-good page and falls back to a full render; a
  removed entry is dropped. A throwing list fails the rebuild naming the
  route.

## Alternatives rejected

- **File-based enumeration** (a page per file on disk) — D67 rejected
  file-based routing.
- **A list in `puzzle.config.js`** — the config is read by the Go build, away
  from the route it describes, and cannot use the app's store or adapter.
- **Crawling links from rendered pages** — misses unlinked pages and makes the
  output depend on render order.
- **A content pipeline (Markdown collections)** — a separate feature; this is
  only the enumeration hook it would build on.
- **Writing `/ ? #` values as escaped file names** — no static host serves
  them; a build error with a slugify hint is honest.

## Consequences

- The output is a snapshot: new content needs a rebuild.
- The data source must be reachable from the build machine.
- Each page runs its own `data()` on a fresh store, so per-page fetches
  multiply by pages × locales.
- Route `meta` (title, canonical) is static per route, so all pages of a route
  share it unless `data()`-driven head work is added later.
- `i18n.locales[].href` on a page that exists in only some locales still links
  the missing ones; a switcher there shows dead links.
- In SPA and hybrid apps the route table ships to the browser, and so does
  anything `staticPaths` imports at module level. Keep the list source behind
  a `fetch` or an `await import()` inside the function; `output: 'static'`
  ships no route table and is unaffected.
- Example: `examples/static-docs` `/principles/:id` uses the shorthand;
  `tests/static-docs-example.test.js` runs a built generated page.
