---
name: D171 — `puzzle add theme <name…>` (palettes are registry content, copied like a piece)
status: built
connections:
  - DECISION-D169-REGISTRY-VERSION-FLOORS
  - DECISION-D32-CLI-TOOLING
  - DECISION-D03-SCRIPTS-REAL-JS
  - COMPONENT-COMPILER-CLI
---

# D171 — `puzzle add theme <name…>`

The pieces registry ships palettes (`registry/theme/{pieces,dim,warm,void}.css`)
listed in `registry.json` under `themes`, with `modes: [light, medium, dark]`.
`puzzle add theme` copies them into copy-in apps, so nobody hand-copies a
palette and lets it drift.

## Rules


- **The default palette reuses `planTheme`.** The entry whose `file` equals
  `Registry.Theme` (matched on the file, not the name) goes where `add piece`
  puts it: `app/styles/pieces.css`, lock key `theme/pieces.css`, the
  `@import './pieces.css';` advisory. `add theme default` and `add piece` are
  idempotent with each other.
- **Other palettes** copy verbatim to `app/styles/themes/<name>.css`, locked by
  registry path (`theme/dim.css`).
- **Plan first, then write**: names resolve (exact, case-sensitive) and every
  destination is checked before the first byte is written — all or nothing.
- **Already installed** (same rules for the default and named palettes):
  bytes identical to the registry copy are *up to date*. A copy that differs
  from the registry but matches its `pieces.lock` hash is an unmodified older
  version: replaced, re-locked, reported *updated*, with no import line or
  switch advisory reprinted. Anything else is a local edit, refused unless
  `--overwrite`.
- **Symlinked destination**: reported and skipped; `--overwrite` writes
  through it. The symlink test runs on the unresolved path
  (`containedWritePath` has already followed it).
- **Wired via package**: if `app/styles/styles.css` has an `@import` of
  `@magic-spells/puzzle-pieces/themes/<name>.css` — matched in
  comment-stripped CSS (an unterminated `/*` swallows the rest, as a browser
  parses it) — the palette is reported *wired via package* and skipped. This
  applies to the default inside `planTheme`, so `add piece` doesn't copy
  `pieces.css` into apps importing `themes/default.css`.
- **Manifest paths are untrusted**: `Theme.File` goes through
  `validateManifestPath`; `Theme.Name` also rejects `/`.
- **D3 holds**: the `@import './themes/<name>.css';` line and one
  `data-scheme="<name>"` / `data-theme="light|medium|dark"` switch line are
  printed, never written; the switch line prints once per run.
- **No name** lists palettes (name, label, description) with the app's state
  per theme (`installed` / `installed · outdated` when the file's bytes differ
  from the registry's / `wired via package` / `wired` / `—`), exit 0. An
  unknown name errors with the list plus a did-you-mean.
- A registry without a `themes` array still offers its single default palette,
  synthesized from `Registry.Theme`.
- **`add piece` flags a stale theme.** `add piece` never rewrites an existing
  `app/styles/pieces.css`, so pieces that use newer tokens would render
  unstyled against an older copy. When the file exists (and the tokens are not
  hand-merged into styles.css or package-imported), `staleThemeHint` compares
  it with the registry theme: identical is quiet; a copy matching its lock hash
  prints "older registry theme — run `puzzle add theme default`"; anything else
  prints the hand-merge / `--overwrite` wording. Print-only; a registry
  without the theme file skips the hint rather than failing the add. Pieces
  may therefore use new tokens freely.
- **A piece names the palettes it needs** in its manifest's `themes` array
  (`appearance-picker`: `dim`, `warm`, `void`). `add piece` unions them across
  the resolved set and prints one `puzzle add theme <names…>` line for the
  ones the app has neither on disk nor package-imported (the default palette
  is left to `planTheme`). Print-only (D3), never copied. Not
  `registryDependencies`: an older CLI would read a palette name as an unknown
  piece.

## Alternatives

- **`--theme <name>` on `add piece`** — a palette has its own destinations,
  install semantics and listing; `add piece --theme dim` with no piece is
  nonsense.
- **Writing the import into `styles.css`** — D3; the file is the user's.
- **Lock-hash match = up to date** — an old unmodified copy would never
  refresh without `--overwrite`, which also discards real edits.
- **`update` / `remove` for themes** — not needed: re-running refreshes an
  unmodified copy, `--overwrite` replaces an edited one, deletion is the
  user's.

## Where

`compiler/internal/pieces/themes.go` (+ `themes_test.go`), `Registry.Themes` /
`Registry.Modes` in `registry.go`, `planTheme` in `pieces.go`, the `theme`
selector in `cmd/puzzle/add.go`.
