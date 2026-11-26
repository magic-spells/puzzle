---
name: method table and globals
status: verified
path: expr/methods.go
language: go
summary: >-
  The method table as data: string/array/number method names, the length properties, the callable
  global functions and constants, receiver-type inference for literal receivers, and the
  alternatives an error names.
connections:
  - FILE-EXPR-PARSER
  - TEST-COMPILER-PARSER
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# expr/methods.go

The method table — DECISION-D176-EXPRESSION-LANGUAGE rule 3, plus rule 1's global namespaces (framework plan, `repo=puzzle`).

The table is data the parser checks names against; it holds names only. Each host implements the behavior — PuzzleKit as the same JavaScript method, Sites as a Go reimplementation with a conformance row per method — so adding a name here adds it to both hosts' contract.

- **`StringMethods`, `ArrayMethods`, `NumberMethods`** and the `length` properties (a string's counts UTF-16 units). No array entry mutates its receiver: `toSorted` and `toReversed`, never `sort` and `reverse`.
- **`GlobalFunctions`** by namespace: the bare `Number`, `String`, `Boolean`, `parseInt`, `parseFloat`, `isNaN`, `isFinite` and the pure URI functions; `Math.abs`/`ceil`/`floor`/`round`/`trunc`/`max`/`min`/`sign`/`pow`/`sqrt`; `Object.keys`/`values`/`entries`; `Array.isArray`. **`GlobalConstants`** are `Math.PI` and `Math.E`.
- **`receiverType`** names a receiver's type when the syntax alone fixes it — a literal, a template literal, an array or object literal, a global constant, or a global call through `globalResultTypes` — so `'s'.filter(f)` or `Number(x).trim()` fails at parse time in both hosts. Any other receiver is checked by name only (`IsMethod`); PuzzleKit's `puzzle check` then types it, and Sites checks at run time.
- **`MethodAlternatives`** (and `globalAlternatives`) give the steer for a name that is not available (`sort` → `toSorted()`, `push` → `concat()`, `substr` → `slice()`, `getFullYear` → `date(v, preset)`, …).

`TestMethodTable` and `TestGlobalResultTypes` in `expr_test.go` pin the lists and the result types.
