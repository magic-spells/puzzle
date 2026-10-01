---
name: 0.4.0 — measurement and capitalized markers
status: built
version: 0.4.0
connections:
  - RELEASE-V0-3-1
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D127-DISPLAY-COERCION-OWNER
---

# 0.4.0 — measurement and capitalized markers

Published 2026-07-28. Dev-only render profiling over the DevTools protocol
(zero production bytes) plus a production benchmark harness and stress app;
and capitalized composition markers — a capitalized tag is always resolved by
the framework or your imports.

## Upgrade notes

- `<children/>` → `<Children/>`; `<slot/>` in a component → `<Children/>`, in
  a routed view or layout → `<Slot/>`; `<slot name="x"/>` →
  `<Slot name="x"/>`. The call-site `slot="x"` attribute is unchanged. Every
  lowercase spelling is a positioned compile error naming the fix.
- A `null`/`undefined` interpolation renders empty, not the words.
