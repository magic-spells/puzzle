---
name: puzzle
description: >
  Triggers on any work building or editing a Puzzle framework app: .pzl files,
  "puzzle view", "puzzle component", "PuzzleApp", "puzzle routes", "puzzle build",
  "puzzle dev", SSG/static export of a Puzzle app, or work in a repo containing
  puzzle.config.js. Covers app structure, .pzl anatomy, routing, lifecycle,
  static prerendering rules, and puzzle-pieces conventions.
version: 1.0.0
---

# Puzzle Framework — App-Builder Guide

Puzzle is Magic Spells' SPA framework: single-file `.pzl` components compiled by a
Go + esbuild toolchain, with an optional static-prerender (SSG) mode. This skill is
the distilled app-builder reference; the **canonical docs live in the framework
repo** — read them when you need exact grammar or contracts:

| Topic | Canonical doc |
|---|---|
| Complete app-building guide | [DOC-USER-GUIDE.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-USER-GUIDE.md) |
| `.pzl` file reference | [DOC-PUZZLE-FILE.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-PUZZLE-FILE.md) |
| Template grammar + cheat sheet | [DOC-TEMPLATE-SYNTAX.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-TEMPLATE-SYNTAX.md) |
| Routing | [DOC-ROUTER.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-ROUTER.md) |
| Events | [DOC-EVENTS.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-EVENTS.md) |
| Models / data layer | [DOC-MODELS.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-MODELS.md), [DOC-DATASTORE.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-DATASTORE.md) |
| Frozen v1 contract (wins on conflict) | [DOC-SPEC.md](https://github.com/magic-spells/puzzle/blob/main/constellation/doc/DOC-SPEC.md) |
| SSG design + boundaries | [DECISION-D67-SSG-STATIC-BUILD.md](https://github.com/magic-spells/puzzle/blob/main/constellation/decision/DECISION-D67-SSG-STATIC-BUILD.md) |
| Best SSG example app | [examples/static-docs](https://github.com/magic-spells/puzzle/tree/main/examples/static-docs) |
| Component-catalog example | [puzzle-pieces demo](https://github.com/magic-spells/puzzle-pieces/tree/main/demo) |

If the framework repo is checked out locally (or installed in `node_modules/@magic-spells/puzzle`),
prefer reading these files from disk over fetching URLs.

## App skeleton

```
my-app/
├── puzzle.config.js       # { styles: { use: ['tailwindcss'] }, output: 'static' }
└── app/
    ├── app.js             # new PuzzleApp({ target: '#app', routes }); MUST `export default app` for SSG
    ├── routes.js          # route table (see below)
    ├── public/index.html  # the shell: #app mount + <script type="module" src="/app.js">
    ├── styles/styles.css  # global entry; Tailwind v4 via the config's styles pipeline
    ├── layouts/*.pzl      # chrome with <Slot/>
    ├── views/*.pzl        # pages
    ├── components/*.pzl
    └── models/*.js
```

CLI (bin `puzzle`, installed with `@magic-spells/puzzle`):
`dev` (SSE live reload, state-preserving full-page refresh), `build` (`--static`,
`--mode production|development`), `init`, `generate`, `add` (tailwind integration,
`piece <name…>`, `skills`), `upgrade`, `doctor`, `info`.

## .pzl anatomy

Template markup + `<scripts>` (+ optional `<styles>`, `scoped` supported):

```html
<puzzle-view>
  <button class={ classes } @click={ increment }>{ count | number }</button>
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Counter extends PuzzleView {
  data() { return { count: 0 }; }     // runs at render — and under NODE during prerender
  mounted() { /* browser-only setup: listeners, intervals, DOM */ }
  destroyed() { /* MANDATORY cleanup of window listeners/intervals */ }
}
</scripts>
```

Template syntax (full grammar in DOC-TEMPLATE-SYNTAX.md): `{ expr | formatter }`,
`{#if}/{:else if}/{:else}/{/if}`, `{#unless}`, `{#for item in items, i}` (trailing
`, name` binds the index), `{#case}/{:when}`, `@event={ handler }` with modifiers,
named `<Slot>`s, component imports used as capitalized tags. `<scripts lang="ts">`
for TypeScript (types stripped at compile).

## Routing

`app/routes.js` exports an array of `{ path, name, view, layout, meta: { title }, children }`.
- Nested routes: `children` with **relative** paths render at the parent view's `<Slot/>`;
  `layout` is top-level-only; params merge down the chain.
- `:param` and `*` supported; `*` catch-all must stay **last** (routes match in order).
- Route views/layouts must be **statically imported** in routes.js.

## SSG / static export — THE RULES (bugs happen when these are missed)

Enable with `output: 'static'` in puzzle.config.js (or `puzzle build --static`).
Emits `dist/<path>/index.html` per static route + shared `app.js`/`styles.css`;
top-level `*` renders to `dist/404.html`. The route's `meta.title` is injected via
a leaf→root walk. Then the SPA **takes over on load and re-renders** (not true
DOM-adoption hydration).

1. **`data()` and `beforeMount` run under Node at build time.** Guard every browser
   global: `typeof document !== 'undefined'` before touching `document`, `window`,
   `localStorage`, `matchMedia`. DOM behavior belongs in `mounted()`.
2. **`:param` routes are SKIPPED by the prerenderer** (no `staticPaths()` hook yet) —
   a warning is printed and no file is written. For content sites, every page must be
   an explicit static route. Treat any "skipped" in the build summary as a regression.
3. **Inline `<script>` inside route markup is dead** — the takeover re-render discards
   it. Only the shell (`app/public/index.html`) may carry inline scripts (analytics,
   theme pre-paint). All other behavior: `mounted()` / cleanup in `destroyed()`
   (components DO unmount on SPA navigation — leaked window listeners are a real bug).
4. `prerender: false` on a route = SPA island: emits the empty shell (invisible to
   any static search indexer). Escape hatch for interactive-only pages.
5. SSG output pairs with post-build tooling: Pagefind can index `dist/` (content is
   baked into `#app`); sitemap/meta-OG injection needs your own Node script — SSG
   only writes `<title>`.

## Styling

Tailwind v4 is the supported pipeline (`styles: { use: ['tailwindcss'] }` — the CLI
folds Tailwind output + collected `<styles>` blocks into `dist/styles.css`; wire it
with `puzzle add tailwind`). For puzzle-pieces apps, merge the registry's
`theme/pieces.css` after `@import "tailwindcss"` and style ONLY via its semantic
tokens (`bg-surface`, `text-ink`, `bg-brand`, `border-border`…); dark mode is
`light-dark()` CSS driven by `data-theme` on `<html>` (set it pre-paint in the shell).

## puzzle-pieces (component library)

Copy-in registry, shadcn-style — NOT an npm import. Use `puzzle add piece <name…>`
(copies each piece + its transitive piece/lib dependencies into the app verbatim,
records hashes in `pieces.lock`; `--registry` overrides the source, `--overwrite`
to refresh; required npm packages and the theme merge are printed as next steps).
Pieces follow a `BASE` + `VARIANT`/`SIZE` class-map convention with a `class` prop
for caller overrides. Audit copied pieces for SSG rule #1 above before
prerendering them.
