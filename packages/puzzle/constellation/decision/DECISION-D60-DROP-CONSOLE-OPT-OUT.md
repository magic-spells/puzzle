---
name: 'D60 — build.dropConsole: production console stripping is opt-out'
status: verified
verified_at: '2026-11-26T23:52:46.217Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D26-TAILWIND-PIPELINE
code_refs:
  - compiler/internal/config/config.go
  - compiler/internal/build/build.go
  - compiler/internal/build/prerender_pages.go
verified_sha: 54ef73f8f23d7eed3a5998b1e571212b4e24200d
---

# D60 — `build.dropConsole`: production console stripping is opt-out

Production builds strip `console.*` calls (esbuild `Drop: api.DropConsole`) from the app bundle and from static-mode page modules. `build: { dropConsole: false }` in `puzzle.config.js` keeps them.

## Decision

- Key absent or no config → production strips. `false` → user console calls survive. Dev builds never strip.
- A non-boolean value is rejected at config load, naming `build.dropConsole`.
- The framework's own warnings are dev-only (`__PUZZLE_DEV__`), but the `console.error` a contained framework error falls back to without an `onError` hook (D145) is stripped too: in production such an error logs nothing unless `onError` reports it another way, and a console-based `onError` is stripped as well.

## Alternatives rejected

- Keeping console by default — gives up a real size win on every app.
- A `puzzle build --keep-console` flag — this is app configuration; a flag drifts from CI scripts.

## Gotchas

- esbuild removes the **whole** call expression, so `console.log(sideEffect())` loses the side effect too.
