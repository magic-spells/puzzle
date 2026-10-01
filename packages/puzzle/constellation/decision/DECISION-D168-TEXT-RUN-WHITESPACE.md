---
name: 'D168 — Template whitespace: one merged rule for both hosts'
status: built
connections:
  - COMPONENT-CODEGEN
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - FILE-CODEGEN
  - DOC-LANGUAGE-CORE
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
---

# D168 — Template whitespace: one merged rule for both hosts

How source whitespace becomes rendered text. The rule is core
([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]], V10 on
[[DECISION-D173-CORE-SEMANTICS]]): whitespace collapses to one space, and
newline-bearing whitespace (indentation) is dropped only at a parent's edges and
between two non-text siblings, so wrapped prose renders the way HTML renders it.

## Context

Indentation must not reach the page as stray spaces, but prose wraps across
lines around interpolations, inline elements and conditionals, and a browser
renders each of those breaks as a space. Stripping too much glues words
(`tokens —a,band more`); stripping too little puts gaps between inline-block
siblings such as buttons.

## Decision

1. **Whitespace with no newline collapses to one space.**
2. **Newline-bearing whitespace at a parent's first/last-child edge is
   dropped.** A parent is an element, a component's children, a marker's
   fallback body, a snippet body, or a control block's own body (a `{#for}`
   body's edges strip on every iteration).
3. **Newline-bearing whitespace between two non-text siblings is dropped.**
   Non-text: elements, components, markers, `<Portal>`, `<Snippet>`, `{#svg}`
   and control blocks (`{#if}`, `{#unless}`, `{#for}`, `{#case}`). A
   whitespace-only gap between two stacked blocks stays dropped.
4. **Between text/interpolation and an element (either order),
   newline-bearing whitespace becomes one space.** "Element" = rule 3's set
   minus control blocks. Punctuation that must touch an element goes on the
   element's line: `(<code>x</code>)`, not `(` + newline + `<code>x</code>` +
   newline + `)`, which renders `( x )` as the same HTML does.
5. **Between text/interpolation and a control block, one space is kept**,
   outside the block, so it renders whether or not the branch does.
6. **`<pre>` and `<textarea>` bodies are preserved exactly** — every
   descendant and interpolation included — except that a single newline
   directly after the start tag is dropped, as HTML's parser does.

Inside a run of text and interpolations a newline is one space
(`{ a }`↵`{ b }` → `a b`). Nothing is invented where the source had no
whitespace: `{ a }{ b }`, `<b>x</b>{ y }`, `{#if x}a{/if}{ b }` stay adjacent.
Edges of rule 6: a `{#raw}` body keeps its bytes (`<pre>{#raw}`↵ keeps that
newline); a `{#for}` body inside `<pre>` still applies rules 2–3 (a loop body
is one root element); CRLF and lone CR in preserved or `{#raw}` bodies
normalize to LF, as HTML's input stream does.

**PuzzleKit implementation** (`compiler/internal/codegen/codegen.go`):
`processText` collapses and reports stripped edges; `buildTextRun` coalesces
a run into one text vnode and re-pads stripped edges that border another run
member, told by `processChildren` whether each edge borders a sibling
(`leftSibling`/`rightSibling`) or the parent edge. Rule 6 is the `preserveWS`
flag raised by `emitElement` and `staticcache.go` for `pre`/`textarea`;
`preservedBody` drops the leading newline; `forBodyRoot` clears the flag for a
loop body. The SSG serializer (`client-runtime/ssg/serialize.js`) emits one
extra newline when a `pre`/`textarea`/`listing` body starts with one, so
prerendered and mounted text match. Pinned by
`codegen/text_run_space_test.go`, the serializer suite, and the V10 case in
`tests/core-semantics.test.js`.

**Sites** implements rules 1, 2, 4 and 6; rules 3 and 5 and its `<pre>`
first-newline check are on D173's Sites list.

## Alternatives

- **Strip at every element edge** — glues wrapped prose; authors would write
  `{ ' ' }` at every inline wrap.
- **Strip only at parent edges** — indentation becomes gaps between
  inline-block siblings.
- **Vue's `condense` mode** — keeps a space at a parent's edge (rule 2 drops
  it) and has no control-block or `<pre>` handling.
- **Tell authors to keep conditionals/inline elements on one line** — the
  gluing is silent and the markup is ordinary.
- **Pad between stacked control blocks** — a text vnode between every pair of
  conditionals for a gap nobody wants.
- **Keep `<pre>`'s first newline** — mounted text would disagree with the
  browser and the prerendered page.
- **Preserve only `<pre>`'s own text children** — `<pre><code>` is the common
  shape and `white-space: pre` covers descendants.

## Consequences

- A space before a block renders even when the block does not.
- An indented `<pre>`/`<textarea>` body renders its indentation.
- `puzzle-prettier` preserves template bodies byte for byte (pinned by a
  test); any future template formatter must keep every line break next to text
  and leave `<pre>`/`<textarea>` bodies alone.
