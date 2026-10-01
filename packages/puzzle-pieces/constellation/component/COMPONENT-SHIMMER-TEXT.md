---
name: ShimmerText — ink shimmer for pending text
status: built
framework: puzzle
props:
  - name: speed
    type: '''slow'' | ''normal'' | ''fast'' | number (ms)'
  - name: class
    type: string
slots:
  - name: children
connections:
  - DECISION-CSS-ONLY-MOTION
  - DOC-REGISTRY
  - COMPONENT-SPINNER
---


`<ShimmerText>Thinking…</ShimmerText>` — one inline span around `<Children/>`. The text is transparent and painted by its own background (`bg-clip-text`): a `from-muted from-35% via-ink via-50% to-muted to-65%` gradient at `background-size: 300%`, whose position a keyframe slides from 100% to 0% over 75% of the cycle (crest off-left → off-right), then rests. So the text's own colour deepens as the wave passes — ink soaking in, not a white shine — and it reads in every palette and mode without a tuned highlight colour.

- `speed` maps slow/normal/fast to 3200/2200/1400ms (or a number of ms) through `--shimmer-text-duration` in the inline style.
- The sweep is **linear** on purpose: an eased sweep spends its slow ends off the text and rushes the visible part (measured: the crest crossed "Thinking…" in ~0.6s of a 2.2s cycle with ease-in-out).
- No role or live region — pair it with a Spinner or an `aria-busy` region. A `text-*` class does not recolour it.
- Reduced motion: animation off, crest parked mid-line, root takes `motion-reduce:animate-pulse`.
- Keyframes in the piece's `<style>` block per [[DECISION-CSS-ONLY-MOTION]].
