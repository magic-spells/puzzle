---
name: >-
  D127 — One runtime owner for display coercion: displayValue; nullish renders empty, a missing
  field warns in dev
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
  - DECISION-D173-CORE-SEMANTICS
verified_at: '2026-07-27T04:56:00.000Z'
verified_sha: c6b0dd9b8a28e8686d17b364150ae9b82912e92f
code_refs:
  - client-runtime/display.js
  - compiler/internal/codegen/codegen.go
---

# D127 — One runtime owner for display coercion

`displayValue` (`client-runtime/display.js`, exported from the package root) is
the single owner of "how a value becomes display text". ViewManager and the SSG
serializer delegate to it, and codegen emits calls to it (never `String(...)`)
for bare text runs, inline `{#if}` in attribute values, and quoted-attribute
template literals. Generated modules import it as
`displayValue as __s`, **usage-gated** so modules without a stringifying
interpolation stay byte-identical.

## Text and quoted-attribute positions

| value | renders |
|---|---|
| `null` | `''` (silent — ordinary optional data) |
| `undefined` | `''` + dev warning (usually a typo'd or renamed field) |
| `''`, `0`, `false` | `''`, `'0'`, `'false'` |
| other numbers | `Number::toString`; `NaN`/±Infinity → `''` (D173 V6) |
| a list | items by this rule, joined with `,` |
| other objects (a record, a `Date`) | `''` + dev warning (a `Date` points at `date()`) |
| function, symbol | `String(value)` — never interpolate one |

**`??` semantics, never `||`** — `||` would blank `0` and `false` (pinned by a
test).

A **brace-only attribute** (`data-x={ x }`) is not a text position: `setAttr`
and the serializer keep DOM semantics — `false`/`null`/`undefined`/objects omit
the attribute (with the same dev warnings), `true` writes it empty, a list joins
with spaces (D173 V9), anything else goes through `displayValue`. Brace-only
controls presence; quoted is text.

## Zero production bytes for the warning

Codegen has no dev/prod flag (`__PUZZLE_DEV__` is a bundle-time define), so the
expression label rides a dev-gated ternary production folds away:

```js
__s(__d.middleName, typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? 'middleName' : 0)
```

When checking a production bundle, grep the label **with quotes**
(`'activeTodos.length'`) — the unquoted identifier legitimately survives as
code.

## Config-time throws stay ungated

`FormatterRegistry.register()`'s type guards ship in production on purpose (like
the router's config throws): with `dropConsole` the D43 fail-soft's
`console.error` is stripped, so a config-time throw is the only production
signal of a broken registration. Don't gate them as "dev bytes".

## Alternatives

- **Fix only bare interpolation** — leaves quoted attributes printing `"null"`.
- **Silent blank for `undefined` too** — hides field typos that used to be
  visible on the page.
