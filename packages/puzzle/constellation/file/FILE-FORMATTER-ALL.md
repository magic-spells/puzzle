---
name: full function manifest fallback
status: verified
path: client-runtime/formatters/builtins-all.js
language: javascript
summary: >-
  The ./formatters/manifest export: every built-in function, the seed map for non-compiler
  consumers; a Puzzle build swaps in a tree-shaken subset.
connections:
  - COMPONENT-FORMATTERS
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# builtins-all.js

Served as `@magic-spells/puzzle/formatters/manifest` ([[COMPONENT-FORMATTERS]]).
`formatters.js` imports it by that package specifier (never a relative path) as
the seed map of every built-in function, which is what consumers outside the
compiler get (tests, plain Node). A compiled app never reaches this file: the
esbuild plugin resolves the specifier to a virtual module that imports only the
functions the templates use, straight from `builtins.js`. Keep it a thin
re-export of `builtins.js` so the two cannot drift.
