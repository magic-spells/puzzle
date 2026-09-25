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
      Control-flow boundaries are padded (0.7.0 final review; 0.8.0 extends the same padding to
      element siblings, so `processChildren` now passes `leftSibling`/`rightSibling` for any
      non-text neighbour). The other way out — document the limit and tell authors to keep the
      conditional on the same line — was rejected. A whitespace-only gap between two blocks stays
      dropped (no run to pad; padding it would add a text vnode wherever conditionals stack). The
      0.7.0 corpus check over the run-internal rule moved 4 of 657 `.pzl` files (music, chirp,
      todos, scaffold todos), and the hand-written golden `tests/fixtures/todos/Home.compiled.js`
      gained a trailing space in three button labels.
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
   dropped.** It is indentation. A parent is an element, a component's
   children, a marker's fallback body, a snippet body, or a control block's
   own body: `{#if x}` + newline + `b` + newline + `{/if}` emits `b`, and a
   `{#for}` body's first and last text keep this strip on every iteration.
3. **Newline-bearing whitespace between two non-text siblings is dropped.**
   Non-text siblings are elements, components, markers, `<Portal>`,
   `<Snippet>`, `{#svg}` and control blocks (`{#if}`, `{#unless}`, `{#for}`,
   `{#case}`). Stacked buttons, and stacked conditionals, get no gap from
   indentation.
4. **Between text or an interpolation and an element, in either order,
   newline-bearing whitespace collapses to one space.** "Element" here is the
   same set as in rule 3 minus control blocks: elements, components, markers,
   `<Portal>`, `<Snippet>` and `{#svg}`. So `<b>{ user.name }</b>` + newline +
   `({ user.email })` renders `John (j@x)`, and the Theming prose above renders
   `tokens — a, b and more`. Punctuation that must touch an element goes on
   the element's line: `(<code>x</code>)` and `<code>x</code>,`, not `(` +
   newline + `<code>x</code>` + newline + `)`, which renders `( x )` exactly
   as the same HTML does.
5. **Between text or an interpolation and a control block, it keeps one
   space.** The space lands outside the block, where it sits in the source,
   so it renders whether or not the branch does.
6. **`<pre>` and `<textarea>` bodies are preserved exactly**: no collapse and
   no strip, interpolations and descendants included (`<pre><code>` keeps its
   bytes too), with HTML's one exception: a single newline directly after the
   start tag is dropped, as HTML's parser drops it. So `<pre>` + newline +
   `code` + newline + `</pre>` renders `code` plus its trailing newline, the
   same text the same markup shows in a browser.

Inside a run of text and interpolations, a newline between two members is
one space (rules 1 and 4 together): `{ user.first }` + newline +
`{ user.last }` renders `John Doe`. Nothing is invented where the source had
no whitespace: `{ a }{ b }`, `<b>x</b>{ y }` and `{#if x}a{/if}{ b }` stay
adjacent. Text inside `{#raw}` participates as static text, and a neighbour's
space may be folded into its literal.

Three edges of rule 6. A `{#raw}` body keeps its bytes: `<pre>{#raw}` + newline
keeps that newline, because it does not follow the start tag in the source. A
`{#for}` body inside a `<pre>` still drops its own whitespace (rules 2 and 3),
because a loop body is exactly one root element and cannot hold text; the
root's own descendants are preserved. And line endings normalize the way
HTML's input stream normalizes them: CRLF and a lone CR in a preserved or
`{#raw}` body become LF, so a CRLF checkout emits the same bundle and the
mounted text matches the prerendered page.

