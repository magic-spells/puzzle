---
name: v1.33 — Static site generation (D67)
status: verified
verified_at: '2026-07-17T04:04:00.000Z'
connections:
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D01-SPA-ONLY
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DECISION-D80-STATIC-PAGES-MODE
---

# v1.33 — Static site generation (D67)

> **Renamed by D80 (v1.47):** the mode this slice shipped is now spelled `output: 'hybrid'` / `puzzle build --hybrid` (behavior byte-identical). Read every `--static` / `output: 'static'` / `data-puzzle-ssg` below as the hybrid mode; `output: 'static'` now names the separate true-static mode ([[FEATURE-V1-47-STATIC-PAGES]], [[DECISION-D80-STATIC-PAGES-MODE]]).

`puzzle build --static` / `output: 'static'`: prerender every static route to `dist/<path>/index.html` (directory-style, URLs identical to the SPA routes), each page content-complete with `meta.title` injected and `data-puzzle-ssg` stamped on the target element; the runtime takes over at navigation #0 and the site is the same SPA afterward. Ship [[DECISION-D67-SSG-STATIC-BUILD]].

## Scope

- In (runtime): NEW `client-runtime/ssg/serialize.js` (pure ViewNode→HTML, mirrors
  ViewManager attr/slot/island semantics) + `client-runtime/ssg/index.js`
  (`prerender`/`prerenderToDir`/`injectShell`: ctx wiring à la PuzzleApp.mount,
  route enumeration incl. children, chain preload + leaf-up vnode assembly,
  title walk, shell surgery), exported as `@magic-spells/puzzle/ssg` (+
  `types/ssg.d.ts`); `expandSlots` exported from viewManager.js; Node guard in
  `PuzzleApp.mount()`; [[COMPONENT-ROUTER]] `#takeoverSSG` in both initial-nav
  mount branches (replaceChildren + marker removal + `skipEnter()`) and
  trailing-slash-insensitive `#match`.
- In (Go): `output` config key + `--static` flag; NEW
  `compiler/internal/build/prerender.go` (stdin-entry node-platform bundle,
  `node --enable-source-maps` run, `__PUZZLE_SSG_JSON__` sentinel, build-style
  summary, `.puzzle-prerender/` cleanup) wired into `Build()` pre-swap;
  `/ssg` in-repo esbuild alias.
- Out (deferred on top): `staticPaths()` for dynamic routes, head-management
  API, DOM-adoption hydration, lazy route views + code splitting,
  `puzzle preview`, flat `name.html` output knob. (~~`404.html`~~ — shipped as
  the v1.34 follow-up: the `path: '*'` catch-all renders to `dist/404.html`,
  a missing catch-all emits an advisory warning, and both `puzzle init`
  templates gained a `NotFound.pzl` + catch-all route. SPEC §36.)

## Acceptance (all landed)

- puzzle-pieces demo: `puzzle build --static` → 46 files in ~600ms, one HTML
  per doc route; `dist/components/panel-stack/index.html` carries full layout +
  doc markup, `<title>Panel Stack — Puzzle Pieces</title>`, `data-puzzle-ssg`.
- Browser (static file server, directory URLs with trailing slash): content
  visible pre-JS; takeover at nav #0 with no flash/duplication and marker
  removed; prerendered components interactive (PanelStack slides); highlight.js
  `mounted()` work runs at takeover, not build; SPA nav + back/forward work.
- Prerender failure leaves the last good `dist/` untouched (staging swap).
- Suite 627 → 665 vitest (serializer goldens, serializer≡jsdom equivalence,
  prerender integration, takeover + trailing-slash tests); Go build/config
  integration tests green.
