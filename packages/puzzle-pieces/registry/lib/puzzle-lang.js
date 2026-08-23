/**
 * highlight.js grammar for Puzzle templates (`.pzl` markup + docs snippets).
 *
 * The stock `xml` grammar mangles Puzzle syntax: `value={ query }` makes `{` an
 * unterminated string, `@change` loses its `@` (so the sigil sits uncolored next
 * to a half-highlighted attr), and block tags like `{#if}` / `{/for}` come out as
 * plain text. This grammar is xml's tag machinery plus the four things Puzzle
 * templates actually add on top of HTML:
 *
 *   1. `{ expression }` interpolation — in text, in attribute values, and inside
 *      quoted attribute strings (`class="base {#if active}on{/if}"`).
 *   2. Block tags — `{#if}` `{#unless}` `{#case}` `{#for}` `{#svg}` `{:else if}`
 *      `{:when}` `{/if}` … — directive name as a keyword, condition as an expression.
 *   3. Sigil attributes — `@event={ … }` bindings and `:prop` shorthands keep their
 *      sigil and get their own color (see `.hljs-attr.directive_` in the
 *      <style> block of ui/code/Code.pzl).
 *   4. Formatters — the `| formatter(args)` tail inside an interpolation.
 *
 * Plus two escapes back into JavaScript, because docs snippets are usually mixed:
 *   - a `<script>` block (full-file `.pzl` snippets) highlights as JS;
 *   - a JS tail — the common "markup, blank line, `// parent` + a handler object"
 *     shape — is handed to the real JS grammar as a sublanguage, so `this`,
 *     arrow functions and template literals all resolve properly.
 *
 * The JS grammar those escapes reach is `puzzleJavascript` below, not the stock
 * one — see its comment for why `events = { … }` needs help.
 *
 * Everything brace-related is deliberately single-line: a mode only opens on `{`
 * when a matching `}` exists later on the SAME line. That is what keeps a
 * multi-line JS object literal (`events = {` … `};`) from being swallowed as one
 * giant interpolation.
 */

import javascript from 'highlight.js/lib/languages/javascript';

// Only treat `{` as template syntax when its `}` lands on the same line. Allows
// one level of nesting so `options={ { loop: true } }` still matches.
const CLOSES_ON_LINE = /(?=(?:[^{}\n]|\{[^{}\n]*\})*\})/;

function re(...parts) {
  return new RegExp(parts.map((p) => (typeof p === 'string' ? p : p.source)).join(''));
}

/**
 * The stock `javascript` grammar plus Puzzle's view class fields.
 *
 * `events = { … }` and `refs = { … }` are PuzzleView's declarative API surface —
 * as load-bearing as `data()` or `mounted()`, which the JS grammar already paints
 * as methods. To the JS grammar they're bare identifiers, so they came out
 * unstyled and the block read as anonymous. Matched only at the head of a line
 * and only when an assignment follows, so `events` used as an ordinary variable
 * (`const events = […]`, `events.push(…)`) is left alone.
 *
 * Registered AS `javascript`, not alongside it: docs snippets reach the JS
 * grammar three ways — `lang="js"`, the puzzle grammar's `<script>` block and
 * its JS tail, and JSX — and all three should agree.
 */
