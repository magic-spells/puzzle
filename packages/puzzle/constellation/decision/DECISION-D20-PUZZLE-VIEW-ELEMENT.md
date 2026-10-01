---
name: "D20 — `<puzzle-view>` element for views/layouts only; reusable components render inline"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-PUZZLE-FILE
code_refs:
  - client-runtime/views/viewManager.js
  - client-runtime/ssg/serialize.js
---

# D20 — `<puzzle-view>` element for views/layouts only; components render inline

## Decision
- Every `.pzl` template is delimited by `<puzzle-view>`. The emission mode comes from the directory: `app/views/**` and `app/layouts/**` compile as **views** (`codegen.ModeForPath`), everything else as a **component**.
- A view or layout renders a real `<puzzle-view>` DOM element carrying the tag's attributes — the boundary navigation swaps, `this.element` anchors, and route animations target.
- A component renders **inline**, with no wrapper: `<CustomButton/>` renders as its `<button>`. Attributes on a component's `<puzzle-view>` are a compile error ("components render inline — put attributes on your root element"), and a component template needs exactly one root element.
- The framework ships no base stylesheet, so `<puzzle-view>` (an unregistered custom element) is `display: inline` until the app styles it; the examples set it in their own CSS.

## Alternatives rejected
- A forced wrapper element per component — the wrapper becomes the flex/grid child instead of the content, and nested components stack wrapper layers in every list row.
