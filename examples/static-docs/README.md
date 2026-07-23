# Puzzle Static Docs Example

A small static documentation site — a short field guide to the Puzzle framework
itself — built to demonstrate Puzzle's **true static output** mode (v1.46, D79 ·
[SPEC §36](../../constellation/doc/DOC-SPEC.md)).

## What `output: 'static'` is

With `output: 'static'`, the same Puzzle app you'd normally ship as a single-page
app is **prerendered to one HTML file per static route** at build time — content
and `<title>` baked in, so a page is readable (and crawlable) before a line of
JavaScript runs. What makes this *static* (as of D79) is what the output does
**not** contain:

- **No router, no SPA takeover, no history API.** Moving between pages is a plain
  `<a>` full page load, exactly like a hand-written HTML site. `dist/` contains no
  `app.js`.
- **Only the JavaScript each page needs.** Every page gets a small generated ES
  module (`dist/_puzzle/<slug>.js`) that imports `mountStatic` from
  `@magic-spells/puzzle/static` plus *that page's* view/layout classes. Shared
  components and the view-layer runtime are split into cached chunks under
  `dist/_puzzle/chunks/`. A page pays for its own components, nothing more.
- **Build-time data, rehydrated with no network.** `beforeMount` runs **only at
  build time**; each page's store is serialized into an inline
  `<script type="application/json" data-puzzle-static-data>` island, and
  `mountStatic` rehydrates it before re-rendering — so `data()` produces the same
  markup in the browser without a fetch.

The page still becomes interactive: `mountStatic` mounts the view tree over the
prerendered markup (flash-free, since it re-renders identically), so event
handlers, local `setData` state, and store mutations all work. It's an
interactive *document*, not an SPA.

### `static` vs `hybrid`

`output: 'hybrid'` is the **renamed** original prerender mode (D67, formerly called
`static`): the same prerendered pages **plus** the full SPA bundle and a router
that takes over at navigation #0 and drives every subsequent navigation
client-side (routing, transitions, morph — all unchanged).

| Choose | When |
| --- | --- |
| `output: 'static'` | Content sites where cross-page navigation can be a normal page load and interactivity is per-page (this docs site, marketing, blogs). Smallest possible JS per page; no SPA. |
| `output: 'hybrid'` | Apps that want prerendered first paint **and** instant client-side navigation, transitions, or shared-element morphs afterward — a prerendered SPA. |

Behavior of `hybrid` is byte-identical to the old `output: 'static'`; only the
name changed.

## Running it

### Development — `puzzle dev`

```bash
cd examples/static-docs
npm install
npm run dev
```

`puzzle dev` is **unchanged by the output mode** — it always serves the live SPA
with live reload. Output mode is a build-time concern only.

### Building

| Command | Output |
| --- | --- |
| `puzzle build` (no `output`) | A normal **SPA**: one `dist/index.html` shell + `app.js` + `styles.css`. |
| `puzzle build --static` / `output: 'static'` | **True static pages**: per-route HTML + per-page modules, no `app.js`. |
| `puzzle build --hybrid` / `output: 'hybrid'` | **Prerendered SPA**: per-route HTML + the shared `app.js`, router takeover. |

This example turns static output on via `output: 'static'` in
[`puzzle.config.js`](./puzzle.config.js). The command-line equivalent is
`puzzle build --static` — either one is sufficient. (Passing a flag that
contradicts the config value is an error.)

```bash
npm run build          # output: 'static' is already set, so this ships static pages
# or, without editing the config:
puzzle build --static
```

## What to expect in `dist/`

```
dist/
├── index.html                     # /            → "Puzzle Field Guide"
├── about/index.html               # /about       → seeded records rendered in
├── guide/index.html               # /guide       → nested shell + index child
├── guide/templates/index.html     # /guide/templates → nested sibling child
├── playground/index.html          # /playground  → empty-target shell (client-rendered island)
├── 404.html                       # *            → catch-all, served for unknown URLs
├── styles.css                     # compiled Tailwind
└── _puzzle/
    ├── index.js                   # per-page entry: mountStatic + Home's classes
    ├── about.js                   # per-page entry: mountStatic + About's classes
    ├── guide.js
    ├── guide--templates.js        # slug collisions get a '--' join
    ├── playground.js
    ├── 404.js
    └── chunks/                    # shared components + the view-layer runtime
```

There is **no `app.js`** in `dist/`. Each prerendered page is the
`public/index.html` shell with the route's markup injected into the `#app` element
(stamped `data-puzzle-static`), the shell `<title>` replaced by the route's
`meta.title`, the inline data island added, and the `/app.js` script tag swapped
for the page's own `/_puzzle/<slug>.js` module. Pages link absolute paths, so they
work at any depth.

### Things this example exercises

