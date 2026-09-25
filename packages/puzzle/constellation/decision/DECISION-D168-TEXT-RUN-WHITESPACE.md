---
name: >-
  D168 — Template whitespace: one merged rule for both hosts (one space at text boundaries, dropped
  between elements, <pre>/<textarea> preserved)
status: built
connections:
  - COMPONENT-CODEGEN
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - FILE-CODEGEN
  - DOC-LANGUAGE-CORE
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
notes:
  - kind: decision
    sha: 513d834
    text: >-
      Control-flow boundaries are padded (0.7.0 final review). `processChildren` classifies each
      run's neighbours (`isControlFlow` — If, For, Case only) and passes `leftBlock`/`rightBlock`
      into `buildTextRun`, which also tracks a leading strip carried by no segment (a
      whitespace-only node dropped before anything else in the run). The other way out — document
      the limit and tell authors to keep the conditional on the same line — was rejected. A
      whitespace-only gap between two blocks stays dropped (no run to pad; padding it would add a
      text vnode wherever conditionals stack). Incremental corpus check over the run-internal rule:
      4 of 657 `.pzl` files move (music, chirp, todos, scaffold todos), and the hand-written golden
      `tests/fixtures/todos/Home.compiled.js` gains a trailing space in three button labels — the
      first time a D168 change moved a golden.
---

# D168 — Template whitespace: one merged rule for both hosts

How source whitespace in a template becomes rendered text. The rule is core
([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]): PuzzleKit and Sites apply the
same rule, as decided for V10 on [[DECISION-D173-CORE-SEMANTICS]]. In short:
whitespace collapses to one space, and newline-bearing whitespace (source
indentation) is dropped only at a parent's edges and between two non-text
siblings. Prose that wraps across lines renders the way HTML renders it.

## Context

Source templates are indented, and indentation must not reach the page as
stray spaces. But prose also wraps across lines, around interpolations,
inline elements and conditionals, and a browser renders each of those line
breaks as a space. A rule that strips too much glues words together; one that
strips too little puts gaps between inline-block siblings such as buttons and
badges.

Before the rule was unified, the two hosts each got one half wrong.
PuzzleKit stripped newline-bearing whitespace at every element edge, so
`tokens —` + newline + `<code>a</code>,` + newline + `<code>b</code>` +
newline + `and more` rendered `tokens —a,band more` (the puzzle-pieces demo's
Theming page is written exactly this way), and it collapsed `<pre>` bodies.
Sites kept whitespace between inline siblings, so indentation became gaps
between buttons, and dropped the gap between an interpolation and a following
`{#if}`, gluing a word to a conditional word.

## Decision

1. **Whitespace with no newline collapses to one space.**
2. **Newline-bearing whitespace at a parent's first- or last-child edge is
   dropped.** It is indentation. A control block's own body edges count as
   parent edges: `{#if x}` + newline + `b` + newline + `{/if}` emits `b`,
   and a `{#for}` body's first and last text keep this strip on every
   iteration.
3. **Newline-bearing whitespace between two non-text siblings is dropped.**
   Non-text siblings are elements, components, markers, `{#svg}` and control
   blocks (`{#if}`, `{#unless}`, `{#for}`, `{#case}`). Stacked buttons, and
   stacked conditionals, get no gap from indentation.
4. **Between text or an interpolation and an element, in either order,
   newline-bearing whitespace collapses to one space.** "Element" here is the
   same set as in rule 3 minus control blocks: elements, components, markers
   and `{#svg}`. So `<b>{ user.name }</b>` + newline + `({ user.email })`
   renders `John (j@x)`.
5. **Between text or an interpolation and a control block, it keeps one
   space.** The space lands outside the block, where it sits in the source,
   so it renders whether or not the branch does.
6. **`<pre>` and `<textarea>` bodies are preserved exactly**: no collapse and
   no strip, interpolations included.

Inside a run of text and interpolations, a newline between two members is
one space (rules 1 and 4 together): `{ user.first }` + newline +
`{ user.last }` renders `John Doe`. Nothing is invented where the source had
no whitespace: `{ a }{ b }` and `{#if x}a{/if}{ b }` stay adjacent. Text
inside `{#raw}` participates as static text, and a neighbour's space may be
folded into its literal.

**How PuzzleKit implements it** (`compiler/internal/codegen/codegen.go`).
`processText` collapses a text node and reports whether it stripped each
edge. `buildTextRun` coalesces adjacent text and interpolation siblings into
one text vnode and puts one space back at each stripped edge that borders
another run member, folding it into a neighbouring static literal when there
is one, otherwise emitting a `' '` segment; a dropped whitespace-only newline
node pads the previous segment. `processChildren` tells `buildTextRun` what
the run's left and right neighbours are (`isControlFlow` for rule 5, and an
element neighbour for rule 4), and `buildTextRun` tracks a leading strip that
no segment carries (a whitespace-only node dropped before anything else in
the run). Pinned by `compiler/internal/codegen/text_run_space_test.go`
(`TestTextRunInternalNewlineKeepsOneSpace`,
`TestTextRunControlFlowBoundaryKeepsOneSpace`).

## Build state

- **PuzzleKit** implements rules 1, 2, 3 and 5 and the run-internal space.
  Rule 4 (it still strips at element edges) and rule 6 (it still collapses
  `<pre>`/`<textarea>`) are build group (c) on D173.
- **Sites** implements rules 1, 2, 4 and 6. Rule 3 (it keeps gaps between
  inline siblings) and rule 5 (it drops the interpolation-to-block gap) are
  on D173's Sites list.

## Alternatives rejected


- **PuzzleKit's old rule for both hosts** (strip at every element edge): it
  keeps the glued prose, and authors would have to write `{ ' ' }` wherever a
  line wraps at an inline element.
- **Sites' old rule for both hosts** (strip only at parent edges): it brings
  back the gaps that indentation puts between inline-block siblings.
- **Vue's `condense` mode wholesale.** At element boundaries it matches rules
  3 and 4, but it keeps a leading or trailing space on text at a parent's
  edge, which rule 2 drops as indentation, and it has no control-block or
  `<pre>` handling of its own to borrow.
- **Document the limit and tell authors to keep a conditional word or an
  inline element on the same line.** Text that wraps before a conditional or
  an inline element is ordinary markup, and the gluing is silent.
- **Pad between two stacked control blocks.** It would insert a text vnode
  between every pair of stacked conditionals for a gap nobody wants.

## Consequences

- Rule 4 changes PuzzleKit output widely: about 965 line breaks between text
  and an inline element, in 119 files (mostly puzzle-pieces demo prose), gain
  the space they were missing, plus 7 in the PuzzleKit apps in the Sites
  repo. Each is a visible-text fix or an inert space next to a block-level
  element.
- Rule 6 changes the 9 PuzzleKit files (and 6 PK-app files) with `<pre>` or
  `<textarea>`: their bodies keep their newlines and indentation.
- Sites loses 29 inline-sibling gaps in 14 files (rule 3) and gains 30
  interpolation-to-block spaces in 19 files (rule 5).
- A space before a block renders even when the block does not (`'All ' +
  (cond ? … : nothing)`); the todos filter buttons carry such a trailing
  space before an absolutely-positioned underline, which is inert.
- `puzzle-prettier` must reflow text by this rule: a line break between text
  and an inline element is now a space, and `<pre>`/`<textarea>` bodies are
  whitespace-sensitive.
