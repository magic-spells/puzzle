// Package conformance embeds the Puzzle language's shared conformance tables,
// so every host runs the same rows pinned at the same module version: this
// module's Go tests, PuzzleKit's vitest suite (which imports the JSON files
// directly), and Magic Spells Sites (which imports this package at a tagged
// version).
//
//   - expressions-parse.json — the expression grammar: each case parses `src`
//     with github.com/magic-spells/puzzle/packages/puzzle-lang/expr and
//     expects either the tree's S-expression (expr.Print) or an error message
//     at an exact line and column.
//   - formatters.json — the standard formatter set (D174): each case pipes
//     `input` through `name` with `args` and expects `expect`.
package conformance

import _ "embed"

// ExpressionsParse is expressions-parse.json.
//
//go:embed expressions-parse.json
var ExpressionsParse []byte

// Formatters is formatters.json.
//
//go:embed formatters.json
var Formatters []byte
