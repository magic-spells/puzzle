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

The pieces registry ships palettes (`registry/theme/{pieces,cool,warm,void}.css`),
listed in `registry.json` under `themes` (`default`, `cool`, `warm`, `void`)
with the style modes under `modes` (`dark`, `dim`, `mixed`, `light`; a
registry that omits `modes` gets `light`, `medium`, `dark`). `puzzle add theme`
copies palettes into copy-in apps, so nobody hand-copies one and lets it drift.

## Rules

- **The default palette reuses `planTheme`.** The entry whose `file` equals
  `Registry.Theme` (matched on the file, not the name) goes where `add piece`
  puts it: `app/styles/pieces.css`, lock key `theme/pieces.css`, the
  `@import './pieces.css';` advisory. `add theme default` and `add piece` are
  idempotent with each other.
- **Other palettes** copy verbatim to `app/styles/themes/<name>.css`, locked by
  registry path (`theme/cool.css`).
- **Plan first, then write**: names resolve (exact, case-sensitive) and every
  destination is checked before the first byte is written — all or nothing.
- **Already installed** (same rules for every palette): bytes identical to the
  registry copy are *up to date*. A copy that differs from the registry but
  matches its `pieces.lock` hash is an unmodified older version: replaced,
  re-locked, reported *updated*, with no import line or switch advisory
  reprinted. Anything else is a local edit, refused unless `--force` (the
  hidden `--overwrite` alias still works).
- **Theme hashes fold CRLF to LF** (`themeHash` in `pieces/lock.go`), so a
  Windows checkout with `core.autocrlf=true` doesn't read every unmodified
  palette as locally edited. Every theme comparison and every theme hash
  written to `pieces.lock` goes through it; piece and lib hashes stay raw
  bytes.
- **Symlinked destination**: reported and skipped; `--force` writes through
  it. The symlink test runs on the unresolved path (`containedWritePath` has
  already followed it).
- **Wired via package**: if `app/styles/styles.css` has a live `@import` of
  `@magic-spells/puzzle-pieces/themes/<name>.css` (matched in comment-stripped
  CSS; an unterminated `/*` swallows the rest, as a browser parses it), the
  palette is reported *wired via package* and skipped. This applies to the
  default inside `planTheme`, so `add piece` doesn't copy `pieces.css` into
  apps importing `themes/default.css`.
- **Manifest paths are untrusted**: `Theme.File` goes through
  `validateManifestPath`; `Theme.Name` also rejects `/`.
- **D3 holds**: the `@import './themes/<name>.css';` line and one
  `data-scheme="<name>"` / `data-theme="<mode>|…"` switch line are printed,
  never written; the switch line prints once per run.
- **No name** lists palettes (name, label, description) with the app's state
  per theme (`installed`, `installed · outdated`, `wired via package`,
  `wired`, `—`), exit 0. An unknown name errors with the list plus a
  did-you-mean.
- A registry without a `themes` array still offers its single default palette,
  synthesized from `Registry.Theme`.
- **`add piece` flags a stale theme.** `add piece` never rewrites an existing
  `app/styles/pieces.css`, so pieces using newer tokens would render unstyled
  against an older copy. When the file exists (and the tokens are not
  hand-merged into styles.css or package-imported), `staleThemeHint` compares
  it with the registry theme: identical is quiet; a copy matching its lock
  hash prints "run `puzzle add theme default`"; anything else prints the
  hand-merge / `--force` wording. Print-only; a registry without the theme
  file skips the hint. Pieces may therefore use new tokens freely.
- **A piece names the palettes it needs** in its manifest's `themes` array
  (`appearance-picker`: `cool`, `warm`, `void`). `add piece` unions them across
  the resolved set and prints one `puzzle add theme <names…>` line for those
  the app has neither on disk nor package-imported (the default is left to
  `planTheme`). Print-only (D3), never copied. Not `registryDependencies`: an
  older CLI would read a palette name as an unknown piece.

## Alternatives rejected

- **`--theme <name>` on `add piece`** — a palette has its own destinations,
  install semantics and listing; `add piece --theme cool` with no piece is
  nonsense.
- **Writing the import into `styles.css`** — D3; the file is the user's.
- **Lock-hash match = up to date** — an old unmodified copy would never
  refresh without `--force`, which also discards real edits.
- **`update` / `remove` for themes** — not needed: re-running refreshes an
  unmodified copy, `--force` replaces an edited one, deletion is the user's.

## Where

`compiler/internal/pieces/themes.go` (+ `themes_test.go`), `Registry.Themes` /
`Registry.Modes` in `registry.go`, `planTheme` and `staleThemeHint` in
`pieces.go`, `themeHash` in `lock.go`, the `theme` selector in
`cmd/puzzle/add.go`.