- **Nested routes + the title walk.** `/guide` is a shell view with a `<Slot/>`,
  an **index child** (`path: ''`, no `meta.title` → inherits the shell's *"Guide ·
  …"*) and a **sibling child** (`path: 'templates'`, its own title wins at
  `/guide/templates/`). Open the two pages and watch the browser tab.
- **Build-time data → static HTML → rehydration.** `beforeMount({ store })` in
  [`app.js`](./app/app.js) seeds three `principle` records **at build time**; the
  About view's `data()` reads them back, so they're baked into `about/index.html`.
  The store is serialized into that page's data island, and `mountStatic`
  rehydrates it before re-rendering — the browser sees the same records with no
  fetch and no re-run of `beforeMount`.
- **Formatters that work at build time *and* client-side.** `titlecase` and
  `plural` live in [`app/formatters.js`](./app/formatters.js). The static build
  reads formatters from that file so they exist in each page's module and
  re-render identically after mount. Formatters registered **only** in the
  `app.js` config would render at build time but be missing client-side — the
  build warns about that; keeping them in `app/formatters.js` is the fix. Models
  come from [`app/models/index.js`](./app/models/index.js) the same way.
- **Static, then interactive.** The Home page's counter is prerendered showing
  *"Clicked 0 times"*. Load `dist/index.html`, then **click the button** — the
  page's module has mounted the view over the very same DOM, flash-free, and the
  counter (and its `plural` formatter) is now live. No router involved.

### Dynamic routes are skipped (conceptual)

A dynamic route (`/tags/:tag` and the like) carries a `:param` the static build
can't enumerate, so it is **skipped with a warning** and writes no file — the
static build renders concrete paths only. A `staticPaths()` enumeration hook is
the planned follow-up. This example has no dynamic route, but if you added one
you'd see it in the build output:

```
! [puzzle] skipped dynamic route "/tags/:tag" — SSG v1 renders static paths only …
! skipped /tags/:tag (dynamic)
```

Because there is no router in the output, a dynamic route would have no way to run
client-side either — dynamic content in static mode belongs behind `staticPaths()`
(future) or a `prerender: false` island that fetches at runtime.

### The `prerender: false` island (escape hatch)

`/playground` is flagged `prerender: false`. Instead of prerendering it, the build
writes an **empty-target shell** at `dist/playground/index.html` — an empty `#app`
with no `data-puzzle-static` marker and no baked markup — but **still ships the
page's data island and entry module**, so the view renders entirely in the
browser. A client-rendered island: use it for routes that are pure interaction and
have nothing meaningful to prerender.

### The 404 page

The last route is a top-level catch-all — `path: '*'` — pointing at
[`NotFound.pzl`](./app/views/NotFound.pzl). The static build renders the catch-all
to `dist/404.html` (not a directory-style `dist/*/index.html`) — the exact filename
GitHub Pages, Netlify, Render, and Cloudflare Pages serve for any URL that maps to
no file. Deploy `dist/` and unknown paths get *this* page, not the host's generic
one. (Omit the catch-all and the build warns: *no catch-all route — dist/404.html
not emitted*.) In `hybrid` mode the same route also serves the live router's 404
for unmatched client paths; in static mode there is no client router, so the file
is what does the work.

Open `dist/404.html` directly to see it.

## Serving `dist/`

The output is plain static files — serve it with any static file server:

```bash
npx serve dist
# or
python3 -m http.server -d dist 8080
```

Because the pages are directory-style (`dist/guide/index.html`), the live URLs are
**directory URLs** (`/guide/`, `/guide/templates/`), and navigation between them is
ordinary `<a href="/guide/">` page loads. No history-API fallback is required —
every URL maps to a real file on disk.

## Files

```
static-docs/
├── puzzle.config.js               # output: 'static'
├── app/
│   ├── app.js                     # export default app + build-time beforeMount seed
│   ├── routes.js                  # static + nested + prerender:false + catch-all
│   ├── formatters.js              # titlecase + plural (available build-time AND client-side)
│   ├── models/
│   │   ├── index.js
│   │   └── principle.js           # trivial build-time model
│   ├── styles/styles.css          # Tailwind v4, "warm paper" theme
│   ├── public/index.html          # the shell (empty #app; /app.js tag stripped in static mode)
│   ├── layouts/Default.pzl        # nav + footer chrome around <Slot/>
│   └── views/
│       ├── Home.pzl               # interactive counter (client-mount demo)
│       ├── About.pzl              # reads seeded records in data()
│       ├── Playground.pzl         # prerender:false client-rendered island
│       ├── NotFound.pzl           # catch-all '*' → dist/404.html
│       └── guide/
│           ├── GuideShell.pzl     # nested shell with <Slot/>
│           ├── GuideIndex.pzl     # index child (path: '')
│           └── GuideTemplates.pzl # sibling child (path: 'templates')
```
