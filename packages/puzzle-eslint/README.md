# @magic-spells/eslint-plugin-puzzle

ESLint plugin for [Puzzle Framework](https://github.com/magic-spells/puzzle)
`.pzl` single-file components. It lets your existing ESLint rules lint the
`<script>` body of a `.pzl` file as real JavaScript / TypeScript and, once you
configure a CSS language, the `<style>` body as CSS, and it validates the
file's section structure.

ESLint **>= 9, flat config only**.

## What it does

A `.pzl` file is not JavaScript. It is up to four top-level sections in any
order — `<puzzle-view>` (required), `<puzzle-skeleton>`, `<script>`, and
`<style>`. The `<script>` body is real code (JS, or TS with `lang="ts"`) and
the `<style>` body is real CSS, byte-for-byte.

This plugin is a **processor**, not a new parser:

- It extracts the `<script>` body into one virtual JS or TS file and hands it
  to ESLint, so every rule you already run — and any parser you layer on —
  applies to it unchanged. ESLint prefixes each block's name with its index,
  so match it with the glob `*.pzl/*_scripts.js` (or `.ts`). The `<style>`
  body becomes a second virtual file, `*.pzl/*_styles.css`, which ESLint
  lints only once you configure CSS ([below](#css-style)).
- Each virtual file is the original source up to the end of its body, with
  everything before the body blanked to spaces (newlines preserved), so
  reported line/column positions **and autofix ranges** land exactly on the
  real file. Autofixes only ever touch bytes inside the body: whitespace
  rules see the blanked lead-in as blank lines and trailing spaces, so a
  message whose fix would reach into it is dropped.
- It validates section structure and reports problems (missing `<puzzle-view>`,
  duplicate sections, illegal section attributes, a `<script>`/`<style>` body
  truncated by a stray close tag, stray top-level content) as ESLint messages
  under the rule id `puzzle/no-invalid-sections`.

The section splitter is a direct port of the Puzzle language module's
`packages/puzzle-lang/parser/sections.go` (and its `lexskip.go` / `scan.go`
helpers), so it carves sections and finds close tags exactly the way the real
compiler does — a literal `</script>` inside a string, template literal,
comment, or regex will **not** truncate the body.

## Install

Needs Node 24 or later.

```sh
npm install --save-dev @magic-spells/eslint-plugin-puzzle eslint @eslint/js globals
```

## Usage (flat config)

The `recommended` config wires up the processor and turns on
`puzzle/uses-template-components` — you still bring your own JavaScript rules.
A typical `eslint.config.js`:

```js
import js from '@eslint/js';
import globals from 'globals';
import puzzle from '@magic-spells/eslint-plugin-puzzle';

export default [
  // Build output and the CLI's scratch folder are not source.
  { ignores: ['dist/', '.puzzle/'] },

  // Your normal JS config. Because it is not restricted with `files`, it also
  // applies to the virtual `*.pzl/*_scripts.js` files the processor emits.
  js.configs.recommended,

  // A Puzzle app runs in the browser: `document`, `window`, `setTimeout`.
  { languageOptions: { globals: globals.browser } },

  // Wire the Puzzle processor onto every .pzl file and mark components
  // rendered as template tags as used.
  ...puzzle.configs.recommended,

  // Any extra rules you want on the <script> body:
  {
    files: ['**/*.pzl/*_scripts.js'],
    rules: {
      semi: ['error', 'always'],
    },
  },
];
```

Target the extracted block with `**/*.pzl/*_scripts.js` (or
`**/*.pzl/*_scripts.{js,ts}` alongside a TS parser entry). A `**/*.pzl`
pattern matches only the outer file, never the extracted `<script>` block, so
rules scoped to it never reach your code.

### Components used as template tags

An import the `<script>` body only uses as a template tag
(`import Card from './Card.pzl'` rendered as `<Card>`) is a real use, so
`recommended` enables `puzzle/uses-template-components`, which marks every
component tag in `<puzzle-view>` and `<puzzle-skeleton>` as used and never
reports anything itself. A component tag is
any tag whose name does not start with an ASCII lowercase letter (`<Card>`,
`<Élan>`, `<_Row>`); a family tag (`<Frame.Header>`) marks its root, `Frame`.
Only markup counts: a tag written inside an HTML or template comment, a
`{#raw}` block, an attribute value or a string in `{ … }` is not a use.
Ordinary template expressions (`{ title }`) read view data, never `<script>` bindings,
so a `const` referenced only inside `{ … }` is still reported as unused.
The `is` selector on the built-in `<Component>` is the exception: it may read
module bindings, so selector-only imports and indexed maps (`is={cards[key]}`)
are marked as used. Loop items and `<Snippet>` parameters still shadow those
bindings. Every other attribute, including `name` and `from`, reads ordinary
view data. `<Component>` itself, including a reserved `Component` family root,
does not count as a use of an import named `Component`.

### TypeScript (`<script lang="ts">`)

typescript-eslint does not support TypeScript 7 yet (as of 8.73, November
2026): its peer range ends below 6.1. In a `puzzle init --typescript` app,
which installs TypeScript 7, `npm install typescript-eslint` fails with
`ERESOLVE`, and a forced install throws "typescript-eslint does not support
TS 7.0" when the config loads. Until a release supports TypeScript 7, the
setups below cannot run in a Puzzle TypeScript app.

A TypeScript block reaches ESLint as `*.pzl/*_scripts.ts` (ESLint prefixes
each block's name with its index). `recommended` covers only the JS blocks,
because a TS block needs a TS parser: without one, ESLint would parse it as
JavaScript and stop with a fatal error, so `recommended` leaves TS blocks
unlinted. Add `puzzle.configs.typescript` after your TypeScript config to lint
them with the same setup the JS blocks get (`puzzle/uses-template-components`
on):

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import puzzle from '@magic-spells/eslint-plugin-puzzle';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...puzzle.configs.recommended,
  puzzle.configs.typescript,
];
```

`puzzle.configs.typescript` is a single entry (no spread) for
`**/*.pzl/*_scripts.ts`, and it sets **no parser**: it relies on the config
before it to parse those files as TypeScript, which
`tseslint.configs.recommended` does for every file. If you wire the parser
yourself instead, put a parser entry before it:

```js
export default [
  ...puzzle.configs.recommended,
  {
    files: ['**/*.pzl/*_scripts.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // your TS rules
    },
  },
  puzzle.configs.typescript,
];
```

### CSS (`<style>`)

The `<style>` body, plain or `scoped`, reaches ESLint as `*.pzl/*_styles.css`.
ESLint lints it only when a config's `files` matches it, so nothing changes
until you add a CSS language. With [`@eslint/css`](https://github.com/eslint/css)
(ESLint 9.15 or later):

```sh
npm install --save-dev @eslint/css tailwind-csstree
```

```js
import js from '@eslint/js';
import css from '@eslint/css';
import globals from 'globals';
import { tailwind4 } from 'tailwind-csstree';
import puzzle from '@magic-spells/eslint-plugin-puzzle';

export default [
  { ignores: ['dist/', '.puzzle/'] },

  // Scoped to JS: an entry with no `files` also reaches the CSS, and the JS
  // rules crash on it. `**/*.js` still matches the `<script>` blocks.
  { files: ['**/*.js'], ...js.configs.recommended },
  { languageOptions: { globals: globals.browser } },

  ...puzzle.configs.recommended,

  // Your .css files and every .pzl <style> body.
  { files: ['**/*.css'], language: 'css/css', ...css.configs.recommended },
  // Each <style> body is linted alone, so a custom property it reads from a
  // theme or another stylesheet is unknown to it.
  { files: ['**/*.css'], rules: { 'css/no-invalid-properties': ['error', { allowUnknownVariables: true }] } },
  // Tailwind syntax (`@theme`) in app/styles, the stylesheet Tailwind compiles.
  { files: ['app/styles/**/*.css'], languageOptions: { customSyntax: tailwind4 } },
];
```

Reports and autofixes land on the `.pzl` file's own lines and touch only the
`<style>` body.

A `<style>` block is plain CSS, never run through Tailwind: `@apply` and
`@theme` are not processed there, and `css/no-invalid-at-rules` reports them.
Your `@theme` tokens reach it as CSS variables (`var(--color-accent)`).

## Scope and limits

- **`<style>` is linted only through a CSS language you configure**; see
  [CSS (`<style>`)](#css-style).
- **Template linting (`<puzzle-view>` / `<puzzle-skeleton>` markup) is future
  work.** This plugin lints the `<script>` and `<style>` bodies and validates
  section structure only; it does not lint the Puzzle template grammar. Every template
  construct splits correctly and passes through unjudged: dotted family tags
  (`<Frame.Header>`), the `\{` / `\}` brace escape, the `{#for}` range
  spellings, and every template expression (D176) — function calls
  (`title={ truncate(name.trim(), 20) }`), object-literal arguments
  (`{ t('cart.count', { count: items.length }) }`), arrow-function arguments
  (`{#for t in todos.filter(t => !t.done)}`), and template literals, including
  a `}` or `</puzzle-view>` inside one.
- **Template-language errors are the compiler's to report.** A template
  expression is a closed JavaScript-shaped grammar (D176): a method outside the
  method table (`items.sort()`), `this`, `new`, a bitwise operator such as `|`,
  a misplaced `raw()`, or a component name like `<Frame-x>` or `<Slot.Foo>` is
  a positioned `puzzle build` error. None of them produce an ESLint message
  here, and none of them stop the `<script>` body from being linted.
- `@event` handler values (`@click={ save(item.id) }`) are template
  expressions too; they live in template bytes, so ESLint does not see them.
- A `.pzl` file with no `<script>` section produces no JS blocks (but section
  errors are still reported).
- Format `.pzl` files with `@magic-spells/prettier-plugin-puzzle`, run as its
  own step (`npx prettier --check .`). With that plugin in your Prettier
  config, `eslint-plugin-prettier` picks Prettier's parser from the `.pzl`
  filename, hands the Puzzle parser the extracted block, and ESLint crashes
  with `PzlSyntaxError: missing <puzzle-view> section`. Keep it off the `.pzl`
  blocks: after its config, add
  `{ files: ['**/*.pzl/**'], rules: { 'prettier/prettier': 'off' } }`.
- **Section-error columns count UTF-16 code units.** The compiler's splitter
  counts UTF-8 bytes, so on a line holding non-ASCII text (`café`, `金額`, an
  emoji) a section error from this plugin and the same error from
  `puzzle build` name the same line but different columns. Both only occur on
  a file that already fails to compile.

## License

MIT
