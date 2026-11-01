---
name: ViewManager DOM patching, events, and bindings
kind: unit
status: verified
framework: vitest
connections:
  - COMPONENT-VIEW-MANAGER
  - FILE-VIEW-MANAGER
  - FILE-VIEW-NODE
  - FILE-LIST-BLOCK
  - DECISION-D17-RENDER-FUNCTIONS-VDOM
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D38-EVENT-MODIFIERS
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D46-INLINE-SVG
  - DECISION-D58-LIST-KEYING
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D86-OUTSIDE-MODIFIER
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D143-MOUNT-THROW-OWNERSHIP
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - FEATURE-VIRTUAL-SCROLLING
  - DOC-EVENTS
  - DOC-THIRD-PARTY-DOM
  - DOC-TESTING
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# ViewManager DOM patching, events, and bindings

The node-level contract of [[COMPONENT-VIEW-MANAGER]]: what the patcher does to real DOM,
and what it promises not to touch. Run with
`npx vitest run tests/vdom tests/patch- tests/keyed tests/list- tests/static-cache tests/event- tests/binding tests/mount- tests/first-mount-throw tests/raw-html tests/url-safety tests/component-slot`.

- **Patching** (`vdom*`, `patch-*`, `svg-text-element`, `inline-svg`): attributes,
  properties and children; form values set as properties; controlled `select` values;
  conditional-arity placeholder padding so trailing siblings keep their slots; the
  `patch()` identity short-circuit; an authored SVG `<text>` element is not mistaken for
  the text-node marker; inline SVG arriving as string children.
- **Keyed lists** (`keyed-reconciliation`, `keyed-move-el`, `list-*`, `static-cache*`,
  D58/D170): reconciliation on `(tag, key)` pairs, auto-keys including custom primary
  keys, the null-key warning, persistent row blocks, static-subtree caching, and control
  values replayed into cached rows (including a component's slot content).
- **Component prop bailout** (`component-prop-bailout`): the shallow-equality boundary
  that decides whether a child re-renders at all.
- **`<Component>` ranges** (`component-slot`, D180): stable comment-bracketed positions
  for empty and selected output, keyed moves of whole ranges, conditional replacements
  in the right order, current props/events, cleanup on a constructor change, and a
  compiled-out diagnostic naming `<Component>` and its build gate.
- **Raw markup** (`raw-html`): live-HTML ranges from `raw` and `newline_to_br` move with
  their keyed rows without disturbing unrelated siblings.
- **Islands** (`dom-islands`): children frozen after mount while the element's own attrs
  and listeners keep patching.
- **Events** (`event-modifiers`, `event-options`, `event-key-filters-parity`,
  `outside-modifier`): per-node listeners, `@event` modifiers, `passive`/`capture`
  (D187), key filters, the portal-aware `outside` modifier.
  `event-key-filters-parity` pins the runtime key-filter table to the compiler's, so
  adding a filter on one side alone fails.
- **URL safety** (`url-safety`, D186): dynamic URL bindings drop script schemes.
- **Two-way binding** (`binding`, `bind-plain-object-containment`, D147): local state,
  record, plain object and primitive bind roots, the coercion matrix, handler
  memoization.
- **Mount-failure ownership** (`mount-*`, `first-mount-throw`,
  `failed-child-under-cached-vnode`): a throwing enter hook leaves the mounted tree
  alone; first-mount recovery survives a same-turn parent re-render, a superseding
  refresh and a router-preloaded replacement; a failed child under a reused element vnode
  is still reached by errorView retry or the next parent patch.
- **Acceptance** (`virtual-scroll-example`): the DOM window stays bounded while the
  backing list does not ([[FEATURE-VIRTUAL-SCROLLING]]).

Gotcha: `binding`, `raw-html`, `url-safety`, `component-slot` and
`virtual-scroll-example` read compiled fixtures that `npm run pretest` generates
(`npm test` runs it; `tests/fixtures/virtual-scroll/` is gitignored); a bare
`npx vitest run` on a fresh clone fails those lanes until pretest has run once.
