---
name: style pipeline
status: verified
path: compiler/internal/styles/styles.go
language: go
summary: Tailwind resolution/execution and final CSS composition.
connections:
  - COMPONENT-ESBUILD-PLUGIN
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: decision
    text: >-
      Minify (esbuild api.Transform, CSS loader, whitespace + syntax, no engine targets) minifies
      the collected <style> blocks in production before Compose; build.go calls it, dev skips it.
      Rejected: running the composed sheet through the Tailwind CLI (would feed user <style> blocks
      to Tailwind, enabling @apply there, and serialize the concurrent Tailwind and bundle lanes)
      and a plain lightningcss minify (with no targets it drops -webkit-backdrop-filter, breaking
      blur on Safari 17 and earlier). Measured on magicspells.io's 639 KB dev sheet: 448 KB out, all
      103 -webkit- declarations kept. Pinned by TestMinifyKeepsVendorPrefixes.
---

# styles.go

The CSS side of a build ([[COMPONENT-ESBUILD-PLUGIN]]): runs the Tailwind CLI one-shot for `puzzle build` (`NpxRunner`, behind a `Runner` interface so tests inject a fake) and composes `dist/styles.css` with `Compose` — Tailwind output first, then the collected `<style>` blocks.

**Gotcha:** when the user's CSS pins no sources, Tailwind v4 scans the whole app root (the child's working directory) and honors only `.gitignore`. The compiler's one lever is what is gitignored, which is why every transient build directory lives under the self-ignoring `<root>/.puzzle/`: a leftover staging directory beside `dist/` gets scanned and can slow the scan by orders of magnitude.
