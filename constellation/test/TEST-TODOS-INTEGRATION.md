---
name: Todos end-to-end integration test
status: verified
verified_at: '2026-07-22T00:04:06.910Z'
framework: vitest
connections:
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-VIEW
  - FILE-TESTS-TODOS-APP-TEST
  - FILE-TESTS-TODOS-APP-COMPILED-TEST
  - FILE-TESTS-HELPERS-TODOS-SUITE
  - FILE-TESTS-FIXTURES-TODOS-HOME-COMPILED
  - FILE-TESTS-FIXTURES-TODOS-DEFAULT-COMPILED
  - FILE-TESTS-FIXTURES-TODOS-TODO-MODEL
  - FILE-EXAMPLES-TODOS-APP-VIEWS-HOME
notes:
  - kind: verified
    text: >-
      Verified at b9131f2: 12 jsdom tests green driving a real PuzzleApp DOM-only —
      add/special-chars/toggle/filter (keyed
      identity)/delete/clear-completed/empty-state/persistence round-trip/loadAll upsert/13-op
      endurance. Fixture = compiler golden file #1.
  - kind: verified
    text: >-
      Re-verified at 440f883: suite body extracted to tests/helpers/todos-suite.js (runTodosSuite)
      and now runs TWICE — fixture variant (todos-app.test.js) and compiled variant
      (todos-app-compiled.test.js, modules fresh-compiled from the real .pzl sources by pzlc on
      every npm test). Zero behavioral differences; 144/144. The v1 loop is closed: compiler output
      passes the exact suite the runtime was proven against.
  - kind: verified
    text: >-
      TodoItem extraction (v1.1 Step 3): rows are real components (todo prop + @toggle/@remove
      callback props, compiler auto-keys {#for} body roots — NO explicit key or it doubles);
      animations in: height 0→65px+fade+scale ease-out 220ms, out reversed 180ms; overflow-hidden
      root + fixed-height h-[65px] inner (collapse pattern — WAAPI can't animate to auto). Suite
      installs fake WAAPI, settle() auto-finishes; 4 new animation assertions × both lanes (enter
      keyframes, deferred removal, no spurious animations on filter, fill release). Compiled lane
      resolves verbatim .pzl imports via a vitest resolveId plugin (basename-flatten in
      todos-compiled/). Live-proven in Chromium: mid-enter 33.9px/opacity .55/1 live animation;
      settle 65.0px/0 animations (released); leave deferred removal. 183/183.
  - kind: verified
    text: >-
      Re-verified at the v1.16–v1.21 merge (fresh baseline — old one unreachable after squash). Both
      lanes green in the 480-test run at this sha; compiled fixtures rebuilt by the pretest Go build
      (which now carries the v1.12 formatter-guard emission and v1.20/v1.21 codegen — byte-identical
      for the todos fixtures, which use neither min-duration nor named slots). Todos app semantics
      untouched by v1.16–v1.21 (its schema rules were already satisfied by the app's writes).
---

# Todos integration test

The canonical end-to-end runtime proof uses a real [[COMPONENT-PUZZLE-APP]] in
jsdom and drives only public behavior.

The shared suite covers add, special-character text, toggle, filter, keyed DOM
identity, delete, clear-completed, empty state, persistence into a second app
instance, adapter `loadAll` upsert without duplicates, and repeated
add/toggle/delete cycles.

It runs in two lanes:

- handwritten fixture modules under `tests/fixtures/todos/`;
- modules freshly compiled from `examples/todos/app/` by the real Go compiler.

Both lanes execute the same helper assertions. This keeps runtime behavior and
compiler calling conventions aligned.

The fixture render code is also a readable reference for interpolation,
conditional attributes, keyed loops, event forms, composition, and prototype
render attachment. Codegen's own golden files remain the byte-level emission
contract.
