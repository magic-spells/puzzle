---
name: >-
  D127 — One runtime owner for display coercion: displayValue; nullish renders empty, a missing
  field warns in dev
status: verified
connections:
  - DECISION-D22-NO-ESCAPE-BY-DEFAULT
  - DECISION-D43-FUNCTION-MISSING-GUARD
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-FORMATTERS
  - COMPONENT-SSG
  - DOC-COMPILER-DESIGN
  - DOC-SPEC-TEMPLATE
  - DECISION-D173-CORE-SEMANTICS
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/display.js
  - compiler/internal/codegen/codegen.go
---

# D127 — One runtime owner for display coercion

`displayValue` (`client-runtime/display.js`, exported from the package root) is
the single owner of "how a value becomes display text" — the D173 V6 printing
rule. ViewManager and the SSG serializer delegate to it, and codegen emits calls
to it (never `String(...)`) for text runs, inline `{#if}` in attribute values,
and quoted-attribute template literals. Generated modules import it as
`displayValue as __s`, only when the file has a stringifying interpolation.

## Decision

**Text and quoted-attribute positions:**

| value | renders |
|---|---|
| `null` | `''` (silent — ordinary optional data) |
| `undefined` | `''` + dev warning (usually a typo'd or renamed field) |
| `''`, `0`, `false` | `''`, `'0'`, `'false'` |
| other numbers | `Number::toString`; `NaN`/±Infinity → `''` |
| a list | items by this rule, joined with `,` |
| other objects (a record, a `Date`) | `''` + dev warning (a `Date` points at `date()`) |
| function, symbol | `String(value)` — never interpolate one |

Falsy is not empty: `0` and `false` print. Never coerce with `||`.

**A brace-only attribute** (`data-x={ x }`) is not a text position: `setAttr` and
the serializer keep DOM semantics — `false`/`null`/`undefined`/objects omit the
attribute (with the same dev warnings), `true` writes it empty, and a list is a
space-joined token list that drops `false` and empty items (D173 V9, the clsx
idiom). Anything else goes through `displayValue`. Brace-only controls presence;
quoted is text.

**Zero production bytes for the warning.** Codegen has no dev/prod flag
(`__PUZZLE_DEV__` is a bundle-time define), so the expression label rides a
dev-gated ternary that production folds away:

```js
__s(__d.middleName, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'middleName' : 0)
```

**Config-time throws stay ungated.** `FormatterRegistry.register()`'s type guards
ship in production on purpose (like the router's config throws): with
`dropConsole`, D43's fail-soft `console.error` is stripped, so a config-time
throw is the only production signal of a broken function registration. Don't
gate them as "dev bytes".

## Alternatives rejected

- **Fix only bare interpolation** — leaves quoted attributes printing `"null"`.
- **Silent blank for `undefined` too** — hides field typos.

## Gotchas

- When checking a production bundle for leaked labels, grep the label **with
  quotes** (`'activeTodos.length'`) — the unquoted identifier legitimately
  survives as code.
