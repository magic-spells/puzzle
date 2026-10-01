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
//   - functions.json — the function library (D176 §4, the standard set of
//     D174): each case calls `name(input, ...args)` and expects `expect`.
package conformance

import _ "embed"

// ExpressionsParse is expressions-parse.json.
//
//go:embed expressions-parse.json
var ExpressionsParse []byte

// Functions is functions.json.
//
//go:embed functions.json
var Functions []byte
