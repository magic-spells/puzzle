import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import ini from 'highlight.js/lib/languages/ini';
import bash from 'highlight.js/lib/languages/bash';
import puzzleLang, { puzzleJavascript } from './puzzle-lang.js';

// Syntax highlighting for the Code piece, on highlight.js CORE + exactly the
// grammars docs-style snippets use — the full hljs bundle ships ~190 languages
// you don't want in app.js. Register more grammars here if your snippets need
// them. The GitHub light/dark token palette lives in pieces.css under the
// .hljs-* classes.
//
// Registry lib file: copied to app/lib/highlight.js; pieces import it as
// ../../lib/highlight.js. Requires `npm install highlight.js`.
// `javascript` is the stock grammar plus PuzzleView's class fields — see
// puzzle-lang.js. Registered under the stock name so every route into JS agrees.
hljs.registerLanguage('javascript', puzzleJavascript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('ini', ini); // aliases: toml
hljs.registerLanguage('bash', bash);

// Markup snippets go through the Puzzle grammar, not stock xml — it understands
// `{ expr }`, `{#if}`/`{/for}` block tags and `@event=` bindings, and hands a
// trailing JS block to the javascript grammar. Registered under `html` too, so
// existing `lang="html"` props route here; xml stays registered because the
// javascript grammar drops into it for JSX.
hljs.registerLanguage('puzzle', puzzleLang);

// Snippet-shape heuristic instead of hljs's statistical autodetect — the kinds
// of snippets in docs are trivially separable, and autodetect misfires on short
// install commands. Anything that OPENS with markup, or carries Puzzle template
// syntax anywhere, goes to the puzzle grammar (it degrades to plain HTML when
// there is no template syntax, and picks up a trailing JS block on its own).
// Everything else goes to javascript.
function guessLang(code) {
  const t = code.trimStart();
  if (/^(cp|npm|npx|pnpm|yarn|mkdir|cd|git)\s/.test(t)) return 'bash';
  if (t.startsWith('<')) return 'puzzle';
  if (/\{[#/:](?:if|unless|for|case|else|when|svg)\b/.test(code)) return 'puzzle';
  // JS lead-in with a markup block below it — the common "here's the data, here's
  // the tag that uses it" snippet. The puzzle grammar hands the JS run back to
  // the javascript grammar, so this loses nothing and fixes the markup half.
  if (/^<\/?[A-Za-z]/m.test(code)) return 'puzzle';
  return 'javascript';
}

// Returns hljs-classed HTML for a snippet (hljs escapes the source), or null
// when highlighting fails — callers fall back to plain text.
export function highlight(code, lang) {
  const language = lang && hljs.getLanguage(lang) ? lang : guessLang(code);
  try {
    return hljs.highlight(code, { language }).value;
  } catch {
    return null;
  }
}
