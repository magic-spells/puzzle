---
name: SplitText wrapper over split-text
status: built
framework: puzzle
props:
  - name: split
    type: '''words'' | ''chars'' | ''lines'''
  - name: effect
    type: >-
      'rise' | 'drop' | 'slide-right' | 'slide-left' | 'bloom' | 'spin-x' | 'spin-y' | 'magnetic' |
      string
  - name: delay
    type: number
  - name: stagger
    type: number
  - name: duration
    type: number
  - name: easing
    type: string
  - name: trigger
    type: '''visible'' | ''load'' | ''manual'''
  - name: offset
    type: string
  - name: play
    type: unknown (replay token)
  - name: class
    type: string
  - name: start
    type: ({ split, count }) => void
  - name: complete
    type: ({ split, count }) => void
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DOC-REGISTRY
---


Single-file wrapper over `@magic-spells/split-text` 0.2.0 (0.8.0,
feat/piece-split-text). A text reveal: the element splits its own text into words,
graphemes or detected lines, masks each unit and animates it in on a CSS stagger.
Nothing is ported — the splitter, the eight effect keyframes, the
IntersectionObserver trigger and the reduced-motion short-circuit are all upstream's.

## Replay is a token prop, not a method

`play` is any value the parent changes; `afterUpdate` is edge-triggered on it and calls
the element's `split()` (plus `reveal()` when `trigger="manual"`, which has no trigger to
re-arm). A render carrying the same token does nothing, so an unrelated re-render can
never restart the animation, and the parent keeps ownership of "has it played". No
`@ready` handle is exposed — the token covers every case a method would, and it is the
controlled shape.

It is also the ONLY way a changed attribute reaches the screen: the element declares no
`observedAttributes` and reads `split` / `effect` / the three timings / `easing` /
`trigger` / `offset` once, when it splits. The docs page's effect gallery is exactly that
— eight `trigger="manual"` cards behind one shared token.

## Gotchas

- **Content must be static.** At connect the element REPLACES its own text nodes with
  nested spans, so Puzzle's patcher no longer owns that subtree. Literal markup only;
  changing the text means changing it AND bumping `play` in the same render. Inline tags
  (`<em>`, `<a>`, `<br>`) survive the split. An `island` would express this, but the
  compiler forbids a composition marker inside one, so the rule is documentation.
- **`style` is not a prop.** The element writes `--split-text-delay` / `-stagger` /
  `-duration` / `-easing` into the host's inline style at every split, and the patcher
  rewrites a bound `style` wholesale. The tunable custom properties are inherited, so
  they go through `class` as arbitrary-property utilities
  (`class="[--split-text-distance:40%]"`). `aria-label` is unbound for the same reason:
  the element fills in an absent one itself.
- **First paint is blank, deliberately.** The stylesheet hides
  `split-text:not(:defined)` so the text cannot flash in its finished pose before the
  module lands — which means prerendered copy is invisible until it does. Reserve the
  space above the fold; don't wrap body copy that must be readable without JS.
- **Reduced motion is handled upstream and early** — revealed in `connectedCallback`
  before any splitting, so there are no spans at all. `@complete` still fires with
  `count: 0`, so a parent chaining off the reveal is not stranded.
- `effect` is NOT validated against the eight built-ins: `SplitText.registerEffect()`
  makes an effect name a CSS contract, so a custom name has to reach the attribute.

## Verified

`test/split-text-wrapper.test.js` guards the manifest, the registry.json mirror, the
byte-identical demo copy, the dynamic import inside `mounted()`, the absent `style` /
`aria-label` bindings and the edge-triggered `play`. Browser-smoked on the docs page:
word / chars / lines splitting, replay, the eight effects behind one token, the
scroll-triggered reveal and a reduced-motion context (revealed, 0 units).
