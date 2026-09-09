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

- **Sticky blurred header** with the "Puzzle Pieces" brand + GitHub link; a quiet `N pieces · v0.1` tag. Navigation lives entirely in the sidebar.
- **Grouped sidebar** generated from `app/docs/nav.js` — one config module (Getting-started + Forms/Overlays/Feedback/Content sections) that drives the sidebar, the `/components` index, and page metadata from a single list. Active item = soft pill.
- **Mobile nav** collapses into a Collapsible under the header (a Sheet drawer was the stretch goal, not shipped).
- **Right "On This Page" column** rendered by `Toc` — one entry per example section.

## Docs primitives (`demo/app/components/docs/`)

Demo-only components, **NOT registry pieces** (they never ship to consumers):
- **ExampleBox** — the featured demo frame: centered live demo on `bg-page`, then a collapsed code peek with a "View Code" reveal + copy button. The frame must NOT be `overflow-hidden` (it would clip opened popovers/tooltips/dropdowns — the code area clips itself instead; this is a recorded gotcha).
- **CodeBlock** — the code rendering used inside ExampleBox and Installation sections.
- **Toc** — config-first `items` `[{ label, href }]`; clicks scroll via `scrollIntoView({behavior:'smooth'})` in a handler. Raw `#hash` anchors are avoided **on purpose** — the SPA router may intercept them.
- **SideNav** — renders the `nav.js` config with section labels + active-path highlighting.

## Per-piece pages

One page per piece at `/components/<name>` in `app/views/components/*Doc.pzl`, wired in `app/routes.js` (kebab piece names, alphabetical imports). **`ButtonDoc.pzl` is the exemplar** every other page follows: H1 + description (from `piece.json`) → Installation → hero ExampleBox → one ExampleBox per additional example, with Toc ids. Code samples live as **template-literal consts** in each view's `<script>` (literal angle-bracket tags and `{#if}`/`{#for}` tokens break template *prose* but are safe inside JS template strings — recorded gotcha).

Adding a piece's demo surface = the copied file(s) + a `*Doc.pzl` page + a `nav.js` entry + a `routes.js` entry. Untracked new pages do NOT ride along in another session's refactor commits — re-check against the current exemplar before shipping.
