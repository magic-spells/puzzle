---
name: Config-first APIs over compound components
status: built
connections:
  - DOC-REGISTRY
  - DECISION-WRAP-WEB-COMPONENTS
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

- A honest limitation surfaces where slots would need to be dynamic/looped (e.g. ToggleGroup per-item icons, rich-content Accordion): Puzzle named slots are static, so those pieces document a compose-directly recipe instead. Recorded per piece in file headers, not duplicated across cards.
- The standard prop/callback vocabulary (`variant`, `size`, `disabled`, `value`; `@change`, `@press`, `@show`, `@hide`, `@ready`) is the contract every piece inherits (full list in CLAUDE.md). A wrapper's props map one-to-one onto the custom element's attributes.
