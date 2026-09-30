---
name: Animations, route transitions, and morph flights
kind: integration
status: built
framework: vitest
connections:
  - COMPONENT-ANIMATIONS
  - COMPONENT-MORPH
  - COMPONENT-ROUTER
  - FILE-ANIMATE
  - FILE-VISIBILITY
  - FILE-MORPH
  - FILE-TESTS-ROUTER-OVERLAP-TEST
  - DECISION-D28-ANIMATIONS
  - DECISION-D55-MORPH-TRANSITIONS
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D65-PER-ROUTE-TRANSITION-MODE
  - DECISION-D68-CROSS-VIEW-MORPH
  - DECISION-D69-MORPH-ROLES
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
  - DECISION-D85-FLIP-ATTRIBUTE
  - TEST-BROWSER-SMOKE
  - DOC-TESTING
---

# Animations, route transitions, and morph flights

Everything WAAPI-driven, from one view's enter animation to two routes animating
past each other. Suites under `tests/`: `animations`, `leave-inertness-and-hooks`,
`scroll-trigger-animations`, `flip-reorder`, `router-transitions`,
`router-overlap`, `router-morph`, `morph-cross-view`, `morph-teardown`. jsdom
has no WAAPI, so these install a fake and drive it deterministically; real timing
is left to [[TEST-BROWSER-SMOKE]].

- **View level:** animation-spec normalization and playback, enter/leave hook
  ordering with and without animations, `destroy()` vs `destroyAnimated()`,
  enter on component mount and leave on removal, reduced motion zeroing
  durations at the source, FLIP keyed reorder (`flip` never reaching markup),
  and scroll-triggered enters — hold and reveal, offset to rootMargin,
  degradation without an observer, teardown, and the shared observer registry.
- **Route level:** sequential transitions under a reused layout, views without
  animations keeping the same timing, interruption under the token guard, layout
  swap vs reuse, and navigation zero playing the routed view in exactly once.
  Overlap mode separately: the incoming view mounts and commits while the
  outgoing still fades, hook order in that window, instant interruption, a failed
  navigation mid-overlap, and patch-driven leaver removal under a reused layout.
- **Morph level:** the router morph handler, supersession during the out phase,
  cross-view capture flights, and teardown with a double-install guard.
