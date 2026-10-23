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
notes:
  - kind: decision
    text: >-
      2026-10-21, Cory: "the delete buttons should always be the darker red with the white text on
      all color schemes". There are three new CONSTANT tokens: `--color-danger-solid: #d11f1f`,
      `--color-danger-solid-hover: #a41616` and `--color-danger-solid-ink: #ffffff`. They have the
      same values in every scheme and style, with no light-dark(), and no dim or mixed block
      overrides them. Each palette block states them (pieces.css @theme plus the
      [data-scheme='default'] restatement, and cool/warm/void), as the token-set parity rule
      requires. Every solid danger fill now uses them: Button `destructive`, SplitButton Action/Menu
      `destructive`, the AlertDialog destructive confirm, the Popconfirm danger confirm, and the
      delete buttons in the Dialog, Sheet and BottomSheet docs. `--color-danger`, `-dark`, `-ink`
      and `-on-tint` stay per-scheme, for danger text, outlines, tints and indicator fills (Meter,
      Timeline). contrast.test.mjs measures danger-solid-ink on danger-solid (5.35:1) and on
      danger-solid-hover (7.76:1) in all 16 cells. This matches Pyramid 656aa2f6. The rejected
      alternative was a dark-half pair: dark's #ef4444 with near-black text, whose hover went
      LIGHTER (#f87171).
  - kind: decision
    text: >-
      2026-10-22, quiet buttons. Cory: "the blue buttons really stand out and when there are a lot
      of buttons on the screen it's too much to look at" and "we still want these buttons to be a
      little different from the bg color so they stand out". Button fills no longer use brand.
      primary = `bg-ink text-page hover:bg-ink/85`; secondary = `bg-ink/6 text-ink hover:bg-ink/10`
      (an ink TINT, not a surface token, so it is a visible step off page, panel and raised in every
      style; surface-sunken nearly vanished in dark); outline = `border border-border-strong
      text-ink hover:bg-ink/6` (transparent so it sits on any ground; border-border was too faint
      without the old bg-surface fill); ghost hovers on the same 6% tint; destructive unchanged. No
      new tokens. Copies of the recipes changed with it: SplitButton Action/Menu, ButtonGroup,
      CopyButton, AlertDialog and Popconfirm confirm buttons, the DropdownMenu `button` trigger,
      Pagination's current page (now ink) and its hovers. Brand stays for focus rings, selection,
      links, active indicators (Tabs `buttons` selected tab, Calendar selected day, Stepper
      complete, Checkbox/Switch/Radio, chip remove hovers were left on brand as selection/badge
      uses). contrast.test.mjs measures, per cell: page on ink and on ink/85 over
      page/surface/raised ≥4.5; ink on ink/6 and ink/10 ≥4.5; ink/6 vs its ground ≥1.08:1 and ≥0.03
      OKLCH L (observed min 1.10 and 0.036, Cool light). Gotcha: the tint and primary are panel-ink
      based, so a Button drawn on the mixed style's dark frame paints dark-on-dark; anything on the
      frame must use bar-*/rail-* utilities. Pyramid's controls.css and the Figma library follow.
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
