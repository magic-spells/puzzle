---
name: >-
  D113 — prerender RAWTEXT rule: JSON scripts escape < as \u003c; other script/style emit raw behind a
  breakout guard
status: built
connections:
  - DECISION-D22-NO-ESCAPE-BY-DEFAULT
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
  - COMPONENT-SSG
  - FILE-SSG-SERIALIZER
---

The SSG serializer stops entity-escaping `<script>`/`<style>` content —
they are RAWTEXT elements, so the HTML parser never entity-decodes them and
`escapeText` was corruption, not protection. In its place, a two-tier rule:
**JSON-typed scripts** (`application/json`, any `+json` suffix — JSON-LD's
`application/ld+json` is the motivating case) emit raw with `<` rewritten to
`\u003c`; **all other script/style content** emits raw behind a build-error
guard that rejects the sequences which would end (or un-end) the element
early. The `\u003c` rule is not new policy — the static data island
([[DECISION-D81-STATIC-PAGES-MODE]]) already used exactly this escape, with
the same breakout rationale; D113 extracts it into one shared helper
(`escapeScriptJson`) and extends it to user elements.

## Context

Every text vnode serialized through `escapeText` (`&`/`<`/`>` → entities).
Correct for normal text — the browser decodes entities on parse, so the
round trip preserves the string. But RAWTEXT content is read literally:
prerendered JSON-LD reached crawlers as `&amp;`/`&lt;` garbage — and
crawlers are the *only* audience for prerendered structured data
([[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]]'s premise) — while a
`<style>` child combinator `a > b` prerendered as dead CSS. In hybrid mode
the SPA takeover re-renders the live DOM correctly, hiding the corruption
from anyone checking in a browser.

The naive fix (emit raw, always) is an XSS: RAWTEXT ends at the first
case-insensitive `</script`, even inside a JS or JSON string, so
user-supplied data flowing into a prerendered script could end the element
and inject live markup. The SPA runtime never has this problem — text
interpolations become DOM text nodes ([[DECISION-D22-NO-ESCAPE-BY-DEFAULT]]);
serialization to an HTML file is the one place template text re-enters an
HTML parser.

## Decision

- One serializer branch alongside the existing per-element special cases
  (textarea/select/void/svg): `script`/`style` gather their text via
  `collectTextContent` and emit through the RAWTEXT rule instead of child
  serialization.
- **JSON scripts** (`type` trimmed/lowercased equals `application/json` or
  ends `+json`): `<` → `\u003c`. JSON-transparent — parsers decode to the
  identical string — and a literal `</script>` becomes impossible to emit.
- **Everything else emits raw, guarded.** A plain-JS `<script>` throws at
  build time if its content contains `</script` (case-insensitive), or
  contains BOTH `<!--` and `<script` (the script-data-double-escaped state,
  where the parser would treat our own closing tag as content). `<style>`
  throws on `</style`. The serializer cannot know the embedded language's
  escaping semantics, so failing loudly beats silent corruption in one
  direction and silent XSS in the other. The error surfaces as a failed
  build; the atomic output swap keeps the last good `dist/`.
- The static data island's inline escape moves onto the shared helper —
  the rule lives once.

## Alternatives rejected

- **Keep entity-escaping** — provably wrong for RAWTEXT; the bug.
- **Raw always** — the `</script>` breakout, stored XSS in prerendered pages.
- **Escape `</script` as `<\/script` automatically** — only valid inside a
  JS/CSS string literal; the serializer can't know it's in one, so the
  "repair" could corrupt code as easily as fix it.
- **Refuse interpolation in RAWTEXT entirely** — kills the JSON-LD use case
  prerendering exists to serve.
- **Adding `\u2028`/`\u2029` to the JSON escape** — a JS-eval concern, not a
  breakout concern; kept identical to the island's established rule.

## Consequences

- Prerendered JSON-LD is valid for the first time; `<style>` content is
  byte-faithful. Behavior change is build-output-only — no runtime bytes.
- A template whose plain-JS script embeds `</script>` fails the build with a
  pointed error instead of shipping either corruption or an injection.
- `tests/ssg-rawtext.test.js` pins the matrix: JSON-LD entity-free round-trip,
  breakout attempt neutralized to `\u003c`, raw JS/CSS fidelity (`a < b`,
  `.a > .b`), the throw cases (script closer, double-escape pair, style
  closer, case-insensitive), and the normal-text escaping regression guard.
- SPEC §36 render semantics documents the rule.
