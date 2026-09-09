---
name: Implicit two-way form binding
status: verified
branch: feat/two-way-binding
connections:
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-SSG
  - FLOW-REACTIVITY
  - DOC-SPEC-TEMPLATE
verified_at: '2026-07-29T05:19:18.215Z'
verified_sha: 770ef49d53752b85892311f5d2a82e2bf19fd39c
notes:
  - kind: verified
    text: >-
      All acceptance lines checked: golden pair + boolean_attr only; runtime
      arms/coercion/identity/IME/validation tests (1561 vitest, zero skips); go test ./...,
      test:types, verify:pack green; scaffolded todos demos handler-less binding out of the box;
      real-browser pass done.
    sha: 770ef49d53752b85892311f5d2a82e2bf19fd39c
release: RELEASE-V0-5-0
change: feature
---

# Implicit two-way form binding

Ship [[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]: `<input value={ newTodoText } />`
two-way binds with zero new syntax — the compiler synthesizes the write-back
handler the author writes by hand today. Product line v1.68, targeting 0.5.0.

## Scope

- In: the compiler-side classifier + synthesis in [[COMPONENT-CODEGEN]]
  (`binding.go`, wired into both attr emitters so inline SVG paths stay
  covered); the reserved attr-namespace compile error in
  [[COMPONENT-TEMPLATE-PARSER]] (non-`@` names containing `:` error unless
  `xml`/`xlink`/`xmlns`); the memoized `__bind` factory + three-arm write
  dispatcher on [[COMPONENT-PUZZLE-VIEW]] with `phase: 'bind'` error reporting;
  the dev-only layer-clobber diagnostic; a `type()` helper in
  `@magic-spells/puzzle/testing`; SSG/static/hybrid listener-stripping and
  post-takeover pins on [[COMPONENT-SSG]]; migration of `examples/todos`, the
  scaffold templates, and `examples/binding` (record-path showcase) while
  `examples/stress` FormState keeps its benchmark semantics via
  non-classifying expressions.
- Out: everything in the decision card's out-of-scope list — radio groups,
  `<select multiple>`, file inputs, contenteditable, component-prop binding,
  deeper paths, debounce modifiers, dirty tracking, and the schema-derived
  forms helper (separate roadmap item; bind is its substrate).

## Acceptance

- Every trigger-condition row and every negative case compiles per the golden
  pair; templates failing a condition emit byte-identically to before (the only
  pre-existing golden allowed to change is `boolean_attr` — its handler-less
  `value={ name }` gains exactly one synthesized bind attr).
- Runtime tests cover all three write arms, coercion edges (`''→null`,
  NaN-skip), stable handler identity across renders, IME guard, validation
  throw → `onError` with `phase: 'bind'` and preserved DOM text, and the
  zero-write echo render.
- Both bind arms that call `refresh()` route a synchronous throw AND an async
  rejection into the D145 funnel with `phase: 'bind'` — tested both ways, since a
  bare call escapes the DOM event path with no report and no boundary.
- The rebuilt-member-root diagnostic warns once per key when `data()` returns a
  fresh object that discards the write, stays silent for a stable target and for
  record replacement, and allocates nothing when `__PUZZLE_DEV__` is false.
- `npx vitest run`, `cd compiler && go test ./...`, `npm run test:types`,
  `npm run verify:pack` all green; real-browser pass covers caret, IME
  composition, number-on-change, select, checkbox, and range.
- The scaffolded todos app demos handler-less binding out of the box.
