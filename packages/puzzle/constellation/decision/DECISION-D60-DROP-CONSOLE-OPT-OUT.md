---
name: 'D60 — build.dropConsole: production console-strip becomes opt-out'
status: verified
verified_at: '2026-08-24T18:51:09.019Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D26-TAILWIND-PIPELINE
code_refs:
  - compiler/internal/config/config.go
  - compiler/internal/build/build.go
  - compiler/internal/build/prerender_pages.go
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# D60 — `build.dropConsole`: production console stripping is opt-out

## Decision
Production builds set esbuild `Drop: api.DropConsole` by default. esbuild removes the **entire** call expression, so `console.log(sideEffect())` loses its side effect too, and it applies to user code. `puzzle.config.js` offers the way out:

```js
export default { build: { dropConsole: false } }
```

- Key absent or no config → production strips `console.*`.
- `dropConsole: false` → user console calls survive production builds.
- Dev builds never drop console.
- A non-boolean value is rejected at config load, naming `build.dropConsole`. Unknown keys inside `build` are ignored.
- The config is loaded once per `Build()` ([[DECISION-D26-TAILWIND-PIPELINE]]), so a malformed config surfaces before the stale-`dist` prune.

The framework's own warnings are dev-only by design (`__PUZZLE_DEV__`), so stripping only ever affects app code. `build` is the home for future build toggles.

## Alternatives rejected
- Keeping console by default — silently changes every app's production output and gives up the size win (~570 B gzip on examples/todos).
- A `puzzle build --keep-console` flag — this is app configuration, and a flag drifts from CI scripts.
- Removing stripping entirely — the default is a real size win; an escape hatch answers the side-effect concern.
