---
name: runtime package entry
status: verified
path: client-runtime/index.js
language: javascript
summary: >-
  Package root: the public exports plus the compiler-support exports compiled .pzl modules import on
  demand.
connections:
  - COMPONENT-PUZZLE-APP
verified_at: '2026-11-24T18:13:45.766Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# index.js

The package root. It exports the public surface (`PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`, `PuzzleValidationError`, `FormatterRegistry`, `lazy`) plus the compiler-support exports that compiled `.pzl` modules import: `ViewNode` and the reserved tags, `displayValue`, `urlValue`, `listRows`/`loopItems`/`loopRange`, and `dynamicComponent` ([[COMPONENT-PUZZLE-APP]]).

Codegen imports each support export only when the module emits it (`listRows as __l`, `dynamicComponent as __dc`, …), so a loop-free app never pulls in `listBlock.js` and an app without `<Component>` never pulls in `componentSlot.js`. The support exports are not user API.