export function puzzleJavascript(hljs) {
  const js = javascript(hljs);
  // Array `match` form, not one regex with capture groups: hljs only remaps an
  // object `scope` onto groups when `match` is an array (see beginMultiClass).
  //
  // Keyed on `= {` rather than on a line anchor: inside a class body the JS
  // grammar's whitespace mode consumes the newline and indent first, so by the
  // time this rule is tried the position is mid-line and `^` can never match.
  // `foo.events = {}` is safe — the property-access mode starts at the `.` and
  // wins on position — and `const events = [...]` is safe because it isn't `{`.
  const FIELD = {
    match: [/(?:events|refs)/, /(?=\s*=\s*\{)/],
    scope: { 1: 'built_in' },
    relevance: 0,
  };
  // A bare `{` opens the JS grammar's "value container" mode, and a class body is
  // just such a block — so the 73 `events = {` fields sitting inside
  // `class … extends PuzzleView { … }` are one level below the root and never see
  // a root-level rule. Inject there too. Identified by the mode's own keywords
  // rather than by index; if a future hljs reshapes it we quietly lose the
  // in-class coloring instead of breaking.
  const contains = js.contains.map((m) =>
    m && m.keywords === 'return throw case' && Array.isArray(m.contains)
      ? { ...m, contains: [FIELD, ...m.contains] }
      : m
  );
  return { ...js, contains: [FIELD, ...contains] };
}

export default function puzzleLang(hljs) {
  const TAG_NAME_RE = /[A-Za-z][\w.-]*/;
  // Attribute names, including Puzzle's sigils: `@click`, `:href`, `data-*`.
  const ATTR_NAME_RE = /[A-Za-z_][\w.:-]*/;

  // Innards shared by interpolations and block-tag conditions. All single-line
  // `match` modes (never begin/end), so an unpaired quote can't run away and eat
  // the closing brace.
  const EXPR_CONTENTS = [
    // `{ price | currency('USD') }` — the formatter tail, not the `||` operator.
    { scope: 'built_in', match: /(?<!\|)\|(?!\|)\s*[A-Za-z_$][\w$]*/ },
    { scope: 'string', match: /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/ },
    { scope: 'literal', match: /\b(?:true|false|null|undefined)\b/ },
    { scope: 'number', match: /\b\d+(?:\.\d+)?\b/ },
    { scope: 'title.function', match: /[A-Za-z_$][\w$]*(?=\s*\()/ },
    // Nested object/expression braces, so the mode's own `}` terminator doesn't
    // fire early on `{ { loop: true } }`.
    { begin: /\{/, end: /\}/ },
  ];

  // `{ expression }` — the whole thing carries the expression color; the modes
  // above paint over it.
  const INTERPOLATION = {
    scope: 'template-variable',
    begin: re(/\{(?!\s*[#/:])/, CLOSES_ON_LINE),
    end: /\}/,
    relevance: 2,
    contains: EXPR_CONTENTS,
  };

  // `{#if cond}` `{:else if cond}` `{/if}` `{#for todo in todos, i}` `{#svg 'x.svg'}`
  const BLOCK_TAG = {
    scope: 'template-variable',
    begin: re(/\{(?=\s*[#/:])/, CLOSES_ON_LINE),
    end: /\}/,
    relevance: 10,
    contains: [
      { scope: 'keyword', match: /[#/:][A-Za-z]+(?:\s+if)?/ },
      { scope: 'keyword', match: /\b(?:in|as)\b/ },
      ...EXPR_CONTENTS,
    ],
  };

  const TEMPLATE = [BLOCK_TAG, INTERPOLATION];

  const TAG_INTERNALS = {
    endsWithParent: true,
    illegal: /</,
    relevance: 0,
    contains: [
      // `@change`, `:value` — sigil kept, colored apart from plain attributes.
      { scope: 'attr.directive', match: re(/[@:]/, ATTR_NAME_RE), relevance: 5 },
      { scope: 'attr', match: ATTR_NAME_RE, relevance: 0 },
      {
        begin: /=\s*/,
        relevance: 0,
        contains: [
          // `prop={ expr }` / `class={#if x}a{/if}` — bare-brace attribute values.
          ...TEMPLATE.map((m) => hljs.inherit(m, { endsParent: true })),
          {
            scope: 'string',
            endsParent: true,
            variants: [
              { begin: /"/, end: /"/, contains: TEMPLATE },
              { begin: /'/, end: /'/, contains: TEMPLATE },
              { begin: /[^\s"'=<>`]+/ },
            ],
          },
        ],
      },
    ],
  };

  // Lines that unambiguously open JavaScript at column 0 hand the rest of the
  // snippet to the JS grammar, and give it back as soon as markup or a block tag
  // starts a line again. Anchored at column 0 on purpose — indented text inside
  // markup never triggers it, so prose can't be mistaken for code. A lone `//`
  // line is NOT an opener (see the root comment mode): docs snippets often label
  // a pure-template block with a comment, and starting JS there would swallow it.
  const JS_TAIL = {
    begin: re(
      '^(?:',
      // statement keywords
      /(?:export\s+)?(?:default\s+)?(?:const|let|var|function|class|async|import|export|return)\b/,
      // assignment: `events = {`, `this.foo = …`
      '|',
      /[A-Za-z_$][\w$.]*\s*=[^=]/,
      // method shorthand: `data() {`, `mounted() {`
      '|',
      /[A-Za-z_$][\w$]*\s*\([^)\n]*\)\s*\{/,
      '|',
      /\/\*/,
      ')'
    ),
    end: /(?=^\s*(?:<\/?[A-Za-z]|\{[#/:]))/m,
    returnBegin: true,
    subLanguage: 'javascript',
    relevance: 0,
  };

  return {
    name: 'Puzzle',
    aliases: ['pzl', 'html', 'puzzle-template'],
    case_insensitive: false,
    contains: [
      hljs.COMMENT(/<!--/, /-->/, { relevance: 10 }),
      // Docs snippets annotate template blocks with bare `//` lines. The
      // lookbehind keeps `https://…` in body text out of it.
      { scope: 'comment', match: /(?:^|(?<=\s))\/\/[^\n]*/, relevance: 0 },
      { scope: 'symbol', match: /&[a-z]+;|&#[0-9]+;|&#x[a-f0-9]+;/ },
      // `<script>` / `<script>` / `<style>` bodies -> real JS / CSS.
      {
        scope: 'tag',
        begin: /<script?(?=\s|>)/,
        end: />/,
        keywords: { name: 'script scripts' },
        contains: [TAG_INTERNALS],
        starts: { end: /<\/scripts?>/, returnEnd: true, subLanguage: ['javascript'] },
      },
      {
        scope: 'tag',
        begin: /<style(?=\s|>)/,
        end: />/,
        keywords: { name: 'style' },
        contains: [TAG_INTERNALS],
        starts: { end: /<\/style>/, returnEnd: true, subLanguage: ['css'] },
      },
      // open tag
      {
        scope: 'tag',
        begin: re(/</, '(?=', TAG_NAME_RE, '(?:/>|>|\\s))'),
        end: /\/?>/,
        contains: [{ scope: 'name', match: TAG_NAME_RE, relevance: 0, starts: TAG_INTERNALS }],
      },
      // close tag
      {
        scope: 'tag',
        begin: re(/<\//, '(?=', TAG_NAME_RE, '>)'),
        contains: [
          { scope: 'name', match: TAG_NAME_RE, relevance: 0 },
          { begin: />/, relevance: 0, endsParent: true },
        ],
      },
      ...TEMPLATE,
      JS_TAIL,
    ],
  };
}
