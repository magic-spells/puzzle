# @magic-spells/prettier-plugin-puzzle

A [Prettier 3](https://prettier.io) plugin for [Puzzle Framework](https://github.com/magic-spells/puzzle) `.pzl` single-file components.

## What it does

A `.pzl` file is made of up to four top-level sections — `<puzzle-view>` (required), `<puzzle-skeleton>`, `<script>`, and `<style>`. This plugin reprints the code you'd expect a formatter to own:

- **`<script>` body** — formatted with Prettier's JavaScript formatter (`babel` parser), or its TypeScript formatter (`typescript` parser) when the section is `<script lang="ts">`.
- **`<style>` body** — formatted with Prettier's CSS formatter (`css` parser). `<style scoped>` is handled the same way.

Both bodies honor your Prettier options (`singleQuote`, `useTabs`, `tabWidth`, `printWidth`, `semi`, …), because the plugin formats them through Prettier's own sub-formatting pipeline.

## What it preserves verbatim (for now)

Template reformatting is **deliberately deferred to a future version.** In this v1 release the following are preserved **byte-for-byte**:

- `<puzzle-view>` and `<puzzle-skeleton>` template bodies
- every section's opening/closing tags and attributes
- top-level HTML comments and all inter-section whitespace

The only guaranteed changes are: the `<script>` and `<style>` bodies are reformatted, and the file is normalized to end with exactly one trailing newline.

## Usage

Install alongside Prettier 3:

```bash
npm install --save-dev prettier @magic-spells/prettier-plugin-puzzle
```

Add the plugin to your Prettier config (e.g. `.prettierrc`):

```json
{
	"plugins": ["@magic-spells/prettier-plugin-puzzle"]
}
```

Then format as usual:

```bash
npx prettier --write "**/*.pzl"
```

Prettier automatically routes `.pzl` files through this plugin.

## How the splitter works

Reprinting the right bytes requires splitting a `.pzl` file into its sections exactly the way the compiler does. The splitter in `src/split.js` (and its lexical helpers in `src/lex.js`) is a faithful JavaScript port of the compiler's canonical splitter, [`compiler/internal/parser/sections.go`](https://github.com/magic-spells/puzzle), including its language-aware close-tag scans. This means a literal `</script>` inside a JS string, template literal, comment, or regex — or a literal `</style>` inside a CSS comment or string — never truncates a body, and template brace groups / HTML comments inside `<puzzle-view>` are skipped correctly.

Files that fail to split — missing `<puzzle-view>`, a duplicated section, stray top-level content, or an unterminated tag — throw a positioned error (surfaced by Prettier with line/column) rather than silently mangling output.

## License

MIT
