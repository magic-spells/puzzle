---
name: Loading motion is our own CSS-only design, with keyframes in the piece
status: built
connections:
  - COMPONENT-SPINNER
  - COMPONENT-SHIMMER-TEXT
  - DOC-REGISTRY
  - DECISION-THEMES-IN-PIECES
  - DECISION-COPY-IN-DISTRIBUTION
---


# Loading motion is our own CSS-only design, with keyframes in the piece

## Context

0.8.0 grew the Spinner from one rotating ring into seven designs and added ShimmerText. Both need keyframes and a few properties no Tailwind utility can express (per-part stagger and rotation from a `--i` custom property, the trace variant's SVG dash maths, the spark's clip-path). The pieces guide allowed a `<style>` block only for machine-generated class names (the `code` piece), and pieces are copied into apps by `puzzle add piece`, which writes `theme/pieces.css` only when the app has no tokens yet.

## Decision

- **Our own designs, no borrowed loader code.** Every variant (ticks, trace, dots, snap, spark, heartbeat) and the ink shimmer are original to this registry; nothing is copied from loader libraries.
- **CSS only.** Keyframes plus CSS; no rAF, no timers, no JS text splitting. Staggers are one keyframe per effect driven by a per-part `--i` custom property, never one keyframe per part.
- **Keyframes live in the piece's own `<style>` block**, global (not `scoped`), every name prefixed with the piece name (`spinner-*`, `shimmer-text`), wrapped in `@layer components` so utilities in `class` still win, with a `prefers-reduced-motion` section. Layout, size and colour stay Tailwind utilities on theme tokens. This is the pieces guide's second sanctioned `<style>` exception (CLAUDE.md, Piece conventions).
- **Reduced motion** swaps every variant's motion for Tailwind's `motion-reduce:animate-pulse` on the root while the parts hold a still-busy pose (static tapered ticks, a parked trace segment, written dots).

## Alternatives

- **`--animate-*` tokens and `@keyframes` in `theme/pieces.css` `@theme`** — rejected: the CLI copies pieces.css only when the app lacks it, so every existing app would get a piece with no animations, and the four theme files are held to one token set by `test/themes.test.mjs`, which motion tokens have no business in.
- **Tailwind arbitrary values** (`animate-[…]`, `[clip-path:…]`, `[animation-delay:calc(…)]`) — rejected: raw values in markup, which the registry forbids, and the keyframes would still need a home.
- **JS-driven animation** — rejected: needless runtime, fights the patcher, and pauses in background tabs.

## Consequences

- The component CSS is appended after Tailwind's output, so `@layer components` there joins Tailwind's own components layer (declared before utilities).
- `code`'s header comment still calls itself "the only piece that carries a `<style>` block" — stale since 0.8.0.
