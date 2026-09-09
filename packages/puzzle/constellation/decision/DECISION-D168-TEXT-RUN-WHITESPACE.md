---
name: 'D168 — text-run whitespace: one space at run and control-flow boundaries'
status: built
connections:
  - COMPONENT-CODEGEN
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - FILE-CODEGEN
notes:
  - kind: decision
    sha: 513d834
    text: >-
      Control-flow boundaries are padded (0.7.0 final review). `processChildren` classifies each
      run's neighbours (`isControlFlow` — If, For, Case only) and passes `leftBlock`/`rightBlock`
      into `buildTextRun`, which also tracks a leading strip carried by no segment (a
      whitespace-only node dropped before anything else in the run). The other way out — document
      the limit and tell authors to keep the conditional on the same line — was rejected. Element
      boundaries deliberately stay unpadded, and so does a whitespace-only gap between two blocks
      (no run to pad; padding it would add a text vnode wherever conditionals stack). Incremental
      corpus check over the run-internal rule: 4 of 657 `.pzl` files move (music, chirp, todos,
      scaffold todos), and the hand-written golden `tests/fixtures/todos/Home.compiled.js` gains a
      trailing space in three button labels — the first time a D168 change moved a golden.
---

# D168 — text-run whitespace: one space at run and control-flow boundaries

A line break between a word and `{ expr }`, between two interpolations, or
between a text run and an adjacent `{#if}` / `{#for}` / `{#case}` block renders
as one space — as it does in HTML, Vue and Svelte. Element-boundary indentation
is still dropped. Found and fixed in the 0.7.0 final review (2026-09-06).

## Context

The template whitespace policy lived only in the codegen package doc: collapse
every whitespace run to one space, strip a leading/trailing space whose run
held a newline (it was source indentation), drop a whitespace-only node that
held a newline. `buildTextRun` then coalesces adjacent text and interpolation
siblings into ONE text vnode by concatenation. The strip ran at every text-node
edge, including the boundaries between members of one run, so

```html
<p>{ user.first }
   { user.last }</p>
<p>— you have { count } new
    { count === 1 ? 'message' : 'messages' }.</p>
```

rendered "JohnDoe" and "newmessages", and `examples/stays`' listing summary
shipped as "4 guests ·2 bedrooms ·2 beds ·1 bath". A control-flow block breaks
the coalesced run, so the same strip glued a word to a following block:
`you have { n } new\n  {#if x}message{/if}` rendered "newmessage". A browser
collapses those newlines to a single space; Vue's default `condense` and Svelte
keep them too. No user-facing card documented the policy, so an author had
nothing to consult.

## Decision

The strip is an **element-boundary** rule. A boundary that is not an element
boundary — inside a coalesced text run, or between a run and an adjacent
control-flow block — keeps exactly one space when the source had whitespace
there.

- **Run-internal.** A stripped edge that borders another run member (an
  interpolation, or a text segment across a dropped whitespace-only node) gets
  one space back, folded into the neighbouring static literal when there is
  one, otherwise emitted as a `' '` segment. `processText` reports whether it
  stripped each edge; `buildTextRun` carries per-segment pad flags (a dropped
  whitespace-only newline node pads the previous segment) and re-inserts the
  space in one pass over internal boundaries.
- **Control-flow.** `{#if}` (and its `{#unless}` desugaring), `{#for}` and
  `{#case}` break the run without ending the line of prose, so a stripped run
  EDGE that borders one — on either side — is padded the same way.
  `processChildren` tells `buildTextRun` whether the run's left and right
  neighbours are control flow; `buildTextRun` also tracks a leading strip that
  no segment carries (a whitespace-only node dropped before anything else in
  the run). The pad lands outside the block, so it renders whether or not the
  branch does — the same place the space sits in the source.
- Elements, components, markers and `{#svg}` are NOT control flow: the strip
  stands at those edges (see Consequences).
- `{ a }{ b }` and `{#if x}a{/if}{ b }` with nothing between stay adjacent —
  only a stripped edge is padded, so nothing is invented at an element edge.
- A block's own body edges are element boundaries: `{#if x}\n  b\n{/if}` still
  emits `'b'`, and a `{#for}` body's first/last text keeps its strip on every
  iteration.
- Raw (`{#raw}`) segments participate as static segments; a neighbouring
  stripped edge's pad may prepend into the raw literal, byte-identical to a
  separate `' '` segment.
- Compiled across all 657 `.pzl` files in the monorepo (examples, fixtures,
  scaffold templates, the pieces registry), five change:
  `examples/stays/app/views/Listing.pzl` (`' ·'` → `' · '`, three times),
  `examples/music/app/views/Album.pzl` (a leading space after an `{#if}`),
  `examples/chirp/app/layouts/MainLayout.pzl` (`'🔔'` → `'🔔 '`, twice, before
  an `{#if}` unread badge — inert at a flex-item line end),
  and the todos filter buttons in `examples/todos` + the scaffold template
  (`'All'` → `'All '` before an absolutely-positioned underline). The
  hand-written golden `tests/fixtures/todos/Home.compiled.js` carries those
  three button labels.

Pinned by `compiler/internal/codegen/text_run_space_test.go`
(`TestTextRunInternalNewlineKeepsOneSpace`,
`TestTextRunControlFlowBoundaryKeepsOneSpace`).

## Alternatives

- **Vue-style condense** (a text node with content keeps a single leading /
  trailing space regardless of newlines) — also fixes the element-boundary
  case below, but changes output for every indented block-level text in every
  template, churns goldens and bundle bytes right before a release. Rejected
  for 0.7.0; run-internal plus control-flow boundaries is the narrowest change
  that makes prose templates render as authored.
- **Stop at the text run and document the limit** — telling authors to keep a
  conditional word on the same line. Rejected: text followed by a conditional
  word on the next line is ordinary markup, and padding one boundary but not
  the other is harder to explain than either uniform rule.
- **Leave the policy and document it** — rejected: the gluing is silent,
  HTML-surprising, and already visible in a shipped example.

## Consequences

- `<b>{ user.name }</b>\n({ user.email })` still renders "John(j@x)": the text
  node after the element starts a NEW run, and an element boundary is not a
  word boundary. Same for a component, a marker, and `{#svg}`. Documented
  non-goal; write it on one line or accept Vue-style condense as a future
  decision.
- Two control-flow blocks separated only by a newline stay adjacent — the
  whitespace-only node between them is dropped and there is no run to pad.
  Padding it would insert a text vnode between two blocks in every template
  that stacks conditionals, which is the element-boundary churn this decision
  declined.
- A pad before a block renders even when the block does not
  (`'All ' + (cond ? … : nothing)`), because the space is outside the block in
  the source too. Three shipped templates gain such a trailing space before an
  absolutely-positioned decoration; visually inert.
- `<pre>a { x }\nb</pre>` gains the space (`'a ' + x + ' b'`). `<pre>` already
  lost its newlines under the policy — there is no `<pre>` special case — so
  this is a step toward correctness, not a regression.
- Emitted output changes for existing templates that wrapped a text run across
  lines, or that put text on the line above or below a control-flow block; each
  such change is a visible-text fix or an inert trailing space.
