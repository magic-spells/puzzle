---
name: D144 — Portal (scoped v1)
status: built
connections:
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - DECISION-D86-OUTSIDE-MODIFIER
  - DECISION-D44-DOM-ISLANDS
  - DOC-THIRD-PARTY-DOM
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-COMPILER-PARSER
  - COMPONENT-COMPILER-CODEGEN
---

# D144 — Portal (scoped v1)

`<Portal>…</Portal>` (v1.66) teleports its children's DOM to a framework-created
outlet at the app root while the subtree stays in the owner's component tree —
same props, data flow, lifecycle, and teardown. The use case is overlays that
must escape ancestor CSS (containing blocks from `transform`/`filter`/`contain`,
`overflow` clipping, stacking contexts): modal panels, full-screen views, and
the [[DOC-THIRD-PARTY-DOM]] reactive-foreign-container gap.

## Grammar

A reserved capitalized marker in the D134 family, recognized before component
resolution. Paired-only — a self-closing `<Portal/>` is a positioned compile
error (a portal exists to carry children). Attribute-free: `to`/`name` are
positioned compile errors reserved for future named outlets; lowercase
`<portal>` gets the D134 steering error. Rejected inside a marker fallback body
(D141 rule) and inside an island (an unreconciled subtree would never mount or
tear down the portal). Portal-in-portal is allowed. `PORTAL_TAG` is a reserved
binding and loop-variable name like `SLOT_TAG`.

## Runtime contract

- ONE outlet (`<div data-puzzle-portal>`) appended beside the app mount
  container (host set by `PuzzleApp.mount()` / `mountStatic`; `<body>`
  fallback), created lazily on the first portal mount, removed when the last
  portal unmounts and on app unmount. No user-placed outlets, so no outlet
  registry lifecycle and no teardown-ordering races.
- The portal vnode keeps a comment placeholder at its local position (sibling
  insertion refs and conditional arity untouched); children mount into a
  per-portal comment-bracketed range in the outlet, so multiple live portals
  never contend over one childNodes list. Reconciliation threads a `tail`
  insertion ref so appended children stay inside their range.
- Teardown is EXPLICIT on every removal shape (patch-replace, keyed removal,
  `clear()`, router teardown, `releaseSubtree` descent) — the teleported
  children are not under `vnode.el`, so nothing cascades to them; skipping this
  leaks component instances and document-level `outside` listeners.
- `@event:outside` (D86) uses LOGICAL containment: a target physically inside
  the outlet resolves to its owning portal's local placeholder and containment
  re-tests there (iterating for nested portals), so content portaled by a
  descendant of the bound element counts as inside. Zero cost with no live
  portals.
- An element mid-leave-animation keeps the outlet alive until the next release
  or app unmount (outlet removal is guarded on emptiness, not just count).

## Prerender and transitions

- SSG/static: `PORTAL_TAG` serializes to `''` — portals emit nothing in
  prerendered HTML; content appears at takeover/`mountStatic`. Fine for
  overlays; wrong for content meant to be crawlable — don't portal that.
- Router overlap transitions: portaled content of an outgoing view is not under
  the pinned root, so it unmounts rather than fades. Morph never scans the
  outlet. Both are documented behavior, not defects.

## Scope notes

`<dialog>.showModal()` remains the recommended tool for focus-trapped modals —
the native top layer gives focus trap and Escape handling for free; Portal
covers non-modal overlays, full-screen panels, and reactive content in foreign
containers. User-placed named outlets (`<PortalOutlet name>` + `to="…"`) are
the compatible future extension; the reserved attribute errors hold the space.

## Alternatives rejected

- **Raw DOM targets** (`to="body"`): bypasses framework lifecycle and SSG; the
  framework-owned outlet keeps every portal inside the managed tree.
- **User-placed outlets in v1**: outlet registry, deferred-mount queues, and
  teardown-ordering races for no v1 use case.
- **Keeping the full deferral**: the native top layer answers modals but not
  reactive content in foreign/overlay containers, and deep `position: fixed`
  overlays stay hostage to the §26 containing-block contract in practice.
