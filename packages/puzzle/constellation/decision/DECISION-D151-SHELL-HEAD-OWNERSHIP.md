---
name: 'D151 — Managed head injection owns the shell head, and only the shell head'
status: verified
connections:
  - COMPONENT-SSG
  - FILE-SSG-RUNTIME
  - FILE-HEAD-TAGS
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D81-STATIC-PAGES-MODE
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/ssg/index.js
  - tests/ssg-head.test.js
---

# D151 — Managed head injection owns the shell head, and only the shell head

## Context

[[DECISION-D84-HEAD-MANAGEMENT]] promises the framework only touches
marker-bearing tags. A head pass run over the whole rendered document would
rewrite an inline `<svg><title>` or a view's own `data-puzzle-head` attribute,
and rescans text that grows with page content on every page, although every
offset it needs is a build constant of the shell.

## Decision

**Head injection reads a shell plan compiled once per build and edits only bytes
inside the shell's head region** (`client-runtime/ssg/index.js`).

- `compileShellPlan` locates, per shell: the head region (`<head …>` →
  `</head>`, case-insensitive), its `<title>`, every `data-puzzle-head` marker
  span inside the region, the empty target element, and `</body>`. Managed-tag
  matchers are module constants; the target matcher is memoized per id. Plans are
  memoized per shell string in a small bounded map, so `injectShell` /
  `injectStaticShell` keep their signatures.
- A page is one ordered splice: rebuilt head region, target with content, static
  data island. O(head size) plus the content copy.
- **Ownership is structural**: the framework owns marker-bearing tags and the
  `<title>` **in the shell head**; every other byte belongs to the shell author
  or the view. The data island's `</body>` anchor is the shell's, so a
  `</body>` inside rendered content (e.g. a raw `<script>`) can't capture it.
- Degradation for a fragment shell: no `</head>` → the region ends after the
  first `</title>`; neither anchor → no region, pending inserts warn and are
  skipped.
- Unchanged: escaping, insert order, in-place replacement, duplicate collapse,
  removal of non-resolving fields, the title-only path, and `prerender: false`
  (hybrid writes the shell verbatim; static does no head work).

## Alternatives

- Keep the document-wide scan and cache regexes — scans still grow with content
  and the ownership overreach stays.
- Parse the shell with an HTML parser — D84 chose string surgery with no parser
  dependency; a parser must round-trip the author's bytes exactly.
- Apply the head before injecting the body, still by regex — fixes ownership,
  not cost.

## Consequences

Body markup containing `<title>` or `data-puzzle-head` renders byte-identical
(pinned in `tests/ssg-head.test.js`). Head injection is no longer a significant
cost of the prerender pass.
