---
name: PuzzleApp runtime
status: verified
path: client-runtime/app.js
language: javascript
summary: Application service wiring, lifecycle, mount, unmount, HMR, and morph forwarding.
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-DEVSTATE
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# app.js

`PuzzleApp` ([[COMPONENT-PUZZLE-APP]]). The constructor only checks and stores
config; `mount()` builds the store, function registry and router, injects `ctx`
into every view, and runs navigation zero. Also the HMR snapshot/restore entry
points and the morph handler slot (`setMorphHandler`, callable before or after
mount).

- **Every app pulls this in**, so every import it adds is paid by hello-world.
  Optional runtime stays behind its gate: devtools/devstate behind
  `__PUZZLE_DEV__`, Portal behind `__PUZZLE_HAS_PORTAL__`, the adapter only as a
  capability value passed in config (`isAdapterCapability`), morph only through
  `setMorphHandler`.
- The config surface is deliberately small: app-level
  settings/computed/events/methods are not part of it (SPEC §34).
