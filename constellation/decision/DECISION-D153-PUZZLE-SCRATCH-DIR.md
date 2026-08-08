---
name: 'D153 — All transient build directories live in a self-ignoring .puzzle/'
status: built
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - FILE-BUILD
  - FLOW-BUILD
  - DECISION-D98-FIXTURES-MODULE-FLAG
---

# D153 — All transient build directories live in a self-ignoring .puzzle/

## Context

A build needs two directories that exist only while it runs: the staging tree it
assembles before installing it as `dist/`, and the holding directory
`swapOutput` renames the previous output into. Both were siblings of `dist/` in
the app root, named `.dist-staging-*` and `dist.old-*`, and both are removed on
the happy path — but a killed build (^C, OOM, CI timeout) leaves one behind, and
nothing ever swept them.

That is not merely untidy. Verified against `@tailwindcss/cli` 4.3.3: with no
`source(…)` on the tailwindcss import and no `@source` directives, the CLI
registers one source root of `**/*` based at `--cwd`, which is the app root for
both of the compiler's runners, and the walk honors `.gitignore`. Measured in a
project whose `.gitignore` says `dist`: a class used only in `.dist-staging-*`
or `dist.old-*` still reaches the output, because neither name matches that
rule. Ten leftovers on the reference site took Tailwind's source scan from 112ms
to 14s. `dist.old-*` additionally slipped past the usage scan's dot-directory
prune, so every leftover was re-parsed on every build. Tailwind offers no
CLI-level exclusion — negative sources exist only as `@source not` inside the
user's CSS.

## Decision

Every transient build directory lives under `<root>/.puzzle/tmp/` as
`staging-*` and `dist-old-*`, and `<root>/.puzzle` carries a `.gitignore`
holding `*`, created when absent and never overwritten. One directory for a user
to know about, ignoring itself, structurally invisible to any tool that respects
gitignore. `.puzzle` was already the compiler's scratch root (the D98
`--fixtures` wrapper) and already sits outside every directory `puzzle dev`
watches, so nothing new is exposed to the watcher.

It stays under the app ROOT: `dist/` is `<root>/dist`, so staging is on the same
filesystem and installing it remains a plain atomic rename, never a cross-device
copy. The `refusing to replace unexpected dist path` guard only ever inspects
the destination, so it is unaffected.

`SweepWorkDirs` runs at the top of `build.Build` and at `puzzle dev` startup
(the SPA dev path never calls `Build`, and a dev session is where a build is
most likely to be killed mid-flight). It is deliberately narrow, because it
deletes trees: two known locations only, exact name prefixes only, real
directories only — a symlink is skipped outright, so it can never follow a link
out of the app root — and only entries untouched for ten minutes, so a
concurrently running build's staging tree survives. It also sweeps the legacy
app-root names, so existing projects heal themselves on their next build.

`dist/` itself is left alone. Where it is gitignored (every Puzzle template
ships that) it is already excluded; where it is not, excluding it from Go would
change which sources Tailwind scans without the user asking.

## Alternatives rejected

- **A pid or lock file instead of an age threshold.** Pids are reused, and a
  killed build cannot clean up its own marker any more than it can clean up its
  staging dir. The mtime threshold has a bounded worst case: a pathologically
  long build loses its staging dir and fails, leaving `dist/` exactly as it was.
- **Delete leftovers unconditionally at startup.** Would destroy a concurrently
  running build's staging tree — two `puzzle` processes in one repo is normal
  (dev server plus a manual build).
- **Keep the names, add `.dist-staging-*` / `dist.old-*` to the user's
  `.gitignore`.** The compiler does not get to edit files it did not author, and
  it would not fix a project that has no `.gitignore`.
- **Write a `.gitignore` into `dist/`.** Changes the shipped output bytes and
  puts a compiler artifact in the deployed tree.
- **Use the OS temp dir.** Loses the same-filesystem guarantee that makes the
  final install atomic.
- **`@source not "…"` injected into the user's CSS.** The input stylesheet is
  the user's file, and the base directory for `@import` resolution is derived
  from it — a generated wrapper would change how their own imports resolve.

## Consequences

A project gains one directory, `.puzzle/`, which ignores itself; a user who
wants it in their own ignore file has a single entry to add. Interrupted builds
self-clean on the next run instead of accumulating unignorable copies of
`dist/`. `cleanupFixturesWorkDir` changes accordingly: it always removes the
generated `.puzzle/fixtures/` wrapper, and removes `.puzzle` itself only when
that build created it and it is now empty — gating the wrapper removal on "did
this build create `.puzzle`" stopped working once every build creates it.
