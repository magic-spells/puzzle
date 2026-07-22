---
name: "D43 — Formatter calls compile with the __missing typo-guard: warn once, pass through (v1.12)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - DECISION-D25-BARE-FORMATTER-CALLS
  - DOC-SPEC
  - DOC-TEMPLATE-SYNTAX
  - FEATURE-V1-12-FORMATTER-GUARD
notes:
  - kind: state
    text: >-
      Round-3 (fix/code-review-round3): emission switched from dot to BRACKET access — (__f["name"]
      || __f.__missing("name"))(…). Dot access made a hyphenated formatter name parse as
      subtraction: valid JS, silent at build, then a runtime ReferenceError thrown BEFORE the guard
      could engage. Bracket access with a JSON-quoted name matches the runtime registry's arbitrary
      string keys; goldens (formatter_chain, golden #1 TodoItem) updated, diffs
      formatter-access-only.
---

# D43 — Formatter calls compile with the `__missing` typo-guard: warn once, pass through (v1.12)

Supersedes the deferral in [[DECISION-D25-BARE-FORMATTER-CALLS]]. Codegen emits
`(__f.name || __f.__missing("name"))(value, args…)` instead of bare
`__f.name(…)`; the runtime's `__missing` becomes a **factory** that logs one
`console.error` per unknown name (with a did-you-mean suggestion when a close
match exists) and passes the value through unchanged, so the app keeps
rendering. See [[DOC-SPEC]] §6.

## Context
D25 shipped v1 with bare calls to match golden file #1; a typo'd formatter
(`{ name | captialize }`) crashed the render with an anonymous
`TypeError: __f.captialize is not a function` — debuggable but hostile, and the
crash takes the whole view down for a display-only mistake. The registry already
carried a `__missing` slot, but as a *silent* pass-through the old
`(… || __f.__missing)` form could never name the offender. A compile-time check
is impossible by design: custom formatters are registered at runtime in the app
config, and the Go compiler never parses JS (the real-JS rule, SPEC §4).

## Decision
- **`__missing` is a factory, so the warning can name the typo.** Codegen passes
  the *name* — `__f.__missing("captialize")` — and the factory returns a
  pass-through formatter after logging once per name:
  `[puzzle] unknown formatter "captialize" — value passed through unchanged (did
  you mean "capitalize"?)`. The suggestion is a nearest known registry key at
  edit distance ≤ 2 (omitted when nothing is close). Warn-once matches the
  established runtime pattern (malformed animation specs, duplicate keys).
  (Rejected: the original COMPILER_DESIGN §d form `(__f.name || __f.__missing)`
  — it calls the fallback *as* the formatter, so the message cannot say which
  name was wrong, which is the entire point of a typo-guard.)
- **Warn and pass through, never throw.** A display-only transformation must not
  take down the render loop; the un-formatted value on screen plus a named
  console error is strictly better feedback than a dead view. (Rejected:
  throwing — turns a cosmetic typo into a blank page; rejected: warning in dev
  builds only — the guard is a handful of bytes and misregistered *custom*
  formatters happen in production configs too.)
- **The golden fixture moves with the contract.** Golden file #1 (the
  hand-written fixture the runtime was proven against) and every compiled golden
  are updated to the wrapped form — the fixture is the correctness definition,
  so amending the emission contract means amending the fixture, byte-match
  preserved. `ScanFormatters`' over-inclusion rationale is updated in place: a
  missing builtin now warns-and-passes-through instead of crashing, but the scan
  still seeds every used builtin so the guard stays a *typo* guard, not a
  bundling crutch.

## Alternatives rejected
- **Nameless `(__f.name || __f.__missing)` wrapping, throwing, dev-only
  warnings** — covered above.
- **Compile-time unknown-formatter errors** — impossible without parsing the
  app's JS (real-JS rule); the compiler cannot know the runtime registry.

## Consequences
Compiler (codegen emission + golden files) and runtime registry
(`__missing` factory, `get()` updated to match); template grammar unchanged —
`.pzl` sources are untouched, only emitted JS differs. Bundle cost is a few
bytes per formatter call site. Non-breaking for apps: valid formatter chains
emit the same results; the only behavior change is typo'd chains rendering
(with a console error) instead of crashing.
