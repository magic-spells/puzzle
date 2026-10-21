---
name: >-
  Appearance is four schemes × four styles (Dark, Dim, Mixed, Light), from the Magic Spells Design
  System
status: built
connections:
  - DECISION-THEMES-IN-PIECES
  - FEATURE-THEMES
  - FEATURE-APPEARANCE-STYLES
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
---

# Appearance is four schemes × four styles

Supersedes the palette list and the MODE axis of [[DECISION-THEMES-IN-PIECES]] (everything else there — hand-written CSS as source of truth, unanchored selectors, frozen token names — still holds).

## Context

Cory (2026-10-21): "update the appearance component with these colors and add options for both mixed and dim". "These colors" is the Magic Spells Design System colour model agreed that day: a Figma library (y77O6z4REJS50BISDZypJg, Color Schemes page, grid 98:2729) with a draft `Scheme` variable collection (modes Default / Cool / Warm / Void) and a draft `Style` collection (modes Light / Dim / Mixed / Dark). Pieces had `scheme` = default | dim | warm | void and `mode` = light | medium | dark.

## Decision

- **Four SCHEMES** (`data-scheme`, absent = default):
  - Default — "very tasteful dark grey with a slight blueish tint"; its dark cell was built from Pyramid, so pieces' Default dark now equals Pyramid's (body type is white, as in Pyramid).
  - Cool — replaces the `dim` palette. "Dim is going to be slightly more blue tinted… more like the Observatory blue color scheme in Constellation viewer"; "a little more blueish". File `cool.css`.
  - Warm — "browns and oranges", mostly unchanged.
  - Void — "very black and some dark greys with white text", mostly unchanged.
- **Four STYLES** on `data-theme`, picker order Dark, Dim, Mixed, Light:
  - Dark — everything dark (the dark half of every pair).
  - Dim — "between light and dark - lower contrast, more subtle". `color-scheme: dark`; the dim block re-declares the grounds and type. Replaces `medium`.
  - Mixed — "the darker sidebar with white main panel". `color-scheme: light`; the mixed block re-declares EXACTLY `surface-frame` and `bar-ink/-muted/-hover/-line` at the palette's dark values (the `rail-*` roles alias them). Anything on the frame must use bar-*/rail-* roles.
  - Light — everything lit.
- **Values**: grounds, lines and type per cell from the Figma draft (mapping: page→page, sidebar→surface-frame/frame-light, panel→surface-panel, card→surface and surface-card, well→surface-sunken, raised→surface-raised, border(-strong), ink/body/muted/faint, bar-*). Derived where Figma has no token: surface-base = panel in dark/dim, midpoint of page and panel in light. Figma's Accent / Status / Primary-button are one indigo set for every scheme (draft), so each scheme keeps pieces' own brand, status, tints, dashed border, ring, charts and alpha family. Figma Hover and Selected have no pieces token and are not mapped.
- **The runtime field stays `mode`** (stored JSON `{ scheme, mode }`, `data-default-mode`, the picker's `mode` prop): `style` collides with the HTML attribute on a component tag. Labels and docs say "Style".
- **Read aliases** in both appearance.js and pre-paint.js: scheme `dim` → `cool`, mode `medium` → `dim`. `mixed` is real now (0.8 aliased it to medium).

## Alternatives

- **Rename the field to `style`** — rejected: collides with `style=` on component tags and breaks every stored choice and `configure({ fallback: { mode } })` call for a name change.
- **Mixed as a region `color-scheme: dark` on the sidebar** — rejected: needs a region marker every app shell would have to adopt; Pyramid's mixed already works by tokens alone. Native scrollbars on the frame stay light in Mixed.
- **Take Figma's single indigo accent for every scheme** — rejected for now: it is a draft placeholder (Warm with an indigo accent loses its clay identity) and the Default indigo fails AA white-on-fill at #6366f1.

## Consequences

- `themes/dim.css` is gone (now `themes/cool.css`); `data-scheme="dim"` / `data-theme="medium"` written by hand in markup paints the default. Stored choices read forward.
- Tests: `test/contrast.test.mjs` holds all 16 cells to AA, requires dim grounds between dark and light with lower ink/panel contrast than dark, and mixed = dark frame + light panel; `test/themes.test.mjs` holds the dim and mixed blocks' shape.
