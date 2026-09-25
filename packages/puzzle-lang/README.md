# puzzle-lang

The Puzzle template language as a Go module:
`github.com/magic-spells/puzzle/packages/puzzle-lang`.

Puzzle is one template language with two dialects (PuzzleKit and Magic Spells
Sites; decision D172). This module is where the shared language lives:

- `parser` — the `.pzl` section splitter, the HTML-aware lexer, the
  recursive-descent template parser, the AST, and positioned `ParseError`s.
- `jsident` — the JavaScript reserved-binding-word table the parser and the
  compiler's code generator share.
- `textutil` — small text helpers (plural suffixes, the edit distance behind
  did-you-mean errors) shared by the parser and the compiler.

It holds no code generation, bundling, or CLI. Those stay in the PuzzleKit
compiler (`packages/puzzle/compiler`).

## Who imports it

- **PuzzleKit's compiler** (`packages/puzzle`). Its `go.mod` requires this
  module at `v0.0.0` and replaces it with `../puzzle-lang`, so the compiler
  always builds against the working tree.
- **Magic Spells Sites**, later. It vendors a pinned copy of the parser today
  and will switch to importing a tagged version of this module.

## Versions

This module versions in lockstep with the framework: its release is the
framework's version number. The Go toolchain finds a version of a module in a
repository subdirectory only through a tag prefixed with that directory, so
consumers outside this repo need a `packages/puzzle-lang/vX.Y.Z` tag next to
the framework's `vX.Y.Z` tag:

```bash
go get github.com/magic-spells/puzzle/packages/puzzle-lang@v0.8.0
```

## Tests

```bash
cd packages/puzzle-lang
go vet ./... && go test ./...
```

The parser's integration tests parse the todos example from the sibling
`packages/puzzle/examples/todos`, so run them inside a full checkout of the
monorepo.
