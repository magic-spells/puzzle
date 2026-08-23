---
name: D154 — warm static dev rebuilds
status: verified
connections:
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D27-FAST-DEV-REBUILDS
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - COMPONENT-DEV-SERVER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-BUILD-WATCH
verified_at: '2026-08-16T04:34:43.370Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

# D154 — warm static dev rebuilds

`puzzle dev` on an `output: 'static'` project rebuilds through a persistent
`build.StaticWatchBuilder` — three long-lived esbuild `api.Context`s, a
session-long compile memo and usage scanner, and the same warm `tailwindcss
--watch` child the SPA loop has used since D27 — instead of calling the one-shot
`build.Build` per save. The output is byte-for-byte what `puzzle build --static`
produces, and every failure still leaves the last good site serving.

## Context

D148 gave static projects the real pipeline in dev, which was the correct
correctness call and an expensive one: each save re-ran a complete cold build —
config-free but otherwise entire — including a fresh Tailwind CLI invocation,
three cold esbuild passes over the whole project, and a full usage walk that
parses every `.pzl`. On the reference site (262 files, 148 routes) a leaf edit
cost ~2.3s save-to-served, against ~250ms for the same site's SPA-mode loop.

D27 already solved this shape for SPA dev (a persistent `api.Context` plus a
warm Tailwind child). Static mode could not simply reuse `WatchBuilder`, for two
reasons that pull against each other:

- a static build is THREE esbuild passes, and the third one's ENTRY SET is not
  known until the node prerender has run and reported which routes it wrote;
- the output cannot be patched in place. Pages, page bundles, and `styles.css`
  must appear together or not at all, so every rebuild has to assemble a fresh
  staging tree and swap it — while an `api.Context` freezes its `Outdir` at
  construction and therefore cannot write into a directory that does not exist
  yet.

## Decision

**A warm output root that mirrors a staging tree.** The contexts write into
`<root>/.puzzle/tmp/dev-static/`, laid out exactly like a staging tree
(`_puzzle/`, `.puzzle-prerender/entries/`) and — the load-bearing part — at the
SAME depth as a `staging-*` sibling. esbuild bakes output-relative paths into
every `.js.map`, so any other depth would make dev sourcemaps differ from a
one-shot build's. The name deliberately does not match a `SweepWorkDirs` prefix:
an idle session must not have its warm tree deleted out from under its contexts.

**The page pass runs `Write: false` and its `OutputFiles` are written into
staging.** That is what prunes: a deleted route's bundle and a superseded
content-hashed chunk simply never appear, because staging only ever holds what
this rebuild produced. The app pass runs `Write: false` too — static output
ships no `app.js` (the one-shot build deletes `staging/app.js` before the swap),
so that pass exists only to compile every view once, fill the `<style>`
collector, and surface compile errors.

**Contexts are replaced, never mutated, and only on the two facts frozen into
them.** A usage scan that flips a `Features` bit invalidates all three Defines;
a change to the route set (a page added, removed, or renamed) invalidates the
page context's entry list. Everything else — a new import, a deleted `.pzl`, an
edited `routes.js` — is esbuild's own input-graph invalidation, exactly as on
the SPA path. When in doubt the builder tears down: a cold context rebuild is
still far cheaper than a cold `build.Build`.

**The memos live for the session.** One `CompileCache` (D152) and one
`UsageScanner` are held across rebuilds. The compile memo is keyed by content
hash, so a changed file misses on its own; the eviction that matters is the SVG
memo inside it, which is keyed by PATH — an edited icon whose consuming `.pzl`
is byte-identical would otherwise be served from the pre-edit scan with nothing
able to notice.

**A styles-only change writes exactly one file.** `styles.css` belongs to the
prerendered tree but appears in no page's HTML, so the Tailwind output poll
drives a debounced `RecomposeStyles`: compose the Tailwind layer with the
collected `<style>` blocks and atomically swap `dist/styles.css` alone into the
served tree — zero routes rendered, a reload only when the bytes changed. It
dedupes against the file on disk rather than a remembered hash (every staging
swap replaces that file behind its back) and is a no-op before the first
`dist/` exists. Route-shaped work still goes through the full staging swap.
The initial build waits (bounded) for the warm child's first non-empty output,
so the first served build is styled and no catch-up rebuild follows.

**The node prerender stays a fresh subprocess per rebuild.** It is now the
single largest phase (~100ms of a ~250ms rebuild on a 148-route site), and a
persistent render worker is the obvious next lever — but it means owning module
invalidation inside a long-lived node process and reasoning about app-level
global state surviving between renders. Deliberately out of scope here.

## Consequences

- Measured: `examples/static-docs` 288ms → ~120ms per leaf save; a generated
  148-route / 249-`.pzl` site 311ms → 254ms (no Tailwind there, which is most of
  the difference between the two figures).
- A dev session killed mid-swap can leave one `dist-old-*` in `.puzzle/tmp`
  (the deletion of the superseded tree is backgrounded so a save does not wait
  on it). `SweepWorkDirs` reaps it.
- The per-page pass now anchors `AbsWorkingDir` to its output tree. Unminified
  output carries a `// <input path>` comment per module resolved against the
  process cwd, so the staging dir's random suffix used to leak into
  `_puzzle/*.js`: two dev builds of identical sources produced different bytes,
  as did the same build run from a different directory. Production output is
  unaffected — minification strips the comments.
- Builder construction failing degrades to the one-shot path, which produces
  identical output and runs its own Tailwind.

## Alternatives rejected

**Rebuild the contexts every save.** The straightforward way to reconcile a
frozen `Outdir` with a fresh staging tree, and it discards the entire esbuild
cache — the thing being bought.

**Hardlink or copy a warm `dist/` into place.** Cheaper than composing staging,
but esbuild rewrites output files in place, so a hardlinked `dist/` would be
mutated mid-serve; and a copy of the whole tree costs more than it saves once
public assets are large.

**Patch `dist/` incrementally instead of swapping.** Breaks the D148 guarantee
outright: a failed prerender would leave a half-updated site serving. The
one-file stylesheet recompose is the deliberate exception — a single atomic
write cannot leave pages and bundles out of step.

**Persistent node render workers.** The biggest remaining win, and a much larger
change than the rest of this decision combined. Left for a later phase rather
than bundled in where it would dominate the risk.

**A stable staging directory shared with the one-shot build.** Would make the
sourcemap-depth constraint unnecessary, but two concurrent builds in one repo
(a dev session and a `puzzle build`) would then fight over the same tree.
