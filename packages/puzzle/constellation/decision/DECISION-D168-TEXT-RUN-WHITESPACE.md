---
name: 'D168 — text-run whitespace: one space at run-internal boundaries'
status: built
connections:
  - COMPONENT-CODEGEN
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - FILE-CODEGEN
notes:
  - kind: gotcha
    text: >-
      The restored space stops at the text run, so a control-flow boundary still eats it — a known
      limit, decision pending. `{#if}`/`{#for}`/`{#case}` nodes break the coalesced run, so a
      stripped edge that borders one is a RUN EDGE and keeps the strip. `<p>\n  you have {n} new\n 
      {#if x}message{/if}\n</p>` still compiles to `'new'` followed by the conditional and renders
      "newmessage" — the same class of bug D168 set out to fix, one node type over. Confirmed by
      compiling the case, not inferred. This is not a regression (both halves were wrong before
      D168), but D168 made the behavior INCONSISTENT: `{a}\n{b}` now gets its space and
      `{a}\n{#if}…{/if}` does not, which is harder to explain than the old uniform strip. Two ways
      out when it is worth deciding: extend the pad so a stripped edge adjacent to a control-flow
      sibling also restores one space (needs processChildren to carry the pad across the run break,
      and would move goldens), or document the limit and tell authors to put the conditional on the
      same line. Real-world reachable — text followed by a conditional word on the next line is
      ordinary markup.
    sha: b821e2c
---

# D168 — text-run whitespace: one space at run-internal boundaries

A line break between a word and `{ expr }`, or between two interpolations,
renders as one space — as it does in HTML, Vue and Svelte. Element-boundary
indentation is still dropped. Found and fixed in the 0.7.0 final review
(2026-09-06).

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
shipped as "4 guests ·2 bedrooms ·2 beds ·1 bath". A browser collapses that
newline to a single space; Vue's default `condense` and Svelte keep it too.
No user-facing card documented the policy, so an author had nothing to
consult.

## Decision

The strip is an **element-boundary** rule and applies only at the edges of a
coalesced text run. Inside one run, a stripped edge that borders another run
member — an interpolation, or a text segment across a dropped whitespace-only
newline node — gets exactly one space back, folded into the neighbouring
static literal when there is one, otherwise emitted as a `' '` segment.
`processText` reports whether it stripped each edge; `buildTextRun` carries
per-segment pad flags (a dropped whitespace-only newline node pads the
previous segment, which is naturally a no-op at the run's leading edge) and
re-inserts the space in one pass over internal boundaries.

- `{ a }{ b }` with nothing between stays adjacent.
- Run edges keep today's strip, so `<li>\n  { item }\n</li>` emits no padding
  and every golden file is byte-identical.
- Raw (`{#raw}`) segments participate as static segments; a neighbouring
  stripped edge's pad may prepend into the raw literal, byte-identical to a
  separate `' '` segment.
- Compiled across all 581 `.pzl` files in the repo (examples, fixtures,
  scaffold templates, the pieces registry), only
  `examples/stays/app/views/Listing.pzl` changes (`' ·'` → `' · '`, three
  times).

Pinned by `compiler/internal/codegen/text_run_space_test.go`.

## Alternatives

- **Vue-style condense** (a text node with content keeps a single leading /
  trailing space regardless of newlines) — also fixes the element-boundary
  case below, but changes output for every indented block-level text in every
  template, churns goldens and bundle bytes right before a release. Rejected
  for 0.7.0; the run-internal rule is the narrowest change that makes prose
  templates render as authored.
- **Leave the policy and document it** — rejected: the gluing is silent,
  HTML-surprising, and already visible in a shipped example.

## Consequences

- `<b>{ user.name }</b>\n({ user.email })` still renders "John(j@x)": the text
  node after the element starts a NEW run, so its leading strip is the
  element-boundary rule. Documented non-goal; write it on one line or accept
  Vue-style condense as a future decision.
- `<pre>a { x }\nb</pre>` gains the space (`'a ' + x + ' b'`). `<pre>` already
  lost its newlines under the policy — there is no `<pre>` special case — so
  this is a step toward correctness, not a regression.
- Emitted output changes for existing templates that wrapped a text run across
  lines; each such change is a visible-text fix.
