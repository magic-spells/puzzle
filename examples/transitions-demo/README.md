# Transitions Demo

A side-by-side comparison of Puzzle's two route-transition modes (v1.24, D56 —
see [SPEC §26](../../constellation/doc/DOC-SPEC.md)).

The **same** three-route app is mounted **twice** on one page:

- **Left** — default **sequential** transitions. The outgoing view's `out`
  animation plays to completion, *then* the incoming view mounts and plays `in`.
  With a shared-axis slide this shows a tell-tale blank gap between the two.
- **Right** — `transitionMode: 'overlap'`. The router pins the leaver in place
  (`position: fixed` at its measured rect, no wrapper) and mounts the newcomer
  immediately, so both slides play **concurrently** and cross in the middle.

A single **shared control bar** drives *both* apps at once, so the difference is
instantly visible on every navigation.

## How it works

- **Memory-mode routers** (`routerMode: 'memory'`, `routerInitialPath: '/'`) —
  two apps coexist on one page with zero URL / history / `document.title` side
  effects. See [SPEC §15](../../constellation/doc/DOC-SPEC.md).
- **One shared layout** across all three routes, so navigation takes the
  reused-layout path — the routed **view** animates alone while the layout stays
  put ([SPEC §12](../../constellation/doc/DOC-SPEC.md)). That view swap is exactly
  what overlap mode pins and cross-slides.
- **Identical shared-axis slide** (`animations.in` / `animations.out`) on every
  view, so the *only* variable between the two columns is the transition mode.
- The control bar is plain DOM built in `app/app.js`: each route button calls
  `router.push(path)` on **both** apps; Back / Forward call `router.back()` /
  `router.forward()` on both (they work in memory mode too). The active route
  button is highlighted by reading `router.current.route.name` back after each
  navigation.

> **Note (SPEC §26):** the app columns and every ancestor up to `<body>` stay
> free of `transform` / `filter` / `contain` — those would re-root the overlap
> pin's `position: fixed` and break the effect. No Tailwind here — plain CSS via
> `<style>` blocks plus the page-shell `<style>` in `index.html`.

## Running the Example

From the repo root:

```bash
puzzle dev examples/transitions-demo
```

Or build the static output and serve `dist/`:

```bash
puzzle build examples/transitions-demo   # → examples/transitions-demo/dist/
```

Then open the served page and click the route buttons — watch the left column
gap versus the right column cross-slide.
