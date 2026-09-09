---
name: "D45 — `backspace`/`delete` key filters (v1.13)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D38-EVENT-MODIFIERS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - DOC-EVENTS
  - DOC-SPEC
---

# D45 — `backspace`/`delete` key filters (v1.13)

Adds `backspace` (→ `event.key === 'Backspace'`) and `delete` (→ `'Delete'`) to the [[DECISION-D38-EVENT-MODIFIERS]] key-filter set. Two-table change (parser `eventKeyFilters`, runtime `KEY_FILTERS`) + docs; every D38 rule applies unchanged.

## Context

D38 shipped `enter/escape/tab/space/up/down/left/right`. Editor-style UIs (the Grimoire example) reach for Backspace and Delete constantly; Vue's modifier set has carried both for years. The omission was arbitrary, not principled.

## Decision

`@keydown:backspace={ … }` and `@keydown:delete={ … }` (also `keyup`/`keypress`) gate on `event.key` `'Backspace'`/`'Delete'`. Everything else is D38 verbatim: keyboard-events-only, one key filter per binding, canonical order (key-gate first), compile errors for misuse.

**Known limit (documented, not a gap):** a *conditional* intercept — e.g. Backspace-merges-blocks only when the caret is at offset 0 — cannot use `:prevent` (it would swallow ordinary deletion). That case is a plain `@keydown` handler calling `event.preventDefault()` behind its own guard. The filters serve the unconditional cases.

## Alternatives rejected

- **Full Vue parity in one go** (`home/end/pageup/pagedown`, `ctrl/meta/shift/alt` system modifiers). System-modifier *combinations* (`:ctrl:enter`) interact with the one-key-filter rule and deserve their own decision; don't smuggle them in.

## Consequences

Additive; modifier-free bindings and existing filters byte-identical. Parser + runtime tables must stay mirrored (the D38 invariant).
