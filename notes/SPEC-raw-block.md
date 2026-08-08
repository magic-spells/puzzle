# `{#raw} … {/raw}` — a lex-off block

Status: proposed. Implements the one gap left by D70 (`{#comment}`) and the
`escape`/`raw`/`noescape` formatters: a way to put **braces in template text**
without the scanner treating them as grammar.

## Why

A JSON payload in markup is the motivating case and it currently cannot compile:

```html
<script type="application/json" data-tarot-options>
  { "loop": true, "slidesPerView": 3 }
</script>
```

The scanner consumes `{ "loop": true` as an interpolation and hands it to the
expression compiler, which fails:

```
✘ [ERROR] Expected ")" but found ":"
   ...ViewNode('text', { value: __s("loop": true, ...
```

There is no workaround in the grammar today. `{#comment}` skips lexing but
discards the body. `{#svg}` skips lexing but only accepts an SVG file from
`app/assets/`. `island` changes diffing, not lexing — the seed still parses with
the full grammar. The `escape` / `raw` / `noescape` formatters operate at render
time on a *value*, which is far too late: the failure is in the lexer.

Consumers currently work around it by seeding options through a
`<div hidden data-tarot-options>` whose textContent is JSON built in `data()` —
adjacent to the documented usage of every library that reads a JSON options
block, and not obvious.

## Semantics

**`{#raw}` disables the template lexer for its body. That is the whole feature.**

Everything else about the body is ordinary HTML. Concretely, inside a raw block:

- `{ … }` is literal text, not an interpolation.
- `{#if}`, `{#for}`, `{#comment}`, `{:else}`, `{/…}` are literal text, not blocks.
- `@click={ … }` is a literal attribute, not an event binding.
- `|` is a pipe character, not a formatter separator.
- **HTML still works.** `{#raw}<b>hi</b>{/raw}` renders a real `<b>` element.
  HTML was never what was being disabled.

**No nesting.** The body is never parsed, so there is nothing to nest. The block
ends at the FIRST `{/raw}`. A literal `{/raw}` cannot appear in a body — same
constraint as `</script>` inside a script element, and acceptable for the same
reason.

**Not an HTML-injection primitive.** A raw body is static, author-written source
text; interpolation is off inside it, so no runtime value can reach it. It is
exactly equivalent to typing that markup directly into the template. This does
NOT unblock the deferred dynamic raw-HTML syntax (`{@html expr}`), which remains
deferred for the usual reasons.

## Surface

```html
<script type="application/json" data-tarot-options>
  {#raw}{ "loop": true, "slidesPerView": 3 }{/raw}
</script>

<pre>{#raw}const shape = { a: 1, b: [2, 3] };{/raw}</pre>
```

Closer tolerates whitespace like every other block: `{/raw}`, `{/ raw }`,
`{/raw }` all close. Anything after the keyword in the opener (`{#raw json}`) is
ignored, matching `{#comment}`.

## Implementation

`{#comment}` (D70) is the same machinery minus the emit step. All of it lives in
`compiler/internal/parser/scan.go`.

1. **`blockCloseKeywords`** (scan.go:73) — add `"raw": true` alongside
   `if / unless / case / for / svg / comment`.
2. **`isBlockRawOpen`** — mirror `isBlockCommentOpen` (scan.go:130): a `{`
   followed by `#` and the exact keyword `raw`.
3. **`matchRawCloser`** — mirror `matchCommentCloser` (scan.go:143), same
   whitespace tolerance.
4. **`scanBlockRaw`** — mirror `scanBlockComment` (scan.go:174) but WITHOUT the
   depth counter, and return the body span as well as the end index. Unterminated
   is a positioned error at the opener: `unterminated {#raw} — expected {/raw}`.
5. **Parser** — emit the captured span as a text node instead of discarding it.
   This is the only real divergence from `{#comment}`.
6. **Codegen** — the body is a literal string; emit it as the text value. It must
   NOT be run through the expression compiler.

## Open question for the implementer

**Escaping on serialize.** The body reaches the DOM as text. Two paths disagree
and they must be reconciled deliberately:

- Client render sets a text node's value — inherently literal, no escaping needed.
- Prerender serializes to an HTML string, where `<` normally must become `&lt;`.

But the motivating case sits inside `<script>`, an HTML **raw-text element**,
where entities are NOT decoded — escaping there would corrupt the JSON into
literal `&lt;`. Browsers solve this by not escaping inside `script`/`style` and
instead forbidding the closing-tag sequence.

Match that rule: do not entity-escape a raw body inside `script`/`style`; escape
elsewhere. Verify a JSON payload containing `<` round-trips through
`JSON.parse(el.textContent)` in BOTH a `<div>` and a `<script>`, prerendered and
client-rendered. If the codegen cannot see the parent element, say so rather than
guessing — that changes the design.

## Also missing: formatter docs

`escape`, `raw`, and `noescape` ship today (`client-runtime/formatters/builtins.js`,
registered as `requiredBuiltins` in `formatters.js`) but appear nowhere in
`DOC-TEMPLATE-SYNTAX.md`. Document them in the Formatters section. Note that they
are unrelated to `{#raw}` — value-level vs lexer-level — so the docs should say
so explicitly to stop the two being confused.

## Definition of done

- `{#raw}` in the deferred list is replaced by a documented section in
  `DOC-TEMPLATE-SYNTAX.md`, plus the block-tag row in its cheat-sheet table.
- `DOC-SPEC-TEMPLATE.md` gets a numbered section (it is the frozen contract and
  wins on conflict).
- Parser tests covering: JSON body; HTML body renders as elements; `{#if}`/
  `{#comment}` inside a body stay literal; whitespace-tolerant closers;
  unterminated error; attribute-value position is a positioned compile error
  (consistent with `{#comment}`).
- A round-trip test for the escaping question above.
- CHANGELOG entry under the next minor.
