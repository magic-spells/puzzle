# overlays

The `<Portal>` example (D144 / product line v1.66). One page, four overlays,
three of them teleported.

```bash
npm install
npm run dev      # or: ../../puzzle dev
```

Plain SPA output. Portals serialize to nothing under the prerenderers, so
`hybrid`/`static` would buy this app nothing.

## What each case shows

**1 · Toasts — `app/components/ToastStack.pzl`, `ToastItem.pzl`**

A `toast` model in the store, a stack mounted once in the layout and portaled
to the outlet. Buttons anywhere in the app call
`store.createRecord('toast', …)`; the stack subscribed by querying toasts
inside its own `data()`. No event bus, no imperative `toast()` helper, no ref
reaching into an overlay. Each toast owns its own auto-dismiss timer in
`mounted()`/`destroyed()` — the teleported subtree keeps its normal lifecycle.

**2 · A menu that escapes its card — `app/components/ClippedCard.pzl`**

The card sets `overflow: hidden` *and* `transform: rotate(-0.25deg)`, so it is
a real containing block: even `position: fixed` inside it would be trapped and
then clipped. The `⋯` menu renders through `<Portal>`, positioned from a
`getBoundingClientRect()` on the trigger's `ref`.

The point of the case is the dismissal. `@click:outside` is bound on the
**card**, not on the menu — and clicking the portaled menu does not dismiss it.
D144's outside-modifier uses *logical* containment: a target physically inside
the outlet is resolved back to its owning portal's placeholder, and the
containment test re-runs from there. The placeholder is inside the card, so the
menu counts as inside.

**3 · Panel or modal — `app/components/SlideOver.pzl`, `NativeModal.pzl`**

Portal for non-modal overlays; `<dialog>.showModal()` for modals. The
slide-over is portaled and leaves the page live — scroll it, click it, fire a
toast from inside it. Its body is `<Children/>` *inside* the `<Portal>`: the
content is written by the caller in `Home.pzl`, with the caller's data and
handlers, and renders in a node the caller is not a DOM ancestor of.

The modal deliberately does **not** use a Portal. The browser's top layer
already escapes every ancestor stacking context, transform and overflow, and
throws in a focus trap, an inert background, `::backdrop` and Escape-to-close.
That is D144's own recommendation.

## Two things that surprise people

- **`<Portal>` cannot be a component's root.** A component template's root must
  be an element or a component, so a component whose entire output is
  teleported still needs one local element to be rooted at. `ToastStack` and
  `SlideOver` both wrap the portal in a `display: contents` div.
- **Template text is not entity-decoded.** Writing `&lt;Portal&gt;` in a
  template prints those six characters. The captions here pass the tag names
  through `data()` as strings instead — interpolations become text nodes.
