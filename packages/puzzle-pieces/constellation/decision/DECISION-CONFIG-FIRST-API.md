---
name: Config-first APIs over compound components
status: built
connections:
  - DOC-REGISTRY
  - DECISION-WRAP-WEB-COMPONENTS
notes:
  - kind: gotcha
    text: >-
      Calendar day-slot parameters and forwarding: date is the ISO YYYY-MM-DD string, day the
      numeric day-of-month, and selected/today/outside/disabled/inRange/rangeStart/rangeEnd are
      booleans. DatePicker and DateRangePicker declare NO day marker of their own — they forward the
      caller's <Snippet fits="day"> through a bare <Children/> into the inner Calendar, so
      self-closing <Calendar .../> silently drops caller snippets (the fallback day number still
      renders and looks correct); DatePicker passes no range, so its range flags are always false.
      Snippet content is stamped INSIDE the day <button>: it must be non-interactive (no nested
      button/link/input) or it is invalid HTML and breaks the roving-tabindex/gridcell model.
---

# Config-first APIs over compound components

## Context

Many React component libraries lean on **compound components** — `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>` coordinating through React context. Puzzle has **no cross-component context API**; children can't reach into a parent's coordinating state.

## Decision


Every piece uses a **config-first API**: data in as props, structure described by config objects, behavior out via value-first callbacks. `<Select options={…} value={…} @change={…}/>`, not a `<SelectTrigger>`+`<SelectContent>` family. Controlled-component discipline is the default: the parent owns `value`/`open`, props in / callbacks out, callbacks value-first (`this.props.change(value)`).

Presentational structure is caller-customizable without giving away behavioral ownership. Static regions use named slots; repeated regions use Puzzle's args-bearing marker + caller `<Snippet>` contract. The component keeps the semantic/interactive wrapper, focus model, ARIA, and event handlers, hands only documented render values to the snippet, and keeps its stock markup in the marker fallback so callers that supply no snippet render unchanged.

The picker family standardizes one repeated region: `option` hands the original authored entry as `item` plus booleans `active`, `selected`, and `disabled`. `active` is the keyboard/pointer-highlighted row; `selected` is persistent controlled-value membership (therefore false for Command, which has no persistent selection, and for MultiSelect dropdown rows, because selected entries are hidden); `disabled` mirrors the entry flag. Combobox, Select, MultiSelect, and Command retain each option element's id, role, aria state, and handlers around the snippet output. MultiSelect chips remain component-owned: they are selected-value controls with removal semantics, and a selected value can exist without a resolvable option entry.

**Amendment (2026-09-04): config-first is the rule for PORTED pieces.** A WRAPPED piece whose web component coordinates SIBLING elements through the DOM — `dropdown-component` > `dropdown-trigger` + `dropdown-panel` — is a compound FAMILY instead: a directory of one-class-per-file members plus an `index.js` barrel (framework decision D167 in `packages/puzzle`), invoked `<NavigationMenu><NavigationMenu.Item>…`. The context objection above does not apply, because the coordination lives in the custom element rather than in Puzzle — the members are thin attribute bindings with no shared state to thread. Nested-config props (`items[].children[]`) are the anti-pattern this replaces. Flat leaf lists (`options`, `steps`, `columns`) stay config-first.

The one sanctioned controlled-state relaxation is a **wrapped** overlay ([[DECISION-WRAP-WEB-COMPONENTS]]): the web component may close itself and report it via `@hide({ result })`, and the parent re-syncs `open` after the fact — the config-first shape (props in, callbacks out) is unchanged; only who flips `open` first differs.

## Alternatives rejected

- **Compound components** — rejected; without context they'd require the consumer to thread shared state through every subcomponent by hand, which is worse than a single configured element and can't coordinate keyboard focus/roving tabindex reliably.
- **A userland context/provider shim** — rejected as over-engineering against a framework that deliberately omits it; it fights the framework's grain.

## Consequences

- Where a slot must be **looped** — one stamp per item — pieces use framework **snippets** (Puzzle D166, 0.7.0): the piece declares an argument-bearing marker inside its own loop (`<Slot name="cell" cell={ cell } row={ row }>{ cell.value }</Slot>`) and the caller supplies `<Snippet fits="cell" cell row>…</Snippet>`; the marker's paired body stays the fallback, so adoption never breaks an existing caller. Adopted so far: data-table (`cell`, `header-cell`), virtual-list (`row`), combobox/select/multi-select/command (`option`), tree (`node`), kanban (`card`, `column-header`), calendar (`day`, forwarded through date-picker and date-range-picker via a bare `<Children/>`). Pieces that have not adopted a snippet point yet still document the compose-directly recipe in their file headers; the pre-0.7.0 "named slots are static" limitation no longer applies.
- The standard prop/callback vocabulary (`variant`, `size`, `disabled`, `value`; `@change`, `@press`, `@show`, `@hide`, `@ready`) is the contract every piece inherits (full list in CLAUDE.md). A wrapper's props map one-to-one onto the custom element's attributes. Snippet slot names and parameters are part of that contract: a slot is named for the thing it stamps (`option`, `node`, `card`, `day`, `row`, `cell`), the primary parameter carries the item under that same noun, and state flags are booleans (`active`, `selected`, `disabled`, `expanded`, `today`…).
- A snippet receives only the documented values and cannot reach into piece internals. The piece must preserve the semantic wrapper and must not move keyboard, selection, focus, or ARIA ownership into caller markup.
