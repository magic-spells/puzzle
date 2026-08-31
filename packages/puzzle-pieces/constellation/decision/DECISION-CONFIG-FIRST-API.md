---
name: Config-first APIs over compound components
status: built
connections:
  - DOC-REGISTRY
  - DECISION-WRAP-WEB-COMPONENTS
notes:
  - kind: decision
    text: >-
      Calendar family day-cell snippet (0.7.0, framework D166): Calendar declares <Slot name="day"
      date day selected today outside disabled inRange rangeStart rangeEnd> once inside its day loop
      — date is the ISO YYYY-MM-DD string, day the numeric day, the rest booleans describing cell
      state; the day number stays the fallback so existing callers see no change. The snippet
      replaces only the day button's inner content: the button, its ARIA
      (selected/current/disabled), grid roles, keyboard navigation, and range-highlight classes
      remain piece-owned. DatePicker and DateRangePicker do NOT redeclare the slot — they forward
      the caller's <Snippet fits="day"> through a bare <Children/> into the inner Calendar (D166
      forwarding), so one marker declaration serves every rendered grid; range flags are always
      false in DatePicker. Verified: 42 inner day buttons received forwarded snippet markup (jsdom),
      selected-state propagated.
---

# Config-first APIs over compound components

## Context

Many React component libraries lean on **compound components** — `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>` coordinating through React context. Puzzle has **no cross-component context API**; children can't reach into a parent's coordinating state.

## Decision

Every piece uses a **config-first API**: data in as props, structure described by config objects, behavior out via value-first callbacks. `<Select options={…} value={…} @change={…}/>`, not a `<SelectTrigger>`+`<SelectContent>` family. Presentational structure (dialog header/footer, table cells) is expressed with **named slots** (Puzzle D53) or documented Tailwind markup patterns — never coordinating subcomponents. Controlled-component discipline is the default: the parent owns `value`/`open`, props in / callbacks out, callbacks value-first (`this.props.change(value)`). The one sanctioned relaxation is a **wrapped** overlay ([[DECISION-WRAP-WEB-COMPONENTS]]): the web component may close itself and report it via `@hide({ result })`, and the parent re-syncs `open` after the fact — the config-first shape (props in, callbacks out) is unchanged; only who flips `open` first differs.

## Alternatives rejected

- **Compound components** — rejected; without context they'd require the consumer to thread shared state through every subcomponent by hand, which is worse than a single configured element and can't coordinate keyboard focus/roving tabindex reliably.
- **A userland context/provider shim** — rejected as over-engineering against a framework that deliberately omits it; it fights the framework's grain.

## Consequences

- Where a slot must be **looped** — one stamp per item — pieces use framework **snippets** (Puzzle D166, 0.7.0): the piece declares an argument-bearing marker inside its own loop (`<Slot name="cell" cell={ cell } row={ row }>{ cell.value }</Slot>`) and the caller supplies `<Snippet fits="cell" cell row>…</Snippet>`; the marker's paired body stays the fallback, so adoption never breaks an existing caller. Adopted so far: data-table (`cell`, `header-cell`), virtual-list (`row`), combobox/select/multi-select/command (`option`), tree (`node`), kanban (`card`, `column-header`), calendar (`day`, forwarded through date-picker and date-range-picker via a bare `<Children/>`). Pieces that have not adopted a snippet point yet still document the compose-directly recipe in their file headers; the pre-0.7.0 "named slots are static" limitation no longer applies.
- The standard prop/callback vocabulary (`variant`, `size`, `disabled`, `value`; `@change`, `@press`, `@show`, `@hide`, `@ready`) is the contract every piece inherits (full list in CLAUDE.md). A wrapper's props map one-to-one onto the custom element's attributes. Snippet slot names and parameters are part of that contract: a slot is named for the thing it stamps (`option`, `node`, `card`, `day`, `row`, `cell`), the primary parameter carries the item under that same noun, and state flags are booleans (`active`, `selected`, `disabled`, `expanded`, `today`…).
