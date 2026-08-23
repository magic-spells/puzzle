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
  - FEATURE-MORPH-TRANSITIONS
  - FEATURE-OVERLAPPING-TRANSITIONS
  - DOC-TESTING
---


# Animations, route transitions, and morph flights

Everything WAAPI-driven, from a single view's enter animation up to two routes
animating past each other.

View level: animation-spec normalization and playback, enter/leave hook ordering
with and without animations, `destroy()` versus `destroyAnimated()`, enter on
component mount and leave on component removal, reduced motion zeroing durations
at the source, FLIP keyed reorder (and `flip` staying a framework directive that
never reaches markup), and scroll-triggered enters — hold and reveal, offset to
rootMargin, degradation without an observer, teardown and interruption, and the
shared observer registry.

Route level: sequential transitions where both views animate under a reused
layout, views without animations keeping the same timing, interruption under the
token guard, layout swap versus layout reuse, and initial navigation playing the
routed view in exactly once. The overlap mode is proven separately — the
incoming view mounts and commits while the outgoing is still fading, hook
ordering inside that window, interruption staying instant, a failed navigation
mid-overlap, and patch-driven leaver removal under a reused layout.

Morph level: the router morph handler, supersession during the out phase,
cross-view capture flights, and teardown with a double-install guard.

jsdom has no WAAPI, so these suites install a fake and drive it deterministically;
real timing is left to the browser smoke suite.

Covers 8 files under `tests/`.
