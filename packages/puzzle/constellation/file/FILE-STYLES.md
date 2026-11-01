---
name: style pipeline
status: verified
path: compiler/internal/styles/styles.go
language: go
summary: Tailwind resolution/execution and final CSS composition.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# styles.go

The CSS side of a build ([[COMPONENT-ESBUILD-PLUGIN]]): runs the Tailwind CLI one-shot for `puzzle build` (`NpxRunner`, behind a `Runner` interface so tests inject a fake) and composes `dist/styles.css` with `Compose` — Tailwind output first, then the collected `<style>` blocks.

**Gotcha:** when the user's CSS pins no sources, Tailwind v4 scans the whole app root (the child's working directory) and honors only `.gitignore`. The compiler's one lever is what is gitignored, which is why every transient build directory lives under the self-ignoring `<root>/.puzzle/`: a leftover staging directory beside `dist/` gets scanned and can slow the scan by orders of magnitude.
