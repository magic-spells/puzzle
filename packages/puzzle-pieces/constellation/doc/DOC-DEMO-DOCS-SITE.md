---
name: The demo docs-site app
kind: guide
status: built
connections:
  - PLAN-PROJECT
  - DIAGRAM-TOPOLOGY
  - DECISION-DOCS-DEMO-SPLIT
notes:
  - kind: state
    text: >-
      Mobile shell (feat/demo-mobile, 2026-09-23). Below lg: the top bar is one flex row (brand …
      search icon, GitHub). There is no hamburger, and the SearchDialog trigger collapses to an icon
      button that is still the morph source; the field and the ⌘K chip return at lg. The docs nav
      below lg is a floating current-page pill (bottom-dock, shadow-dock tokens in demo styles.css)
      that morphs into the Sheet piece: position=bottom, mode=card, snapPoints "65dvh 92dvh",
      initialSnap 0, breakpoint 1024, maxDisplayWidth 1023, morphTrigger [data-docs-pill]. SideNav
      is the sheet's list (it now carries the Themes group and aria-current). A link click closes
      the sheet, and the Toaster lifts by dock-clear below lg. <main> is overflow-x-hidden, because
      closed dropdown-panel flyouts stay laid out and panned the page sideways. GOTCHA: Tailwind v4
      rounded-full computes to ~1.68e7px, and morph-engine lerps computed per-corner radii, so a
      rounded-full morph end keeps the blob a stadium until the reveal. Both ends of both shell
      morphs therefore carry a literal 22px (styles.css "Morph endpoints"). var()-based radii are
      fine because the engine reads computed values.
    sha: eaa3efa
  - kind: state
    text: >-
      Supersedes part of the note above (2026-09-23 follow-up). The pill Sheet no longer sets
      maxDisplayWidth. `lg:hidden` is fractional and innerWidth rounds, so a 1023.5px viewport
      showed the pill while a 1023 ceiling silently refused show(). openMobileNav now re-arms a
      stale `true` and drops a request the sheet refused on the next frame. Scheme pages read
      "Themes · Dim" on the pill. The pill's accessible name is its visible text plus an sr-only
      "Docs menu, current page:" prefix. Grain: the old bg-noise-dark-20.png was near-black
      (luminance 0–30) at a flat 20% alpha, which reads as a uniform veil with about 0.9/255
      measured grain contrast, i.e. invisible. It is replaced by magicspells.io's bg-noise.png
      (black-and-white at 3% alpha), painted at its native 100px as TWO offset layers (about 3.2/255
      in every mode). GOTCHA upstream: @magic-spells/sheet's dist/sheet.css sets only
      `-webkit-backdrop-filter` on the overlay, so a Sheet without a backdrop-blur in backdropClass
      gets no blur in Chromium or Firefox. The shell's Sheet passes backdrop-blur-sm through
      backdropClass.
---

# The demo docs-site app

`demo/` is a real Puzzle app (dev port **3070** — 3000 and several other ports are taken by sibling projects) that both documents the pieces and serves as the dev/integration harness. It **consumes copies** of registry pieces through the actual copy-in flow ([[DECISION-DOCS-DEMO-SPLIT]]), so building the docs also compile-verifies the pieces. Copies in `demo/app/components/ui/` and `demo/app/lib/` are strictly downstream of `registry/` — edit registry first, then sync.

## Shell (docs site)



Rebuilt 2026-09-18 ([[FEATURE-THEMES]]) as the frame / rail / panel composition the theme files are designed around, made from the pieces themselves:

- **Top bar** (`bg-bar text-bar-ink`): at `lg:` and above it is a three-column grid (brand + `N pieces · vX` tag, the SearchDialog field centred on the window, GitHub). Below `lg:` it is one flex row (brand … search icon button, GitHub) with no hamburger. The search trigger is the same element in both forms, so it stays the morph source.
- **Rail** = the Sidebar piece in `variant="rail"` (`bg-rail`, `text-rail-*`, `bg-rail-active`, `border-rail-edge`), items built in `layouts/Default.pzl` from `app/docs/nav.js` (Getting started · a Themes group with the scheme panels as a submenu · one collapsible submenu per component section with a count badge). Hrefs are `#` + path because the demo is hash-routed. The rail's footer holds **AppearanceSwitcher** (`components/docs/AppearanceSwitcher.pzl`): 4 schemes × 3 modes + "Follow system", driven entirely by `app/lib/appearance.js` (a byte-identical copy of `registry/theme/appearance.js`, booted in `app.js`; the inline pre-paint in `public/index.html` equals `registry/theme/pre-paint.js`, and both are tested).
- **Panel** = `<main class="bg-surface-panel border-t border-panel-edge shadow-panel lg:rounded-tl-xl overflow-x-hidden">`. The content, footer and every docs page render inside it, and it never scrolls sideways.
- **Mobile nav** (below `lg:`): a floating current-page pill at the bottom centre ("Charts · Line Chart") that morphs into the **Sheet** piece as an inset bottom card. The sheet holds `SideNav` (the same destinations as the rail) with the switcher in its foot. See the 2026-09-23 state note for the exact props and the morph-radius gotcha.
- The shell's overlays (SearchDialog, the mobile Sheet) share a frosted-glass scrim (`bg-scrim/60 backdrop-blur-sm backdrop-saturate-150`) under the site-wide noise tile on `dialog-backdrop`.
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
