---
name: piece registry installer
status: verified
path: compiler/internal/pieces/pieces.go
language: go
summary: Piece dependency resolution, safety preflight, copies, theme, and lock updates.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: gotcha
    text: >-
      `planTheme` counts styles.css as wired only on a live `@import` of pieces.css
      (`piecesCssImported`), never a substring match, so a comment that mentions pieces.css still
      gets the palette copied (`TestAddPieceCommentMentionIsNotWired`). AddThemes' default-theme
      switch has no mention-only arm for the same reason. `EvalSymlinksAllowMissing` is shared from
      internal/fsutil with generate.
---

# pieces.go

`puzzle add piece` ([[COMPONENT-COMPILER-CLI]]): resolves requested pieces with
their transitive deps, copies every file verbatim into the app, records hashes in
`pieces.lock`, and returns next steps (npm install line, component stylesheet imports,
theme advisory) for the CLI to print. Siblings hold the rest: `deps.go`, `fetcher.go`/`npm.go`/
`registry.go` (sources), `lock.go`, `themes.go`.

- **All-or-nothing.** Every file is fetched and every destination checked before
  the first write; one conflict without overwrite writes nothing.
- No path walking or source selection here — the cmd layer passes a resolved app
  root and a bound fetcher.
- Manifest paths are checked raw (backslashes never normalized away), and an
  existing `pieces.css` is never rewritten — stale themes get a hint instead.
