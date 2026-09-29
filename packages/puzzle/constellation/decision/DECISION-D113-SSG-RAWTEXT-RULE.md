---
name: >-
  D113 — Prerender RAWTEXT rule: JSON scripts escape <, other script/style emit raw behind a
  breakout guard
status: verified
connections:
  - DECISION-D22-NO-ESCAPE-BY-DEFAULT
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - COMPONENT-SSG
  - FILE-SSG-SERIALIZER
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D113 — prerender RAWTEXT rule for `<script>` and `<style>`

`<script>`/`<style>` are RAWTEXT: the HTML parser never entity-decodes them, so
the serializer must not entity-escape their content (that corrupted JSON-LD and
CSS child combinators). But raw output is an XSS: RAWTEXT ends at the first
case-insensitive `</script` even inside a string, so interpolated data could
break out and inject markup. Serialization to HTML is the one place template
text re-enters a parser (at runtime interpolations are DOM text nodes, D22).

## Decision

The serializer gathers `script`/`style` text via `collectTextContent` and emits
it through one rule:

- **JSON scripts** (`type`, trimmed/lowercased, is `application/json` or ends
  `+json`): raw with `<` → `\u003c` (`escapeScriptJson`). JSON-transparent, and
  a literal `</script>` becomes impossible. The static data island (D81) uses
  the same helper.
- **Everything else emits raw, guarded** — a build error if a plain-JS
  `<script>` contains `</script`, or both `<!--` and `<script` (the
  double-escaped state); or a `<style>` contains `</style`
  (all case-insensitive). The atomic output swap keeps the last good `dist/`.

## Alternatives

- **Entity-escape** — wrong for RAWTEXT (the original bug).
- **Raw always** — `</script>` breakout, stored XSS.
- **Auto-rewrite `</script` → `<\/script`** — only valid inside a JS/CSS string
  literal, which the serializer can't know.
- **Forbid interpolation in RAWTEXT** — kills JSON-LD, the main use case.
- **Also escape U+2028/U+2029** — a JS-eval concern, not a breakout one.

## Consequences

Build-output only (no runtime bytes). `tests/ssg-rawtext.test.js` pins the
matrix: JSON-LD round-trip, neutralized breakout, raw JS/CSS fidelity, each
throw case, and normal-text escaping.
