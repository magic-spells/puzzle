# Orrery Demo — Canvas Animation Driven by the Reactive Datastore

A little clockwork solar system rendered to a `<canvas>`. Planets orbit a glowing
sun; a side panel lists every body with live sliders for distance, size, speed
(retrograde supported), plus color and name. Drag a slider and the orbit retimes
**mid-animation**. Click a planet to select it; click empty space to spawn a new
one exactly where you clicked.

This README doubles as the **reference for wiring a `<canvas>` animation to Puzzle's
datastore**. Everything below was verified against the compiler and runtime source.

```bash
# from the repo root
./puzzle dev examples/orrery --port 3456   # or: go run ./compiler/cmd/puzzle dev examples/orrery
```

## Files

| File | Responsibility |
|---|---|
| `app/components/OrreryCanvas.pzl` | **The centerpiece.** rAF loop, dpr-aware sizing, painting, hit-test → select, click-to-spawn. Read this first. |
| `app/components/BodyRow.pzl` | One editable panel row per record; every input writes straight back via `body.update({...})`. |
| `app/views/Home.pzl` | Owns UI state (selection, running, trails); toolbar (add / pause / trails / reset). |
| `app/models/body.js` | The `body` model: parameters only — `distance`, `size`, `speed`, `color`, `phase`, `name`. |
| `app/seed.js` | The default five-planet scene (one retrograde). |
| `app/util.js` | Color/spawn helpers + `nextPlanetName`. |
| `app/app.js` | `PuzzleApp` config; seeds the scene after `mount()` if the store is empty. |

## How the canvas is wired to the datastore

Three ideas compose into the whole demo:

### 1. The store is the scene graph — positions never live in it

Each planet is a `body` record holding only its **parameters**: orbit `distance`,
`size`, `speed` (deg/sec, negative = retrograde), `color`, starting `phase`, and
`name`. A position is a pure function of parameters + elapsed time:

```
angle = phase + elapsedSeconds * speed        // degrees
x = centerX + cos(angle) * distance
y = centerY + sin(angle) * distance
```

So there is **no `x`/`y` in the store and no 60fps writes**. Storing positions
would mean flushing the datastore every frame — re-running `data()` on every
subscriber, defeating the point of a reactive store. Instead the store changes
only when a *parameter* changes: a slider drag, a spawn, a delete. Cheap.

### 2. requestAnimationFrame is the clock

`OrreryCanvas` starts a rAF loop in `mounted()` and cancels it in `destroyed()`
(navigating away can't strand a running loop). Each frame:

- computes `dt` from the timestamp and advances an elapsed-seconds counter —
  **only while `running`**, so pausing freezes time but the loop keeps painting
  (edits made while paused still show immediately);
- reads `const { bodies, trails, selectedId } = this.getData()` — always current
  (see #3) — and paints orbit rings, the sun (radial gradient), and each planet
  at its computed angle, recording every planet's `{x, y, r}` for hit-testing.

### 3. data() is the reactive bridge (auto-subscription)

`OrreryCanvas.data()` calls `this.ctx.store.findMany('body')`. Per the store's
tracking scope, that query **auto-subscribes the component to the whole `body`
type** (`client-runtime/datastore/store.js`: the subscription key is the record
*type*). So any `createRecord` / `update()` / `destroy()` — from a panel slider,
the Add button, a canvas spawn, anywhere — re-runs `data()`, and the next frame's
`getData()` already reflects it. The loop reads `getData()` **every frame** for
exactly this reason: no diffing, no manual redraw calls, no event bus. Drag the
speed slider and the orbit visibly retimes on the very next frame.

`Home` is subscribed the same way, so the panel list and the canvas are just **two
projections of one store** — pixels on the canvas, DOM rows in the panel — kept in
lockstep for free.

### Why width/height stay out of the `<canvas>` template

The vdom patcher only diffs attributes that appear in the template. If you write
`<canvas width=… height=…>`, every re-render re-applies (and can reset) them. So
the template declares **neither** — sizing is imperative, in `mounted()` and a
`ResizeObserver`, scaled by `devicePixelRatio` with `ctx.setTransform(dpr,0,0,dpr,0,0)`
so drawing happens in CSS pixels while the backing store stays crisp on HiDPI.
Because those attrs are never in the template, the patcher leaves them alone
across renders. (Same principle as any imperative-DOM escape hatch in Puzzle —
see the `binding` example's `afterUpdate()` innerHTML write.)

## The canvas writes back to the store

The reactive flow runs both directions. `stageClick` (a plain `@click` on the
canvas) turns a pixel into a store operation:

- **Hit a planet** (distance to a recorded position ≤ `r + 6`) → call the
  `select` **callback prop** (`this.props.select(id)`). `Home` binds
  `@select={ selectBody(event) }`, so the hit id flows up and highlights the row.
  Panel rows select the same way, binding the loop's id: `@select={ selectBody(body.id) }`.
- **Miss** → `store.createRecord('body', {...})` at the clicked orbit radius
  (clamped 40–280 px). The new planet's `phase` is derived from the click angle
  minus `elapsed * speed`, so it appears **exactly under the cursor** the instant
  it spawns. No redraw call — the subscription + loop handle it.

Panel edits go the other way: each `BodyRow` input calls
`this.props.body.update({ field })` (numbers coerced with `Number()` — range
inputs hand back strings). One `update()` re-renders the row *and* retimes the
orbit, because both the row (via props) and the canvas (via `findMany`) react to
the same record change.

## Ideas to extend

- **Moons** — add `parentId` to the model; a body orbits its parent's computed
  position instead of the sun. (Compute parents first each frame.)
- **Comets** — high eccentricity: give bodies an ellipse (`a`, `b`, tilt) instead
  of a circle, all still derived, still position-free.
- **WebGL** — swap the 2d context for a WebGL renderer; the store/loop split is
  unchanged — only `_paint()` changes.
- **Persistence** — pass `storage: window.localStorage` to the store so a tuned
  system survives reloads (the store already supports it; this demo opts out).
- **Selection detail** — a detail pane for the selected body (mass, period =
  `360 / |speed|` seconds), or nudge parameters with the keyboard.
