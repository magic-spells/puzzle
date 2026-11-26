---
name: Template formatting and linting in the Prettier and ESLint plugins
status: planned
change: feature
connections:
  - DECISION-D168-TEXT-RUN-WHITESPACE
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D176-EXPRESSION-LANGUAGE
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-PLAYGROUND-COMPILER
  - FILE-PZL-WASM
---

# Template formatting and linting in the Prettier and ESLint plugins

`@magic-spells/prettier-plugin-puzzle` formats the `<script>` and `<style>` bodies of a `.pzl` file and leaves the `<puzzle-view>` template untouched. `@magic-spells/eslint-plugin-puzzle` lints the same two bodies. Vue, Svelte and JSX tooling format and lint the template too, and people coming from them expect format-on-save to tidy their markup. This feature makes both plugins work on the template.

Not started. It is planned for a release after 0.10.0.

## Scope

- In: a template formatter in the Prettier plugin; a template parse tree both plugins can read; template lint rules in the ESLint plugin, starting with accessibility and unused `{#for}` variables.
- Out: reordering sections; formatting static attribute values (only `class` whitespace may be collapsed); anything the compiler already reports as an error.

## The whitespace rule decides what a formatter may change

The rule is [[DECISION-D168-TEXT-RUN-WHITESPACE]]. It depends only on the kind of node on each side of a gap, never on whether a tag is inline or block. "Text-like" is text or an ordinary `{ expr }`. "Non-text" is an element, component, marker, `<Portal>`, `<Snippet>`, `{#svg}`, a markup interpolation such as `{ raw(x) }`, or a control block.

| Gap | A line break renders as | Spaces only render as |
|---|---|---|
| Inside text, or between text-like and anything | one space | one space |
| Between two non-text siblings | nothing | one space |
| Start or end of any children list or block branch | nothing | one space |
| Start or end of a `{#for}` body | nothing | a compile error |
| Inside a tag, inside `{ }`, inside a block header | nothing | nothing |
| `<pre>`, `<textarea>`, `{#raw}` bodies, attribute values | kept as written | kept as written |

So a formatter may:

- re-indent any whitespace run that already holds a line break;
- add or remove a line break between two non-text siblings, and at the start or end of a children list, when the gap is empty or already holds a line break;
- lay out attributes inside a tag freely, and pad `{ x }`;
- swap a space for a line break inside text and between text and its neighbours.

It must never:

- add whitespace where text touches its neighbour with none, or remove the only whitespace there;
- turn a space-only gap between two non-text siblings, or at a children-list edge, into a line break (that removes a rendered space);
- touch `<pre>`, `<textarea>` or `{#raw}` bodies, or the bytes of an attribute value;
- touch the whitespace beside a comment that sits in a text run: a comment splits the run in two and the two sides do not merge;
- treat `&nbsp;` or a non-breaking space as whitespace.

## Parser route (not yet decided)

A formatter needs where every tag and block ends, the comments, and the quote each attribute used. Neither source has that today: the parser's tree keeps start positions only and drops comments ([[COMPONENT-TEMPLATE-PARSER]]), and the WebAssembly build returns compiled output, not a tree ([[FILE-PZL-WASM]], [[COMPONENT-PLAYGROUND-COMPILER]]).

- **Recommended: the Go parser produces a full-fidelity tree and the plugins read it through WebAssembly.** One parser, so the plugins cannot disagree with the compiler. It can replace the JavaScript copies of the section splitter and lexer both plugins carry. The parser already knows both dialects ([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]), so Sites files become formattable. Cost: about 5 MB (1.0 to 1.4 MB compressed) added to each plugin, and a change to the language module. It loads synchronously in Node, which ESLint requires: start about 35 ms, then under 1 ms per file.
- **Alternative: a JavaScript template parser inside the plugin.** Small plugins and no change to the Go module. It is one more copy of the grammar to keep in step by hand, and no shared tests exist for a template parser.

## Expressions

Prettier's JavaScript expression parser formats PuzzleKit template expressions without changing their meaning ([[DECISION-D176-EXPRESSION-LANGUAGE]]). These are not JavaScript and the formatter splits them itself before any part reaches Prettier: `{#for x in xs, i}`, `a...b` ranges, `{:when a, b}`, `{#svg 'path'}`, `{...spread}`, `{#let}`. Sites pipes (`x | f`) must be printed as written: Prettier reads `|` as bitwise OR and removes parentheses the Sites parser needs.

Reprinting an expression changes the spelling of literals (quotes, `.5` to `0.5`) and the dev-only source label in compiled code. Both are harmless, and the test below has to allow for them.

## Build order

1. The parse tree, by the route chosen above, with a test that it covers every construct the parser accepts.
2. Formatter, first version: indentation, attribute layout (honouring `bracketSameLine` and `singleAttributePerLine`), one non-text sibling per line where the rule allows, block tags on their own lines with `{:else}` aligned where the rule allows, `{ }` padding and expression formatting. Text runs and the whitespace touching them, comments, and raw regions are printed as written. `<!-- prettier-ignore -->` skips the next node.
3. Formatter, second version: re-wrap long text at the safe points.
4. ESLint template rules.

Design notes that avoid known problems in other formatters: work out the whitespace facts in one pass before printing, and keep the printer free of side effects; a block tag that touches text with no whitespace stays where it is; format `{#for}` bindings by handing them to Prettier as function parameters; when an expression fails to format, print it as written.

## Acceptance

- Every template in `packages/puzzle/examples` and `packages/puzzle-pieces/registry` compiles to the same render functions before and after formatting. This check is the main safety net: no other template formatter tests rendered output.
- Formatting a formatted file changes nothing.
- A file the parser rejects is left untouched and the error is reported.
- Comments survive byte for byte. The compile check cannot see comments, so this needs its own test.
