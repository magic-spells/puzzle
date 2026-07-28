---
name: >-
  D127 — one runtime owner for display coercion: nullish interpolation renders empty, and a
  missing field warns in dev
status: verified
connections:
  - DECISION-D22-NO-ESCAPE-BY-DEFAULT
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-FORMATTERS
  - COMPONENT-SSG
  - DOC-COMPILER-DESIGN
  - DOC-SPEC-TEMPLATE
verified_at: '2026-07-27T04:56:00.000Z'
verified_sha: c6b0dd9b8a28e8686d17b364150ae9b82912e92f
notes:
  - kind: decision
    text: >-
      Config-error throws ship UNGATED in production, deliberately (Cory-ratified at the 0.4.0
      pre-release review by merging PR #37 with the guards kept): FormatterRegistry.register()'s two
      type guards (~100 gzip bytes) stay outside the __PUZZLE_DEV__ fold, matching the router's
      validateGuard/transitionMode/base posture. Rationale: with dropConsole (production default)
      the D43 unknown-formatter fail-soft's console.error is STRIPPED, so a broken registration
      would otherwise render unformatted values with zero signal anywhere — the register throw at
      config time is the only production-visible evidence. Do not re-flag these strings as dev bytes
      leaking into production; gating them (or any config throw) trades a loud config-time failure
      for silent breakage.
    sha: bd46628
---

# D127 — one runtime owner for display coercion

`{ maybeNull }` rendered the literal four-letter word **`null`** on the page, and
`{ maybeUndefined }` rendered `undefined`. This amends the text-interpolation
contract in `DOC-COMPILER-DESIGN` — *"text interpolation uses `String(value)`"* —
which is why it needs a card rather than being filed as a bug fix.

## Why the existing guard never fired

The runtime already had the right rule:

```js
function stringify(v) { return v == null ? '' : String(v); }
```

It was **dead on this path**. The compiler emitted `String(__d.x)` at compile
time, so by the time the runtime saw the value it was already the *string*
`"null"`. `"null" == null` is false, and it passed straight through.

That rule also existed **twice, byte-identically, neither copy exported** — once
in `views/viewManager.js` and once in `ssg/serialize.js` — with the compiler's
hardcoded `String(...)` as a third, divergent statement of the same policy. The
same duplicate-owner shape that produced O-4 in the parser and O-6/O-10 in the
router.

## The compiler disagreed with itself

Within a single element, before this change:

```js
class:    `a ${__d.cls}`,   // null -> "a null"
title:    `${__d.t}`,       // null -> "null"
'data-x': __d.x,            // null -> raw -> runtime stringify -> ""
```

A brace-only attribute passed the raw value through (so the runtime guard *did*
fire), while a quoted attribute went through a template literal (so it did not).
Same value, same element, two answers, decided by whether the author typed
quotes. Fixing only the bare-interpolation case would have left this in place,
which is why the quoted-attribute path is part of the change.

## Decision

`displayValue` in `client-runtime/display.js`, exported from the package root, is
the single owner of "how a value becomes display text." Both former `stringify`
copies delegate to it, and the compiler emits a call to it instead of
`String(...)` — at both codegen sites (bare text runs and inline `{#if}` inside
attribute values) and in the quoted-attribute template-literal path. Generated
modules import it aliased:

```js
import { ViewNode, displayValue as __s } from '@magic-spells/puzzle';
```

The import is **usage-gated** — emitted only when a module actually contains a
stringifying interpolation — so templates without one stay byte-identical and the
golden churn stayed at the predicted 13 files.

| value | renders | note |
|---|---|---|
| `null` | `''` | silent — ordinary optional data |
| `undefined` | `''` | **plus a dev-only warning** |
| `''`, `0`, `false` | unchanged | |
| `NaN`, objects, symbols | unchanged | out of scope, see below |

**`??` semantics, never `||`.** `||` would blank `{ count }` when the count is
`0` and `{ isActive }` when it is `false` — trading a visible wrong value for a
silently missing one, which is strictly worse than the bug. This is pinned by a
test.

## Why `undefined` warns and `null` does not

They mean different things, and collapsing both to a silent blank would make this
change a net loss for debugging.

`null` is a value someone chose: most people have no middle name. Rendering
nothing is correct and unremarkable.

`undefined` almost always means the field does not exist — a typo like
`{ user.middlename }`, or a renamed model field. Today that renders `undefined`
on the page: ugly, but **visible**. A naive nullish fix turns it into an empty
string, and the typo disappears. The dev warning is what keeps the class of bug
findable, and it follows the [[DECISION-D43-FORMATTER-MISSING-GUARD]] posture
exactly — an unknown formatter name warns once with a did-you-mean and renders
through rather than crashing. Same shape, one layer down.

## Zero production bytes

The warning path is gated behind the `__PUZZLE_DEV__` probe (D57 pattern), as the
D43 did-you-mean machinery and the D126 route-shadow warning already are.

The constraint that shaped the implementation: `codegen.Options` carries
`{Filename, Mode, ModulePath}` and **no dev/prod flag** — `__PUZZLE_DEV__` is an
esbuild define applied at bundle time, so generated code is mode-independent.
Naming the offending expression in the warning therefore required the name to
reach the helper in a form production dead-code elimination removes, rather than
as a bare string literal that would ship one per interpolation site.

The emitted form carries the name behind a dev-gated ternary that production
constant-folds away:

```js
__s(__d.middleName, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'middleName' : 0)
```

Verified against a real production build rather than assumed, the same way
D121's zero-production-byte claim and D126's shadow warning were. Production
emits `S(r.activeTodos.length,0)` — the identifier survives only as the
executable member expression it has to be, while the diagnostic label and the
warning text are both absent:

```
grep "'activeTodos.length'"      -> 0    (quote-bounded: the label is gone)
grep 'undefined template value'  -> 0    (warning text absent)
```

Worth recording because the naive check misleads: an unquoted grep for
`activeTodos.length` returns 1, matching the required code rather than a leaked
literal. Bound the pattern with quotes when re-checking this.

## Scope, stated honestly

This fixes nullish only. `NaN` still renders `"NaN"`, an object still renders
`"[object Object]"`, and a `Symbol` still throws. Those are a separate question
about what interpolation should coerce in general, and answering it would mean
deciding whether a template silently accepts a value that almost certainly
indicates a bug. Not answered here.

## Consequences

- Goldens moved. This is the only change in the review round that touches them:
  13 golden files, plus the hand-authored byte-compare fixtures `-update` cannot
  regenerate (D14), the `pretest`-regenerated example modules, and two Go
  substring assertions. That cost is paid once and buys a single owner — a future
  change to coercion (NaN, objects) is now a one-line runtime edit with no golden
  churn at all.
- Apps relying on the literal `"null"` appearing in output will change behavior.
  No example in the repo did.
