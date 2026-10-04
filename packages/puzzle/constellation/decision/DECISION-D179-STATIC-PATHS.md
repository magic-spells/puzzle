---
name: 'D179 — staticPaths: prerendering parameterised routes from a build-time list'
status: planned
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

## Context

The prerender skips every route with a `:param` (with a warning), because it
cannot know which values exist. "Static site" mostly means blogs, docs and
product pages, so `/blog/:slug` is exactly the route people need prerendered —
and with locale prefixes ([[DECISION-D177-LOCALE-URL-PREFIXES]]) a multilingual
blog would otherwise get its fixed pages translated and none of its posts.

Everything else already exists: the prerender runs each page's `data()` in
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
```

- **Value**: an array, or a function (sync or async) returning one. Each entry
  is an object with **every param in the route's full path**, inherited ones
  included. The function receives the same build facade as `beforeMount`
  (`{ store, config, locale }`) and runs after `beforeMount`.
- **Build only.** The browser never calls it. It runs once per prerender pass,
  so once per locale under prefix routing — a site may list different posts
  per language.
- **One page per entry**, rendered exactly like a fixed route with those
  params: `dist/blog/cookies/index.html`, and `dist/es/blog/cookies/index.html`
  per locale. Values are strings (numbers are converted) and are URL-encoded
  per segment.
- **Errors and warnings**: an entry missing a param, or with an empty or
  non-primitive value, is a build error naming the route. Duplicate entries
  are rendered once, with a warning. An empty list renders nothing and is not
  an error. A parameterised route without `staticPaths` keeps today's skip
  warning, which now names the field.
- **Static output**: every entry of a route shares that route's page module;
  the page carries its params so the kernel (which has no router) hands the
  view the same `params` the prerender used. An unlisted value is a 404.
- **Hybrid output**: an unlisted value still works — the SPA shell takes over
  and fetches in the browser.
- **Collisions** between a generated page and a fixed route's page follow the
  existing duplicate rule (the fixed route wins, with a warning).
- Sitemap and `hreflang` (D177) include the generated pages.

## Alternatives rejected

- **File-based enumeration** (a page per file on disk) — D67 rejected
  file-based routing.
- **A list in `puzzle.config.js`** — the config is read by the Go build, away
  from the route it describes, and cannot use the app's store or adapter.
- **Crawling links from rendered pages** — misses unlinked pages and makes the
  output depend on render order.
- **A content pipeline (Markdown collections)** — a separate feature; this is
  only the enumeration hook it would build on.

## Consequences

- The output is a snapshot: new content needs a rebuild.
- The data source must be reachable from the build machine.
- Each page runs its own `data()` on a fresh store, so per-page fetches
  multiply by pages × locales.
- In SPA and hybrid apps the route table ships to the browser, and so does
  anything `staticPaths` imports at module level. Keep the list source behind
  a `fetch` or an `await import()` inside the function; `output: 'static'`
  ships no route table and is unaffected.
