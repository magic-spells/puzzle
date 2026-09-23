---
name: Hamburger — menu button with converge and twist motion
status: built
framework: puzzle
props:
  - name: variant
    type: '''converge'' | ''twist'''
  - name: open
    type: boolean (optional-controlled)
  - name: animate
    type: boolean
  - name: size
    type: '''sm'' | ''md'' | ''lg'''
  - name: label
    type: string
  - name: controls
    type: string
  - name: disabled
    type: boolean
  - name: class
    type: string
variants:
  - converge
  - twist
connections:
  - DECISION-CSS-ONLY-MOTION
  - DOC-REGISTRY
---

A real `<button type="button">` with `aria-expanded` (string form), optional `aria-controls`, and a static label (default 'Menu' — aria-expanded carries the state). Three aria-hidden sibling `<span>` bars stacked in one grid cell, so the X is centred by construction. Optional-controlled (DatePicker's shape): pass `open` and the parent owns it; omit it and the button toggles itself. `@change(nextOpen)` fires either way. Added 0.8.0 (PR #148). Inspired by jonsuh/hamburgers (squeeze / spin / slider) but a clean rewrite with new names.

## Why spans, not pseudo-elements

The original library draws the top and bottom bars as `::before`/`::after` of the middle bar, so they inherit its transform — the X needs a parent rotation plus a counter-rotation, and the middle bar can't fade without fading all three. Sibling spans move independently, which is what lets each bar's two phases be a single per-property transition.

## Motion


- Each bar moves with the individual `translate` and `rotate` properties, never `transform`, so each property has its own duration, delay and easing. Both variants are two-phase: the closed and open rules swap which property waits — open = translate in, then rotate; close = unrotate, then spread.
- **converge** (default): slide in 140ms ease-out, turn 240ms spring; close unturns 150ms, spreads 140ms.
- **twist**: same, but the turn runs to 225° / 135° over 300ms, so the X lands after half a spin; close unturns 220ms.
- A third, single-phase `slide` variant (middle bar slid out sideways while fading, everything at once) shipped in PR #148 and was removed on release/0.8.0 before release at Cory's call — two motions are enough.
- The spring (ζ 0.7, ~4.6% overshoot, 21-point `linear()`) is used only for turning INTO the X. On close it overshot past 0° just as the bars spread and looked sloppy, so the unturn uses `cubic-bezier(0.4, 0, 0.2, 1)`.
- All timings are `--hamburger-*` custom properties set per variant; geometry is bar width / thickness / gap per size, every offset derived by calc().

## Gotchas


- Transitions exist ONLY under `prefers-reduced-motion: no-preference` AND `data-animate='true'` — inverted from Spinner's reduce-block, to avoid a specificity fight between variant rules and "off" rules. `animate={false}` and reduced motion both swap instantly.
- Colour is inherited `currentColor` (no default colour rule), so the bars match a header's text colour like Spinner's currentColor variants; `text-*` in `class` sets it.
- The hover fill (`--color-surface-sunken`) is in the `<style>` block's `@layer components`, NOT a `hover:bg-*` utility. Two same-property utilities resolve by Tailwind's sort order, not class order, so a utility hover in the piece beat callers' `hover:bg-brand-*` / `bar-*` / `rail-*` (review of PR #148; fixed on release/0.8.0). Bar geometry sits in the block too, since every offset derives from per-size custom properties — both deviations are noted in CLAUDE.md's CSS-only-motion paragraph.
- A second click during the open's 140ms move phase makes the close wait its lag before spreading — a brief pause CSS alone can't avoid.
- Docs: `demo/app/views/components/HamburgerDoc.pzl`, in the nav's Content section next to Toggle. Guarded by `test/hamburger.test.js` and the 0.7.0 colour-token guard in `test/loading-pieces.test.js`.
