# Kanban Morph — Shared-Element Route Transitions in Puzzle

The kanban demo, upgraded: **click a task card and it morphs open into its detail
dialog** — a spring-driven blob grows from the card's exact rect, radius, border and
shadow into the dialog's, the card's content dissolves, and the dialog settles with the
spring's bounce. Closing (✕, backdrop, Escape, **or the browser back button**) flies it
back into the same card. Drag-and-drop from the base kanban example still works — the
FLIP reorder and the morph coexist.

This README doubles as the **reference for adding shared-element morphs to any Puzzle
app** (v1.23, D55 — see `constellation/decision/DECISION-D55-MORPH-TRANSITIONS.md`).

```bash
# one-time: the morph engine is an npm dependency of this example
cd examples/kanban-morph && npm install

# from the repo root
./puzzle dev examples/kanban-morph --port 3021
```

## The whole integration (three touches, zero per-view code)

**1. Activate once, in app.js:**

```js
import { enableMorph } from '@magic-spells/puzzle/morph';
enableMorph(app); // returns the MorphEngine for live tuning / events
```

**2. Mark the card** (`components/TaskCard.pzl`) — the attribute goes on the element
whose radius/background/border/shadow you want captured (here the styled card body,
not the unstyled wrapper):

```html
<article class="kanban-card-body" data-puzzle-morph="task-{ task.id }">
```

**3. Mark the dialog shell** (`views/TaskDialog.pzl`) with the **same value**:

```html
<div class="task-dialog ..." data-puzzle-morph="task-{ taskId }">
```

That's it. The click handler just navigates (`router.push('/task/' + id)`), the close
handler just navigates back (`router.push('/')`). The router pairs elements sharing a
`data-puzzle-morph` value on every swap: on the way in it morphs from the surviving
element (the card) into the freshly mounted one (the dialog), and on the way out it
awaits the reverse flight **before destroying the dialog's view** — which is why the
back button morphs too (same pipeline).

## The route shape that makes it work

The dialog is a **child route rendered in the board's `<Slot/>`** — the board (and the
clicked card) stays mounted underneath for the morph's whole round trip:

```js
{
  path: '/', view: BoardView, layout: DefaultLayout,
  children: [
    { path: '', view: EmptyOverlay },              // index: board alone
    { path: 'task/:taskId', view: TaskDialog },    // overlay: board + dialog
  ],
}
```

A `{#if}`-toggled dialog can't do this declaratively (a false branch is removed from
the DOM entirely and a patch-time removal can't be awaited) — non-route morphs use
`@magic-spells/morph-engine` directly instead.

## Semantics worth knowing

- **Deep links never morph.** Navigation #0 renders plainly — load `/task/task-4`
  directly and the dialog just appears.
- **Params-only switches never morph.** `/task/task-1` → `/task/task-2` re-points the
  mounted dialog (its `data()` re-runs); no swap, no flight. Closing afterwards is an
  instant close, not a morph to the wrong card — the pairing id changed since show.
- **Interruptions are free.** Escape mid-open reverses the spring from wherever it is.
- **`prefers-reduced-motion` disables morphing** entirely.
- **Scroll**: this app sets `scrollBehavior: false` — the default scroll-to-top on push
  would yank the board (and the card) upward mid-pairing.

## Rules for morph elements

- Put the attribute on the element carrying the **visible surface styles** — the blob
  captures computed radius/border/background/shadow from it.
- No transform-based positioning and no stylesheet `opacity` on the dialog shell
  (center with flex or `inset: 0; margin: auto`); no `transition` rules on it.
- No **changing** dynamic `style={}` binding on either element — the patcher rewrites
  the whole style attribute and would clobber the engine's inline frames.
- Morphing views shouldn't also declare `animations.in/out`. App-owned chrome like the
  backdrop is styled normally (this demo fades it via CSS, toggled in `viewWillHide`).

## Coexistence with drag-and-drop

Both systems write card transforms, but never at the same time: the FLIP fires on drag
reorders (`beforeUpdate`/`afterUpdate` rect snapshots), the morph on navigation. A
sub-threshold pointerup falls through to the click branch and opens the dialog; a real
drag never navigates. See the base `examples/kanban` README for the full DnD reference.
