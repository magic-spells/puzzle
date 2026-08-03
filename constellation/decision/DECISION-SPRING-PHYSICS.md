---
name: Spring physics is a registry dependency for snapping sheets
status: built
connections:
  - DOC-REGISTRY
  - DECISION-NATIVE-REBUILD
  - DECISION-COPY-IN-DISTRIBUTION
  - PLAN-PROJECT
notes:
  - kind: state
    text: >-
      The rebuilt `sheet` piece extends this boundary: `@magic-spells/frame-engine` joins
      physics-engine as the registry's second engine npm dependency (both plain, DOM-free JS).
      Sheet's motion core lives in registry/lib/sheet-engine.js — a verbatim port of the source web
      component's spring-keyframe engine — plus sheet-policy.js and sheet-drag.js, all pinned by the
      repo-root `npm test` suite (133 tests, including exact-number motion assertions and
      registry↔demo parity coverage). Unlike
      bottom-sheet's height-driven WAAPI/spring hybrid, sheet's engine drives full keyframe
      choreography per profile/effect. bottom-sheet deliberately remains the lighter-weight piece;
      sheet supersedes only the old drag-to-dismiss Sheet.pzl.
---

# Spring physics is a registry dependency for snapping sheets

## Context

`BottomSheet` settles between snap points after a drag. A fixed easing curve can
animate the distance, but it cannot inherit release velocity, so a careful drag
and a hard flick arrive with the same motion. The existing
`@magic-spells/physics-engine` package is plain, DOM-free JavaScript and is
therefore compatible with the copy-in boundary in
[[DECISION-COPY-IN-DISTRIBUTION]].

The sheet also needs its footer pinned and its content viewport equal to the
visible portion at every snap. A transform can move a fixed-height panel, but it
cannot express that layout contract.

## Decision

`@magic-spells/physics-engine` is the registry's third npm dependency and its
first engine dependency used for behavior other than morphing. The
`bottom-sheet` manifest declares it directly; the engine is constructed lazily
on the first snap settle, runs by default, and can be replaced for a settle with
the tuned WAAPI fallback via `spring="none"`.

Snapping is height-driven. Dragging and settling write the panel's height, then
return the resting value to `dvh`; transform is reserved for motion below the
shortest snap and final dismissal. This is a native `.pzl` rebuild under
[[DECISION-NATIVE-REBUILD]], not a wrapper over the source web component.

## Alternatives

- **Fixed WAAPI easing only** — retained as the explicit `spring="none"`
  fallback, but rejected as the default because it cannot carry release
  velocity into the settle.
- **Transform-driven snap positions** — rejected because the footer would not
  remain pinned to the visible bottom edge and the scroll region would not
  match the visible height.
- **Copy the physics implementation into the registry** — rejected because the
  published engine is already DOM-free, tested, and valid as a plain-JS npm
  dependency under the registry contract in [[DOC-REGISTRY]].

## Consequences

- Consumers of `bottom-sheet` install `@magic-spells/physics-engine`; the `.pzl`
  piece and pure sheet math still copy into the app as source.
- The engine is lazy, so binary sheets and sheets that never settle construct
  nothing.
- Resting snap heights use `dvh`, so viewport changes re-resolve without a
  resize listener.
- Height is written from JavaScript on spring frames. The dependency buys
  gesture feel and velocity continuity, not a rendering-performance
  optimization.
- A settling sheet that is grabbed again resumes from its painted height with
  zero retained momentum because the engine exposes no velocity getter.
