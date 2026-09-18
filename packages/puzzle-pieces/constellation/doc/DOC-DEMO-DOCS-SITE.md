---
name: The demo docs-site app
kind: guide
status: built
connections:
  - PLAN-PROJECT
  - DIAGRAM-TOPOLOGY
  - DECISION-DOCS-DEMO-SPLIT
---

# The demo docs-site app

`demo/` is a real Puzzle app (dev port **3070** — 3000 and several other ports are taken by sibling projects) that both documents the pieces and serves as the dev/integration harness. It **consumes copies** of registry pieces through the actual copy-in flow ([[DECISION-DOCS-DEMO-SPLIT]]), so building the docs also compile-verifies the pieces. Copies in `demo/app/components/ui/` and `demo/app/lib/` are strictly downstream of `registry/` — edit registry first, then sync.

## Shell (docs site)


Rebuilt 2026-09-18 ([[FEATURE-THEMES]]) as the frame / rail / panel composition the theme files are designed around, made from the pieces themselves:

- **Top bar** (`bg-bar text-bar-ink`, 48px): brand, `N pieces · vX` tag, SearchDialog, GitHub link, and a menu button below `lg:`.
- **Rail** = the Sidebar piece in `variant="rail"` (`bg-rail`, `text-rail-*`, `bg-rail-active`, `border-rail-edge`), items built in `layouts/Default.pzl` from `app/docs/nav.js` (Getting started · a Themes group with the scheme panels as a submenu · one collapsible submenu per component section with a count badge). Hrefs are `#` + path because the demo is hash-routed. The rail's footer holds **AppearanceSwitcher** (`components/docs/AppearanceSwitcher.pzl`): 4 schemes × 3 modes + "Follow system", driven entirely by `app/lib/appearance.js` (a byte-identical copy of `registry/theme/appearance.js`, booted in `app.js`; the inline pre-paint in `public/index.html` equals `registry/theme/pre-paint.js` — both tested).
- **Panel** = `<main class="bg-surface-panel border-t border-panel-edge shadow-panel lg:rounded-tl-xl">` — the content, footer and every docs page render inside it.
- **Mobile nav** (below `lg:`): a drawer under the bar painted with the rail roles, holding the old `SideNav` list plus the switcher.
- `app/styles/styles.css` imports the four `registry/theme/*.css` files DIRECTLY (not copies), so what the site shows is the shipped CSS.
- **Design-system panels** under `app/views/themes/`: `SchemePanel.pzl` (`/themes/:scheme` — every token as a colour card whose swatches are live probes scoped by `data-scheme` + `data-theme`, values and AA chips from computed styles over the static name list `app/lib/tokenNames.js`, contrast math in `app/lib/contrast.js`; the demo never imports `test/`), `Compare.pzl` (`/themes/compare`, 4 × 3 `ShellMock` tiles), `Shell.pzl` (`/themes/shell`, full mock with role callouts), `Pieces.pzl` (`/themes/pieces`, gallery). `/theming` is the written model. `test/demo-theme-guard.test.mjs` bans colour literals in these files.
- **Right "On This Page" column** rendered by `Toc` — one entry per section.

## Docs primitives (`demo/app/components/docs/`)

Demo-only components, **NOT registry pieces** (they never ship to consumers):
- **ExampleBox** — the featured demo frame: centered live demo on `bg-page`, then a collapsed code peek with a "View Code" reveal + copy button. The frame must NOT be `overflow-hidden` (it would clip opened popovers/tooltips/dropdowns — the code area clips itself instead; this is a recorded gotcha).
- **CodeBlock** — the code rendering used inside ExampleBox and Installation sections.
- **Toc** — config-first `items` `[{ label, href }]`; clicks scroll via `scrollIntoView({behavior:'smooth'})` in a handler. Raw `#hash` anchors are avoided **on purpose** — the SPA router may intercept them.
- **SideNav** — renders the `nav.js` config with section labels + active-path highlighting.

## Per-piece pages

One page per piece at `/components/<name>` in `app/views/components/*Doc.pzl`, wired in `app/routes.js` (kebab piece names, alphabetical imports). **`ButtonDoc.pzl` is the exemplar** every other page follows: H1 + description (from `piece.json`) → Installation → hero ExampleBox → one ExampleBox per additional example, with Toc ids. Code samples live as **template-literal consts** in each view's `<script>` (literal angle-bracket tags and `{#if}`/`{#for}` tokens break template *prose* but are safe inside JS template strings — recorded gotcha).

Adding a piece's demo surface = the copied file(s) + a `*Doc.pzl` page + a `nav.js` entry + a `routes.js` entry. Untracked new pages do NOT ride along in another session's refactor commits — re-check against the current exemplar before shipping.
