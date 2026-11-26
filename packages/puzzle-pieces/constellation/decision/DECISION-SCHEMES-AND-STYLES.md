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
      Delete buttons are always the darker red with white text, in every scheme. Three CONSTANT
      tokens carry it: `--color-danger-solid: #d11f1f`, `--color-danger-solid-hover: #a41616` and
      `--color-danger-solid-ink: #ffffff`, with the same values in every scheme and style (no
      light-dark(), no dim or mixed override). Each palette block still states them (pieces.css
      @theme plus the [data-scheme='default'] restatement, and cool/warm/void), as the token-set
      parity rule requires. Every solid danger fill uses them: Button `destructive`, SplitButton
      Action/Menu `destructive`, the AlertDialog destructive confirm, the Popconfirm danger confirm,
      and the delete buttons in the Dialog, Sheet and BottomSheet docs. `--color-danger`, `-dark`,
      `-ink` and `-on-tint` stay per-scheme, for danger text, outlines, tints and indicator fills
      (Meter, Timeline). contrast.test.mjs measures danger-solid-ink on danger-solid (5.35:1) and on
      danger-solid-hover (7.76:1) in all 16 cells. The rejected alternative was a dark-half pair:
      dark's #ef4444 with near-black text, whose hover went LIGHTER (#f87171).
  - kind: decision
    text: >-
      Quiet buttons: brand fills stood out too much on a screen full of buttons, but buttons must
      still differ a little from the ground. Button fills do not use brand. primary = `bg-ink
      text-page hover:bg-ink/85`; secondary = `bg-ink/6 text-ink hover:bg-ink/10` (an ink TINT, not
      a surface token, so it is a visible step off page, panel and raised in every style); outline =
      `border border-border-strong text-ink hover:bg-ink/6` (transparent so it sits on any ground);
      ghost hovers on the same 6% tint; destructive uses the danger-solid tokens. No new tokens. The
      same recipes are copied into SplitButton Action/Menu, ButtonGroup, CopyButton, AlertDialog and
      Popconfirm confirm buttons, the DropdownMenu `button` trigger, and Pagination's current page
      (ink) and its hovers. Brand stays for focus rings, selection, links and active indicators
      (Tabs `buttons` selected tab, Calendar selected day, Stepper complete, Checkbox/Switch/Radio,
      chip remove hovers). contrast.test.mjs measures, per cell: page on ink and on ink/85 over
      page/surface/raised ≥4.5; ink on ink/6 and ink/10 ≥4.5; ink/6 vs its ground ≥1.08:1 and ≥0.03
      OKLCH L. Gotcha: the tint and primary are panel-ink based, so a Button drawn on the mixed
      style's dark frame paints dark-on-dark; anything on the frame must use bar-*/rail-* utilities.
  - kind: decision
    text: >-
      The button family's disabled look is `disabled:opacity-50 disabled:cursor-not-allowed` (no
      `disabled:pointer-events-none`), and every hover is written `not-disabled:hover:…` (compiles
      to `:not(:disabled):hover`). pointer-events-none would kill the `title` tooltip and force apps
      to wrap disabled buttons in `<span title>`. It applies to button, button-group, split-button
      Action, copy-button, alert-dialog and popconfirm buttons, pagination prev/next, toggle,
      toggle-group and toolbar items. Non-<button> triggers (split-button Menu, dropdown-menu
      Trigger) cannot match :disabled and do not use it.
  - kind: state
    text: >-
      The token contract includes one shadow, `--shadow-kbd: inset 0 -1px 0 var(--color-border)`
      (the keycap bottom seam used by Kbd, DropdownMenu.Shortcut and Menubar.Shortcut). It is
      declared in pieces.css (@theme + the [data-scheme='default'] restatement), cool/warm/void,
      test/lib/roles.mjs and demo tokenNames.js. An app whose pieces.css predates the token renders
      keycaps without the seam until it runs `puzzle add theme default`, and `add piece` prints that
      stale-theme hint.
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
