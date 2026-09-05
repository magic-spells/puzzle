---
name: SplitPanel family
status: built
framework: puzzle
props:
  - name: direction
    type: string
  - name: snap
    type: boolean|string|number[]
  - name: disabled
    type: boolean
  - name: id
    type: string
  - name: sizes
    type: number[]
  - name: class
    type: string
variants:
  - horizontal
  - vertical
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
---

`SplitPanel` · `SplitPanel.Pane` · `SplitPanel.Divider`, a D167 family over
`@magic-spells/split-panel` 0.2.0. Replaced a 708-line port with its own
geometry, snap math, localStorage code and hand-written separator markup.

## Dividers are AUTHORED — the whole reason `Divider` is a member

0.2.0 adopts an author-supplied `<split-divider>` and generates one only where an
adjacent pair has none. The piece never relies on generation: a generated divider
is a foreign node sitting BETWEEN keyed Puzzle siblings, and the patcher does not
know it exists, so the next reorder moves or drops it. Authoring every divider
keeps Puzzle the owner of every child of the group. The root dev-warns once when
`:scope > split-divider` count ≠ panes − 1.

## Sizes default to uncontrolled, deliberately

A drag emits `split-panel:resize` on every applied change. Routing each through
parent state and back is a full subtree re-render per frame that fights the live
gesture. So the recommended shape is `size` on each Pane plus an `id` for
persistence; `@resize` is advisory (readouts) and `@resizeEnd` is the commit hook.
The header and the docs both say: do not drive `sizes` from `@resize`.

## The setSizes echo guard

`setSizes()` calls `#commit()`, which dispatches `split-panel:resize-end`. Without
`#syncing` around the write, the piece would report its own write, the parent
would echo it back, and the loop would never settle. The guard plus a rounded
array compare against `element.sizes` is what makes optional-controlled `sizes`
safe.

## Token bridge

The component's stylesheet declares divider colour, hover, active and focus-ring
as `--split-panel-*` custom properties with plain CSS defaults. The root maps them
onto pieces.css tokens with a constant inline `style` on the host — paint knobs,
not layout, and the only place they can be set without a `<style>` block.
