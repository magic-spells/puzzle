---
name: 'D70 — Template comments: `{## }` inline + `{#comment}…{/comment}` raw block (v1.37)'
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DECISION-D40-ELSE-IF
  - DECISION-D46-INLINE-SVG
verified_at: '2026-07-17T21:32:34.193Z'
notes:
  - kind: verified
    text: >-
      Verified at merge (PR #42, code commit 802c962): Go suites green on cold cache; vitest 736
      green; examples/todos dist byte-identical between a main-built and branch-built compiler; e2e
      probe (inline + block comment wrapping deliberately broken {#if} markup in Home.pzl) built
      clean with zero comment text in dist/ and app.js still byte-identical. styles.css caveat found
      and documented: Tailwind's raw-source scanner can lift utility-shaped words (block, inline)
      out of ANY comment — CSS-only, never the JS bundle.
---

# D70 — Template comments: `{## }` inline + `{#comment}…{/comment}` raw block (v1.37)

`{## any text }` — a self-contained inline comment — and `{#comment} … {/comment}` — a block comment whose body is discarded **raw**, never lexed as template — both erased at the lexer (they emit NO tokens). Settled (v1.37); additive; parser-only, in the [[DECISION-D40-ELSE-IF]] mold. See [[DOC-SPEC]] §6 and [[DOC-TEMPLATE-SYNTAX]].

## Context

Puzzle had no brace-native comment syntax. HTML comments `<!-- -->` ARE already compile-time-stripped (lexed as `TokComment`, dropped by the parser — they never reach the DOM or the bundle), which covers plain annotation. What they can't do is **comment out template code**: HTML comments don't nest and can't contain `-->`, so disabling a chunk that already holds an HTML comment — or writing prose with `-->` in it — breaks. Both new spellings were compile errors before this (`unknown block {#}` / `unknown block {#comment}`), so nothing existing changes meaning.

## Decision

Two additive spellings, one shared property: **comments vanish at the lexer** — no token is emitted, so the parser never sees them. That single property is what makes them legal at every text position with zero structural special-casing: between `{#case}` clauses, adjacent to `{:else}`, inside `{#for}` bodies, and in `<puzzle-skeleton>` bodies (same lexer/parser — free).

- **`{## any text }`** — inline, self-contained (the second self-contained form after [[DECISION-D46-INLINE-SVG]]'s `{#svg}`, but erased rather than parsed). Everything after `{##` up to the terminating `}` is comment content (`{###x}` is also a comment). Terminated by a **dumb comment scanner**: tracks `{`/`}` nesting depth and honors `\{`/`\}` escapes, deliberately NOT string/regex/JS-comment-aware — `scanBraceGroup`+`LexSkip` would treat the apostrophe in `{## don't }` as opening an unterminated string. Balanced braces inside are fine (`{## { user.name } }` is one comment); a lone `}` needs `\}`. Unclosed at EOF is a positioned error at the opening `{`.
- **`{#comment} … {/comment}`** — the body is **raw text**, scanned forward for the closer without lexing: interpolations, block tags, HTML comments, apostrophes, and outright malformed template code inside are all ignored — that raw-discard is the point (comment out broken/half-written markup). Nested `{#comment}` openers are counted, so a commented-out region may itself contain a comment block. The closer tolerates whitespace (`{/ comment }`), matching closer trimming elsewhere; content after the keyword in the opener (`{#comment note}`) is allowed and ignored. Unterminated is a positioned error at the opener.
- **Text positions only.** In attribute contexts both spellings are positioned compile errors — `template comments are not allowed in attribute values` — replacing the confusing prior behaviors (quoted mini-grammar: `only {#if} is allowed … (got {#})`; unquoted `attr={## }` would have silently emitted `## …` as a broken JS expression). A stray `{/comment}` with no opener keeps the standard stray-closer error path.
- **Positions stay exact**: the raw scans count newlines, so every token after a multiline comment carries correct line/col.

## Alternatives rejected

- **String-aware scanning of comment bodies** (reusing `scanBraceGroup`/`LexSkip`) — comments are prose, not code; an apostrophe ("don't") would open an unterminated "string" and blow up the file. The dumb scanner is the correctness choice, not a shortcut.
- **Parsed-then-dropped block body** — would require the commented-out chunk to be well-formed template, defeating the primary use case (disabling broken or half-written code).
- **`{## … ##}` symmetric closer** — solves the lone-`}` case without escapes, but adds a second thing to remember; brace-depth + `\}` covers it and keeps the spelling the user asked for.
- **Comments in attribute values** — the attr mini-grammar stays deliberately small (D40 precedent: interpolation + flat `{#if}` only); a clear rejection error beats a third grammar surface.
- **Relying on HTML comments alone** — status quo; can't nest, can't wrap `-->`, and reads as markup rather than template annotation.

## Consequences

Non-breaking: additive amendment (v1.37). Lexer + attr-context guards + tests + one codegen byte-identity test; parser block dispatch, codegen, runtime, and all existing goldens byte-identical. Comment-free templates compile byte-identically. Out-of-tree follow-up: the Sublime `.pzl` grammar (separate repo) needs a comment-scope rule.
