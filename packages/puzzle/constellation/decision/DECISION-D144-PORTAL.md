---
name: D144 — Portal (scoped v1)
status: verified
connections:
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - DECISION-D86-OUTSIDE-MODIFIER
  - DECISION-D44-DOM-ISLANDS
  - DOC-THIRD-PARTY-DOM
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/portal.js
  - client-runtime/app.js
  - client-runtime/static/index.js
  - client-runtime/ssg/serialize.js
---

# D144 — Portal (scoped v1)

## Context

Overlays must escape ancestor CSS — containing blocks from
`transform`/`filter`/`contain`, `overflow` clipping, stacking contexts — for
full-screen panels, non-modal overlays, and reactive content in foreign
containers ([[DOC-THIRD-PARTY-DOM]]). `<dialog>.showModal()` stays the
recommended tool for focus-trapped modals (native top layer, focus trap,
Escape).

## Decision

`<Portal>…</Portal>` moves its children's DOM to a framework-created outlet at
the app root while the subtree stays in the owner's component tree — same
props, data flow, lifecycle and teardown.

**Grammar.** A reserved capitalized marker, recognized before component
resolution. Positioned compile errors: self-closing `<Portal/>`; any attribute
(`to`/`name` reserved for future named outlets, `ref` rejected); lowercase
`<portal>`; inside a marker fallback body; inside an island (never reconciled,
so the portal would never mount or tear down); as a COMPONENT template root
(the root is where call-site attributes merge and the scope stamp lands — the
error names the fix, `<div style="display: contents">` around the portal). A
portal-only VIEW is legal (`<puzzle-view>` root). Portal-in-portal is allowed.
`PORTAL_TAG` is a reserved binding and loop-variable name.

**Runtime (`client-runtime/views/portal.js`).**
- Gated by the `__PUZZLE_HAS_PORTAL__` usage define (D89): the build-wide walk
  marks any `*parser.Portal` as `HasPortal`, so apps without Portal drop the
  module. Undefined means enabled (unbundled, Vitest). With the define false, a
  Portal vnode leaves an inert comment and warns once in dev; `:outside` falls
  back to physical `el.contains`.
- ONE outlet, `<div data-puzzle-portal>`, appended beside the app mount
  container (host from `PuzzleApp.mount()`/`mountStatic` via
  `setPortalHost`, `<body>` fallback), created on first portal mount, removed
  when the last portal unmounts and on app unmount. An element mid-leave keeps
  it alive until the next release (removal is guarded on emptiness).
- The portal vnode keeps a comment placeholder locally (sibling refs and arity
  unchanged); children mount into a per-portal comment-bracketed range in the
  outlet, and reconciliation threads a `tail` ref to keep appends inside it.
- Teardown is EXPLICIT on every removal shape (patch-replace, keyed removal,
  `clear()`, router teardown, `releaseSubtree`) — teleported children are not
  under `vnode.el`; skipping it leaks instances and document listeners.
- `@event:outside` (D86) uses logical containment (`portalAwareContains`): a
  target in the outlet resolves to its portal's placeholder and re-tests there,
  iterating for nested portals. Zero cost with no live portals.

**Compiler walkers** all recurse into `*parser.Portal` except loop-key roots,
`buildTextRun`, and `condStaticLen` (counts a Portal as one vnode — its
placeholder).

## Alternatives

- Raw DOM targets (`to="body"`) — bypass framework lifecycle and SSG.
- User-placed outlets in v1 — outlet registry, deferred-mount queues and
  teardown-order races with no v1 use case. `<PortalOutlet name>` + `to="…"`
  remains the compatible extension; the reserved-attribute errors hold the
  space.
- No Portal (native top layer only) — answers modals, not reactive content in
  overlay containers.

## Consequences

- Prerender: `PORTAL_TAG` serializes to `''`; portal content appears at
  takeover/`mountStatic`. Don't portal content meant to be crawlable.
- Router overlap transitions: portaled content of an outgoing view unmounts
  instead of fading; morph never scans the outlet.
- Portal state is module-scoped, not per app: multiple `PuzzleApp` instances on
  one page are unsupported (dev warns when `setPortalHost()` would stomp live
  portals). Scoping it to ctx is the upgrade path if needed.
