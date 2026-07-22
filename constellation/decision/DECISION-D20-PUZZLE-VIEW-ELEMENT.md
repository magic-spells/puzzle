---
name: "D20 — `<puzzle-view>` element for views/layouts only; reusable components render inline"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-PUZZLE-FILE
---

# D20 — `<puzzle-view>` element for views/layouts only; reusable components render inline

Settled. Router-mounted views and layouts compile to a real `<puzzle-view>` DOM element; reusable components render **inline** with no wrapper element.

## Context
The framework needed to decide whether every `.pzl` component emits a wrapper element or renders its content inline.

## Decision
- Router-mounted **views and layouts** compile to a **real `<puzzle-view>` DOM element** (with the tag's attributes) — the view boundary that navigation swaps, `this.element` anchors, and post-v1 animations target.
- **Reusable components render inline**: the compiler emits the template's contents with no wrapper element, so `<CustomButton/>` renders as its `<button>`.

## Alternatives rejected
- **A forced wrapper element per component** — breaks real layouts (the wrapper becomes the flex/grid child instead of the content) and stacks absurdly: a view wrapping `<TodoItem>` wrapping `<Checkbox>` + `<DeleteButton>` would emit four wrapper layers per list row. Inline rendering matches Vue/Svelte behavior.

## Consequences
Mechanics: one file anatomy for all `.pzl` files (`<puzzle-view>` stays as the template delimiter); emission mode is decided by directory convention (`app/views/**`, `app/layouts/**` → element; everything else → inline). For components, attributes on `<puzzle-view>` are a compile error ("components render inline — put attributes on your root element") and the template requires a single root element in v1 (fragments deferred). The base stylesheet ships `puzzle-view { display: block }` (unknown elements default to inline).
