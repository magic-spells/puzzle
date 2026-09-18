---
name: D171 — `puzzle add theme <name…>` (palettes are registry content, copied like a piece)
status: built
connections:
  - DECISION-D169-REGISTRY-VERSION-FLOORS
  - DECISION-D32-CLI-TOOLING
  - DECISION-D03-SCRIPTS-REAL-JS
  - COMPONENT-COMPILER-CLI
notes:
  - kind: decision
    text: >-
      2026-09-18, review round on PR #138 — two amendments. (1) `planTheme`'s state (c)
      (app/styles/pieces.css present but unwired) reported "up to date" without ever hashing the
      file, so a locally edited pieces.css read as current and `--overwrite` was a no-op on it,
      while the help text promised the opposite. `add theme default` now applies the SAME
      already-installed rules every other palette gets to app/styles/pieces.css — identical bytes or
      a copy matching the lock hash is up to date, anything else is refused unless `--overwrite`,
      which replaces and re-locks it. `add piece` itself is untouched: it still goes through
      planTheme and never rewrites pieces.css. (2) "wired via package" matched anywhere in
      styles.css, so a commented-out `/* @import "@magic-spells/puzzle-pieces/themes/dim.css"; */` —
      a palette the app deliberately turned OFF — suppressed the copy. The match is now made against
      comment-stripped CSS and has to sit inside an `@import` statement; an unterminated `/*`
      swallows the rest of the file, as a browser parses it. Both rules are covered by tests,
      including the commented-out case for a named palette and for the default through `add piece`.
---

# D171 — `puzzle add theme <name…>`

The pieces registry ships four palettes (`registry/theme/{pieces,dim,warm,void}.css`,
0.8.0) and lists them in `registry.json` under `themes` with
`modes: [light, medium, dark]`. The CLI only knew the single default `theme` —
the one `add piece` copies to `app/styles/pieces.css` — so the other three were
reachable only by hand-copying. That is exactly how Sites and Pyramid ended up
with drifting copies. `puzzle add theme` closes the loop for copy-in apps.

## Rules

- **The default palette is not re-implemented.** The entry whose `file` equals
  `Registry.Theme` (matched on the FILE, not the name, so a third-party registry
  can call it anything) goes through the same `planTheme` `add piece` uses:
  destination `app/styles/pieces.css`, marker detection, lock key
  `theme/pieces.css`, the existing `@import './pieces.css';` advisory. `puzzle
  add theme default` and `puzzle add piece` are therefore idempotent with each
  other — one file, one lock entry, in either order.
- **Every other palette** copies verbatim to `app/styles/themes/<name>.css` and
  is locked as a unit keyed by its registry path (`theme/dim.css`) — the same
  lock shape as the default and a lib.
- **Plan first, then write.** Names resolve (exact, case-sensitive) before
  anything is fetched, and every destination is checked before the first byte is
  written, so an unknown name or one refused destination leaves the app
  untouched — the all-or-nothing rule `add piece` already has.
- **Already installed**: bytes identical to the registry copy, or a copy still
  matching the hash `pieces.lock` recorded, reads as *up to date* and is skipped.
  Anything else is the user's own edit and is refused unless `--overwrite`.
- **Symlinked destination**: reported and skipped (a deliberate dev/shared link);
  `--overwrite` writes THROUGH it rather than replacing the link. The symlink
  test is on the unresolved path — `containedWritePath` has already followed it.
- **Wired via package.** If `app/styles/styles.css` imports
  `@magic-spells/puzzle-pieces/themes/<name>.css` (either quote style) the app
  already has that palette from the package, so a copy beside it could only
  drift: the theme is reported *wired via package* and skipped. This extends to
  the DEFAULT palette inside `planTheme` state (a), so `add piece` stops copying
  `pieces.css` into apps that import `themes/default.css`.
- **Manifest paths stay untrusted.** `Theme.File` goes through
  `validateManifestPath` exactly as `Registry.Theme` does, and `Theme.Name` — the
  one registry string that becomes a path segment on its own — additionally
  rejects `/`.
- **D3 holds**: `styles.css` is user-owned, so the `@import './themes/<name>.css';`
  line and the one `data-scheme="<name>"` / `data-theme="light|medium|dark"`
  switch line are PRINTED, never written. The switch line prints once per run.
- **No name** lists the registry's palettes (name, label, description) with this
  app's state per theme (`installed` / `wired via package` / `wired` / `—`) and
  exits 0; an unknown name's error carries the same available list plus a
  did-you-mean.
- A registry predating the `themes` array still offers its single default
  palette, synthesized from `Registry.Theme` — `add theme` must not hard-fail
  against an older pieces release.

## Rejected

- **A `--theme <name>` flag on `add piece`** — rejected. Copying a palette is not
  part of adding a component: it has its own destinations, its own already-
  installed semantics, and a listing mode. Bolting it onto `add piece` would have
  meant `puzzle add piece --theme dim` with no piece name, and no place to show
  the palettes at all.
- **Rewriting `styles.css` with the import** — rejected, D3. The file is the
  user's.
- **`update` / `remove` for themes** — out of scope for 0.8.0; `--overwrite` is
  the refresh path, deletion is the user's.

## Where

`compiler/internal/pieces/themes.go` (+ `themes_test.go`), the `Registry.Themes`
/ `Registry.Modes` fields in `registry.go`, the `planTheme` state-(a) extension
in `pieces.go`, and the `theme` selector in `cmd/puzzle/add.go`.
