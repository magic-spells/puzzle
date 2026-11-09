---
name: piece registry installer
status: verified
path: compiler/internal/pieces/pieces.go
language: go
summary: Piece dependency resolution, safety preflight, copies, theme, and lock updates.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
notes:
  - kind: gotcha
    text: >-
      `planTheme`'s "already wired" test uses `piecesCssImported` (a live @import), never a
      substring match on "pieces.css": a comment such as `/* TODO: move tokens to pieces.css */`
      used to make `add piece` skip the palette silently while `add theme` copied it (review F8-B1,
      `TestAddPieceCommentMentionIsNotWired`). AddThemes' default-theme switch therefore has no
      mention-only arm. `EvalSymlinksAllowMissing` is shared from internal/fsutil with generate.
---

# pieces.go

`puzzle add piece` ([[COMPONENT-COMPILER-CLI]]): resolves requested pieces with
their transitive deps, copies every file verbatim into the app, records hashes in
`pieces.lock`, and returns next steps (npm install line, theme advisory) for the
CLI to print. Siblings hold the rest: `deps.go`, `fetcher.go`/`npm.go`/
`registry.go` (sources), `lock.go`, `themes.go`.

- **All-or-nothing.** Every file is fetched and every destination checked before
  the first write; one conflict without overwrite writes nothing.
- No path walking or source selection here — the cmd layer passes a resolved app
  root and a bound fetcher.
- Manifest paths are checked raw (backslashes never normalized away), and an
  existing `pieces.css` is never rewritten — stale themes get a hint instead.
