---
name: 'D141 — Fallback bodies return to the capitalized markers'
status: planned
connections:
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-TEMPLATE
---

**PLANNED — not shipped.** Targeted at the first minor after 0.4.0. Nothing
below is in the compiler or runtime yet; 0.4.0 ships D134's self-closing-only
markers exactly as documented.

The composition markers regain paired forms carrying fallback content —
`<Children>…</Children>`, `<Slot name="x">…</Slot>`, and bare `<Slot>…</Slot>` —
rendered only when the call site (or the router) supplies nothing for that
position, and replaced entirely when it does. The capitalization rule, the
one-mechanism marker vnode, and the lowercase steering errors are all D134
unchanged; only the no-fallback rule is reversed.

## Context

D134 removed fallback bodies and deferred the is-slot-filled probe "until real
demand." The D134 ecosystem migration (2026-07-27) supplied that demand
immediately: six registry components (HoverCard, Popover, Popconfirm,
DropdownMenu, EmojiPicker, EmojiPickerSimple) relied on trigger-slot fallbacks,
four live call sites relied on the fill-wins swap, and the prop-opt-in
replacement pattern failed outright for the emoji pickers (`label` is their
always-set aria-label, so `{#if label}` can never reach the slot) — two
migration agents independently had to invent a `customTrigger` boolean. Vue,
native web components, Astro, and Angular 18+ all support slot fallback with
these exact semantics; Svelte 5 removed it but shipped a testable-children
probe as the replacement. Puzzle post-D134 has neither.

## Decision (planned)

- **Paired forms carry fallback; self-closing stays the empty form.** An empty
  paired body (`<Children></Children>`) means no fallback, same as
  self-closing (Vue's rule). D134's "paired form is a compile error" is
  reversed; its capitalization errors are not.
- **Uniform across the one mechanism.** `<Children>` and bare `<Slot>` are the
  same AST node (D134 kept the split as convention, not enforcement), so
  fallback applies uniformly: component default content, named-slot fallback,
  and — deliberately — the router outlet, where fallback renders when no child
  route content occupies the slot (a parent route rendering as the leaf).
- **No public is-slot-filled probe.** The runtime's marker expansion already
  knows whether a name was filled — that is all fallback needs. The probe stays
  deferred (D134's reasoning stands; Svelte-5-style testable slots remain a
  separate, unclaimed decision).
- **A fallback body is ordinary template content — no restricted subset.**
  Interpolations (including formatter pipes), `{#if}`/`{#for}`/`{#case}`
  blocks, components, event bindings, refs, and `{#svg}` inline SVG (D46) all
  parse and compile inside a fallback body through the SAME parser and codegen
  paths as any element body — the fallback children ride the existing
  `emitElement` child emission, so nothing is special-cased. One new rule to
  enforce: a composition marker may not appear inside another marker's
  fallback body (positioned compile error) — nested markers there have no
  coherent expansion order; relaxable later if a real case appears.
- **Mechanically, this is a scoped restore** of what D134 deleted, respelled:
  `Slot.Children` in the AST, the parser's paired-marker acceptance, codegen's
  fallback emission, and the runtime `expandChildList` fallback branch — plus
  the D134 self-close-required error's removal. Golden churn expected and
  acceptable (compiler-over-runtime-bytes: the runtime cost is one branch).

## Consequences (when built)

- The six trigger components can return to declarative fallback
  (`<Slot name="trigger">…stock chrome…</Slot>`) and drop the migration-era
  `customTrigger` opt-in / label-wins gating; their `label`-as-visible-text
  props can stay as sugar or go — per-component call at implementation time.
  Registry, demo, and docs-site copies move in lockstep (they are mirrors).
- The docs-site "Default content" section (written for D134) needs rewriting
  again to teach fallback-first with the prop pattern as the alternative.
- Fill-wins swap semantics restore the pre-D134 behavior the four migrated call
  sites originally relied on.
- Test obligations: compiler golden fixtures for fallback bodies containing a
  formatter interpolation, a control block, a component, and `{#svg}`; runtime
  tests for the swap in all three positions (component default content, named
  slot, empty router outlet) and for the nested-marker compile error. The
  DOC-DECISIONS.md entry and the SPEC §24 amendment land when this builds, not
  before.

## Alternatives rejected

- **Prop-opt-in as the permanent answer** — proved unable to express
  icon-as-default (emoji pickers) without inventing per-component boolean
  props; pushes a framework-shaped problem onto every component author.
- **Public is-slot-filled probe instead of fallback bodies** (Svelte 5's shape)
  — more API surface for the same six components' need; fallback bodies cover
  the demonstrated demand with zero new public API.
- **Fallback on named slots only (outlet excluded)** — would enforce a
  Slot/Children split the compiler deliberately keeps as one mechanism, and
  discards the genuinely useful empty-outlet case.
