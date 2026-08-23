---
name: 0.4.0 — measurement and the marker rename
status: built
version: 0.4.0
connections:
  - RELEASE-V0-3-1
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D127-DISPLAY-COERCION-OWNER
---

# 0.4.0 — measurement and the marker rename

Published 2026-07-28. Two threads, joined by the same instinct: stop guessing.

The first is measurement. Dev-only profiling separates render-function cost
from diff/patch cost and counts actual DOM writes, so a render that mutates
nothing is visible as the waste it is — reported over the DevTools protocol,
with zero production bytes, all state in module WeakMaps so no runtime class
grows a field. A production benchmark harness and a stress app give it
something to point at. "Is this slow?" became a question with an answer.

The second is the composition-marker rename. Capitalization now uniformly
means "the framework resolves this tag": components come from your imports,
markers come from the grammar. The old lowercase spelling was worse than
inconsistent — a bare `<slot>` meant two different things depending on where
it sat.

The rename rippled well past this repo: the editor grammars, puzzle-pieces,
the demo apps, and the site all had to follow it.

## Upgrade notes

- **Capitalize the composition markers.** `<children/>` → `<Children/>`;
  `<slot/>` in a component → `<Children/>`; `<slot/>` in a routed view or
  layout → `<Slot/>`; `<slot name="x"/>` → `<Slot name="x"/>`. The call-site
  `slot="x"` **attribute** is unchanged — only the tags moved. Every lowercase
  spelling is a positioned compile error, and all but bare `<slot>` name the
  replacement outright; bare `<slot>` offers both candidates, because the
  compiler genuinely cannot tell which one you meant.
- **Nullish interpolations render empty.** `{ maybeNull }` used to render the
  literal text `null` and `{ maybeUndefined }` the text `undefined`. If you
  were relying on that output, interpolate an explicit fallback.
