# Puzzle Static Docs Example

A small static documentation site — a short field guide to the Puzzle framework
itself — built to demonstrate Puzzle's **static site generation** mode (v1.33,
D67 · [SPEC §36](../../constellation/doc/DOC-SPEC.md)).

## What SSG mode is

With `output: 'static'`, the same Puzzle app you'd normally ship as a single-page
app is **prerendered to one HTML file per static route** at build time — content
and `<title>` baked in, so a page is readable (and crawlable) before a line of
JavaScript runs. There's no SSR server and no hydration protocol: the browser
runtime simply **takes over the prerendered DOM at navigation #0** and the site is
the ordinary SPA from then on (routing, transitions, morph — all unchanged). One
codebase, static where it can be and interactive where it needs to be.

## Running it

### Development — `puzzle dev`

```bash
cd examples/static-docs
npm install
npm run dev
```

`puzzle dev` is **unchanged by SSG** — it always serves the live SPA with live
reload. Static output is a build-time concern only.

### Building

There are two build shapes:

| Command | Output |
| --- | --- |
| `puzzle build` (no `output`) | A normal **SPA**: one `dist/index.html` shell + `app.js` + `styles.css`. |
| `puzzle build` **with `output: 'static'`** | **Per-route HTML**: `dist/<path>/index.html` for every static route, sharing `app.js` + `styles.css`. |

This example turns SSG on via `output: 'static'` in
[`puzzle.config.js`](./puzzle.config.js). The command-line equivalent is
`puzzle build --static` — either one is sufficient, and `'static'` is the only
legal value for `output`.

```bash
npm run build          # output: 'static' is already set, so this prerenders
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
├── playground/index.html          # /playground  → plain SPA shell (island)
├── 404.html                       # *            → catch-all, served for unknown URLs
├── app.js                         # the shared runtime + app bundle
└── styles.css                     # compiled Tailwind
```

Each **prerendered** page is the `public/index.html` shell with the route's markup
injected into the `#app` element (stamped `data-puzzle-ssg`) and the shell
`<title>` replaced by the route's `meta.title`. Pages link the shared absolute
`/app.js` + `/styles.css`, so they work at any depth.

### Things this example exercises

- **Nested routes + the title walk.** `/guide` is a shell view with a `<Slot/>`,
  an **index child** (`path: ''`, no `meta.title` → inherits the shell's *"Guide ·
  …"*) and a **sibling child** (`path: 'templates'`, its own title wins at
  `/guide/templates/`). Open the two pages and watch the browser tab.
- **Build-time data → static HTML.** `beforeMount({ store })` in
  [`app.js`](./app/app.js) seeds three `principle` records; the About view's
  `data()` reads them back, so they're baked into `about/index.html` — no fetch,
  no client render needed to see them.
- **Static, then interactive.** The Home page's counter is prerendered showing
  *"Clicked 0 times"*. Load `dist/index.html`, then **click the button** — the SPA
  has taken over the very same DOM, no flash and no re-render.

### The dynamic-route warning (expected)

`/tags/:tag` is a dynamic route. The v1 static build can't know which tags to emit,
so it **skips the route with a warning** and writes no file — this is expected v1
behavior (a `staticPaths()` enumeration hook is the planned follow-up). You'll see
it in the build output:

```
! [puzzle] skipped dynamic route "/tags/:tag" — SSG v1 renders static paths only …
! skipped /tags/:tag (dynamic)
```

The route still works as a normal SPA route once the app is live.

### The `prerender: false` island (escape hatch)

`/playground` is flagged `prerender: false`. Instead of prerendering it, the build
writes the **plain SPA shell** at `dist/playground/index.html` — an empty `#app`
with no `data-puzzle-ssg` marker and no baked markup — and the page renders
entirely in the browser. Use it for routes that are pure interaction and have
nothing meaningful to prerender.

### The 404 page

The last route is a top-level catch-all — `path: '*'` — pointing at
[`NotFound.pzl`](./app/views/NotFound.pzl). It earns its keep in **both** modes
from that one line:

- **Static hosting.** SSG renders the catch-all to `dist/404.html` (not a
  directory-style `dist/*/index.html`) — the exact filename GitHub Pages, Netlify,
  Render, and Cloudflare Pages serve for any URL that maps to no file. Deploy
  `dist/` and unknown paths get *this* page, not the host's generic one. (Omit the
  catch-all and the build warns: *no catch-all route — dist/404.html not
  emitted*.)
- **The live SPA.** Once the runtime takes over, the router matches unknown client
  paths against the same `*` route and shows the NotFound view in-place — no full
  reload.

One route, both cases. Open `dist/404.html` directly, or visit a made-up path like
`/does-not-exist` in the running SPA.

## Serving `dist/`

The output is plain static files — serve it with any static file server:

```bash
npx serve dist
# or
python3 -m http.server -d dist 8080
```

Because the pages are directory-style (`dist/guide/index.html`), the live URLs are
**directory URLs** (`/guide/`, `/guide/templates/`). Puzzle's router treats a
single trailing slash as insignificant in all modes (v1.33), so `/guide/` matches
the `/guide` route and a `:param` capture never swallows the slash — the
prerendered pages load at their own paths and take over cleanly.

## Files

```
static-docs/
├── puzzle.config.js               # output: 'static'
├── app/
│   ├── app.js                     # export default app + beforeMount seed
│   ├── routes.js                  # static + nested + dynamic + prerender:false + catch-all
│   ├── models/
│   │   ├── index.js
│   │   └── principle.js           # trivial build-time model
│   ├── styles/styles.css          # Tailwind v4, "warm paper" theme
│   ├── public/index.html          # the SPA shell (empty #app)
│   ├── layouts/Default.pzl        # nav + footer chrome around <Slot/>
│   └── views/
│       ├── Home.pzl               # interactive counter (takeover demo)
│       ├── About.pzl              # reads seeded records in data()
│       ├── Playground.pzl         # prerender:false SPA island
│       ├── TagView.pzl            # dynamic /tags/:tag (skipped by SSG)
│       ├── NotFound.pzl           # catch-all '*' → dist/404.html
│       └── guide/
│           ├── GuideShell.pzl     # nested shell with <Slot/>
│           ├── GuideIndex.pzl     # index child (path: '')
│           └── GuideTemplates.pzl # sibling child (path: 'templates')
```
