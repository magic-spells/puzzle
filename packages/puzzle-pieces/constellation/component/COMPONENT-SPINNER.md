---
name: Spinner — seven CSS-only loading designs
status: built
framework: puzzle
props:
  - name: variant
    type: '''ring'' | ''ticks'' | ''trace'' | ''dots'' | ''snap'' | ''spark'' | ''heartbeat'''
  - name: size
    type: '''sm'' | ''md'' | ''lg'''
  - name: label
    type: string
  - name: class
    type: string
variants:
  - ring
  - ticks
  - trace
  - dots
  - snap
  - spark
  - heartbeat
connections:
  - DECISION-CSS-ONLY-MOTION
  - DOC-REGISTRY
---


One file, one root: every variant is a single inline `<span role="status" aria-label>` (default label 'Loading'); the moving parts inside are aria-hidden. `ring` is the default and keeps the pre-0.8 classes byte-for-byte (plus `motion-reduce:animate-pulse`), so existing `<Spinner/>` calls are unchanged. Button's own loading ring is a separate inline span in Button.pzl and was not touched. Keyframes live in the file's `<style>` block — see [[DECISION-CSS-ONLY-MOTION]].

## The designs

- **ring** — border-border ring, brand top edge, `animate-spin`.
- **ticks** — 8 currentColor pills, each on an arm rotated `--i * -45deg`. One keyframe fades opacity AND shortens `scale-y` from the inner end (`origin-bottom`), run with `steps(8)` and `--i * -100ms` delays, so the head jumps tick to tick and the trail tapers in both opacity and length.
- **trace** — squircle in a 24-unit viewBox, border track + brand segment (`pathLength="100"`). Head and tail are two `@property`-registered numbers animated by the same four-stop keyframe (corner midpoints 12.5/37.5/62.5/87.5, one ease-in-out interval per side); the tail runs 200ms behind. Dash length = `mod(head - tail + 100, 100)`, so it stretches on the straights and bunches in the corners.
- **dots** — three currentColor dots written in on a positive `--i * 120ms` delay (scale+opacity with an overshoot bezier); the ROOT fades all three together. A dot resets at 82% of its own cycle, which with 120ms stagger always lands while the row is invisible — widen the stagger past ~130ms and dot 3 pops back visibly.
- **snap** — 2×2 currentColor tiles, one at full strength, three at `opacity-40`. Tiles drift out along `--x/--y`, snap back with a 7% inward overshoot; the root takes four eased quarter-turns across a 4800ms keyframe, so the bright tile walks the corners and the loop closes at 360°. Padding (p-0.5/1/1.5) keeps the 45° mid-turn inside the box.
- **spark** — brand gradient four-point star (24-point clip-path, a superellipse with exponent 2.8), twinkling in scale/rotate/opacity, plus a `size-1/5` satellite on a rotating arm that fades in and out; geometry keeps the satellite inside the box and clear of the main star's tips.
- **heartbeat** — currentColor dot on a lub-dub `scale` keyframe; a bordered ring the same size scales to 2.5× and fades from the second beat. Rests ~65% of the 1300ms cycle.

Colour: ring and trace use border + brand tokens; spark is brand-tinted; the rest are currentColor, so they inherit a button's text colour or a `text-*` class.

## Gotchas

- **`vector-effect: non-scaling-stroke` breaks `pathLength` dashes in Chromium** — the dash pattern is laid out in screen space, so the segment split in two at sm and lg. The trace instead sets `stroke-width` per size (3 / 2 / 1.2 user units = 2px at 16 / 24 / 40px). Keep the 24-unit viewBox if you touch it.
- The parts' animations are in `@layer components`, so the root's `motion-reduce:animate-pulse` utility beats them; the reduced-motion block only has to stop the parts and set their static pose.
- Docs: `demo/app/views/components/SpinnerDoc.pzl` shows every variant × size, Button usage, a chat bubble for `dots`, and currentColor usage.
