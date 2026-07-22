---
name: "D27b — examples/blog replaces example-app as a second v1 reference app"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DOC-BLOG-EXAMPLE
  - DOC-USER-GUIDE
  - DECISION-D21-ADAPTER-READ-PATH
---

# D27b — examples/blog replaces example-app as a second v1 reference app

Settled (v1). The decision log numbered two entries "D27"; this is the second, treated as D27B. The deprecated, never-compiling `example-app/` is deleted and replaced by `examples/blog/` ("Puzzle Press"), a runnable app whose sole job is to exercise the v1 surface `examples/todos/` leaves uncovered.

## Context
`example-app/` was a pre-SPEC brainstorm that never compiled (invalid class bodies, ~10 imports of files that never existed, superseded APIs) and had been stamped `DEPRECATED.md`. It is **deleted** and replaced by `examples/blog/` ("Puzzle Press"), a runnable app whose sole job is to exercise the v1 surface `examples/todos/` leaves uncovered: route `:params` + the `'*'` catch-all, multiple models, reusable components with props / a default `<Slot/>` / callback props, `findMany({ filter })`, the [[DECISION-D21-ADAPTER-READ-PATH]] read path via post-mount `store.loadAll` seeding from static JSON, and a custom formatter.

## Decision
Scope decisions:

- **v1-only showcase.** Nothing in `examples/blog/` uses a deferred feature — no `{:else if}`/`{#unless}`/`{#switch}`, named slots, `$emit`, skeletons, scoped styles, validation enforcement, relationships, or adapter write-sync. Conditionals nest; the comment mutation is a parent-owned callback prop.
- **Plain `<styles>` blocks, not Tailwind. — Superseded 2026-07-09; blog now uses Tailwind v4.** Originally blog shipped no `puzzle.config.js`, so the Tailwind runner was never invoked and the smoke build stayed Go + esbuild only (hermetic in CI, no node style pipeline), which also exercised the `<styles>`-collection path that `examples/todos/` (Tailwind-first) does not. This was reversed for cross-example consistency: `examples/blog/` was converted to Tailwind v4 (`puzzle.config.js` + `app/styles/styles.css` with an `@theme` palette; all `.pzl` styled via utilities, zero `<styles>`). Trade-off accepted: the pretest smoke build now runs the Tailwind CLI, so it is no longer node-free — CI installs `@tailwindcss/cli` via `npm ci`, and the `<styles>`-collection path is still covered by unit tests + any component that emits `<styles>`. See [[DOC-BLOG-EXAMPLE]].
- **Post-mount `loadAll` seeding, not `createRecord`.** Seed data lives as static JSON under `app/public/api/` (copied verbatim into `dist/api/`), fetched once after `app.mount()`. `loadAll` upserts and notifies subscribers on every call, so it must never run inside `data()` (a subscribed view would refetch forever); `loadOne` is skipped because the dev server's history fallback returns `index.html` with a 200 for an `/api/…/id` miss, which throws when parsed as JSON.
- **Guarded by the pretest chain.** Root `package.json` gains `build:blog` (`puzzle build examples/blog --mode development`), and `pretest` runs it alongside the fixture build, so a change that breaks `examples/blog`'s compile breaks `npm test`.

## Alternatives rejected
- **Keeping/repairing `example-app/`** — it was a pre-SPEC brainstorm that never compiled (invalid class bodies, ~10 imports of nonexistent files, superseded APIs); deleted rather than salvaged.
- **`createRecord` seeding** — rejected in favor of post-mount `loadAll` upsert seeding from static JSON (exercises the D21 read path); `loadOne` seeding skipped because the dev history fallback returns `index.html` (200) for an `/api/…/id` miss, which throws when parsed as JSON.
- **Plain `<styles>` blocks / no `puzzle.config.js`** (the original hermetic-CI choice) — superseded 2026-07-09 for cross-example consistency; blog converted to Tailwind v4 utilities.

## Consequences
Brainstorm-only features from the deleted `example-app/` — deferred syntax and superseded APIs alike — are preserved as an ideas ledger in notes/post-v1-showcase-roadmap.md, which maps each to the concrete `examples/blog/` surface that should demonstrate it once it lands. The USER_GUIDE worked example ([[DOC-USER-GUIDE]]) was written to mirror `examples/blog/`; since the 2026-07-09 Tailwind conversion it intentionally diverges on styling — the guide keeps teaching `<styles>` blocks as a standalone feature while the shipped blog uses Tailwind utilities.