**How PuzzleKit implements it** (`compiler/internal/codegen/codegen.go`).
`processText` collapses a text node and reports whether it stripped each
edge. `buildTextRun` coalesces adjacent text and interpolation siblings into
one text vnode and puts one space back at each stripped edge that borders
another run member, folding it into a neighbouring static literal when there
is one, otherwise emitting a `' '` segment; a dropped whitespace-only newline
node pads the previous segment. `processChildren` tells `buildTextRun` whether
each run edge borders a sibling node or the parent's edge (rules 4 and 5 pad
the first, rule 2 strips the second), and `buildTextRun` tracks a leading
strip that no segment carries (a whitespace-only node dropped before anything
else in the run). Rule 6 is a compiler flag, `preserveWS`, raised by
`emitElement` and by the static-subtree analysis (`staticcache.go`) for a
`pre` or `textarea` element, under which `buildTextRun` emits every Text node
verbatim apart from `normalizeNewlines`; `preservedBody` drops the one leading
newline (LF, CRLF or CR), and `forBodyRoot` clears the flag for the loop body's
own children list. The SSG serializer (`client-runtime/ssg/serialize.js`) emits
one extra newline when a `pre`, `textarea` or `listing` body starts with a
newline, so the parser eats that one and prerendered text matches the mounted
text. Pinned by `compiler/internal/codegen/text_run_space_test.go`
(`TestTextRunInternalNewlineKeepsOneSpace`,
`TestTextRunControlFlowBoundaryKeepsOneSpace`,
`TestTextElementBoundaryKeepsOneSpace`, `TestPreAndTextareaBodiesPreserved`),
the serializer suite, and the V10 case in `tests/core-semantics.test.js`, which
checks the mounted DOM and the prerendered HTML of one compiled fixture.

## Build state

- **PuzzleKit** implements all six rules (0.8.0; build group (c) on D173).
- **Sites** implements rules 1, 2, 4 and 6. Rule 3 (it keeps gaps between
  inline siblings) and rule 5 (it drops the interpolation-to-block gap) are
  on D173's Sites list, as is checking its `<pre>` first-newline handling
  against rule 6.

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
- **Keep a `<pre>` body's first newline.** The browser runtime would mount a
  blank first line that the same markup never shows, and a prerendered page
  (whose parser drops it) would disagree with the mounted one.
- **Preserve only the `<pre>`'s own text children.** `<pre><code>` is the
  common shape, and `white-space: pre` applies to every descendant, so the
  whole subtree keeps its bytes.

## Consequences

- Rule 4 changes PuzzleKit output widely. Measured on the 0.8.0 corpus (612
  `.pzl` files: examples, scaffold templates, the puzzle-pieces registry and
  demo, and the DevTools panel), 830 text runs in 131 files gain 1,004 spaces
  at text-to-element boundaries (935 of them in 98 puzzle-pieces demo files,
  mostly prose around `<code>`), and no file loses one. Almost all are a
  visible-text fix or an inert space: a leading or trailing space inside a
  flex or grid item (every icon-plus-label pair in the corpus) is removed by
  CSS line layout, and one next to a block-level element does not render.
  Three spots rendered differently and were handled in the same change: the
  pieces demo's Meter page wrote `(`, `)` and `,` on their own lines beside a
  `<code>` (it would have rendered `gauge ( role="meter" ) for` and
  `Progress , which`), so that punctuation moved onto the element's line;
  the DevTools "State layers" heading, whose inline `<span>` already had a
  left margin, drops it from `ml-1.5` to `ml-1` so the gap stays about where
  it was; and the spaced slashes between two `<code>` names in the
  ChatAttachment, Toolbar and DropdownMenu demo pages (`href / removable`)
  now read as written and are kept. The Sites repo's PuzzleKit apps have 7
  more such line breaks.
- Rule 6 changes no file in the corpus: every `<pre>` there holds a single
  interpolation and every `<textarea>` is value-bound. A template that wrote
  an indented `<pre>` or `<textarea>` body now renders that indentation
  (6 PK-app files in the Sites repo have `<pre>` or `<textarea>`).
- Sites loses 29 inline-sibling gaps in 14 files (rule 3) and gains 30
  interpolation-to-block spaces in 19 files (rule 5).
- A space before a block renders even when the block does not (`'All ' +
  (cond ? … : nothing)`); the todos filter buttons carry such a trailing
  space before an absolutely-positioned underline, which is inert.
- `puzzle-prettier` preserves template bodies byte for byte, so it cannot
  change rendered whitespace; a test pins that at several print widths, and
  its README tells any future template formatter to keep every line break
  next to text and to leave `<pre>`/`<textarea>` bodies alone.
