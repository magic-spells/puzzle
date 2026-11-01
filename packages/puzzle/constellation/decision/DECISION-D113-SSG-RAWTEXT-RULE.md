---
name: >-
  D113 — Prerender RAWTEXT rule: JSON scripts escape <, other script/style emit raw behind a
  breakout guard
status: verified
connections:
  - DECISION-D22-NO-ESCAPE-BY-DEFAULT
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - COMPONENT-SSG
  - FILE-SSG-SERIALIZER
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D113 — Prerender RAWTEXT rule for `<script>` and `<style>`

`<script>`/`<style>` are RAWTEXT: the HTML parser never entity-decodes them, so
the serializer must not entity-escape their content (that corrupts JSON-LD and
CSS child combinators). But raw output is an XSS risk: RAWTEXT ends at the first
case-insensitive `</script` even inside a string, so interpolated data could
break out and inject markup. Serialization to HTML is the one place template
text re-enters a parser (at runtime interpolations are DOM text nodes, D22).

## Decision

`client-runtime/ssg/serialize.js` gathers `script`/`style` text via
`collectTextContent` and emits it through one rule:

- **JSON scripts** (`type`, trimmed and lowercased, is `application/json` or
  ends `+json`): raw with `<` written as the JSON escape `\u003c`
  (`escapeScriptJson`). JSON-transparent, and a literal `</script>` becomes
  impossible. The static data island (D81) and the SSG redirect pages use the
  same helper.
- **Everything else emits raw, guarded** — a build error if a plain-JS
  `<script>` contains `</script`, or both `<!--` and `<script` (the
  double-escaped state); or a `<style>` contains `</style` (case-insensitive).
  The atomic output swap keeps the last good `dist/`.
- Build output only (no runtime bytes). `tests/ssg-rawtext.test.js` pins the
  matrix.

## Alternatives rejected

- **Entity-escape** — wrong for RAWTEXT.
- **Raw always** — `</script>` breakout, stored XSS.
- **Auto-rewrite `</script` to `<\/script`** — only valid inside a JS/CSS string
  literal, which the serializer can't know.
- **Forbid interpolation in RAWTEXT** — kills JSON-LD, the main use case.
- **Also escape U+2028/U+2029** — a JS-eval concern, not a breakout one.
