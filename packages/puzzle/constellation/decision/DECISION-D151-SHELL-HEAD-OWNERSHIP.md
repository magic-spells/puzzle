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
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
  - DECISION-D81-STATIC-PAGES-MODE
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D151 — Managed head injection owns the shell head, and only the shell head

## Context

D84 says the framework "only ever creates, updates, or removes marker-bearing
tags — your hand-written head elements are never touched", and the SSG injector's
own comment described its job as shell-head surgery. The implementation did not
match that scope. Both writers injected the rendered body into the shell FIRST
and then ran the head pass over the resulting **whole document**: a `<title>`
regex, ten `data-puzzle-head` matchers (recompiled with `new RegExp` per page),
and `</head>`/`</title>` anchor probes — roughly thirteen full-document scans per
hybrid page and seventeen per static page.

Two consequences, one per axis:

- **Correctness.** A rendered page is not shell. An inline `<svg><title>` in view
  output could be rewritten with the route's title, and any `data-puzzle-head`
  attribute a view emitted was replaced or deleted as though the framework had
  written it. Nothing about that markup is framework-owned.
- **Cost.** The shell is read once per build and never changes. Every offset the
  injection needs is a build constant, yet each page rediscovered all of them by
  scanning text that grows with page content. On a 148-route site this was ~342ms
  — the largest single line item in the JS half of the build.

## Decision

**Head injection reads a shell plan compiled once per build, and edits only bytes
inside the shell's head region.**

- The plan (`compileShellPlan`) locates, per shell: the head region
  (`<head …>` → `</head>`, case-insensitive), its `<title>` element, every
  `data-puzzle-head` marker span inside the region, the empty target element, and
  `</body>`. Managed-tag matchers are module-level constants — the ids are
  framework constants — and the target matcher is memoized per id.
- A page is one ordered splice over those offsets: the rebuilt head region, the
  target rebuilt with its content, the static data island. Cost is O(head size)
  plus the content copy, not O(document) × 17.
- **Ownership is now structural.** The surgery cannot reach past `</head>`, so a
  `<title>` element or a `data-puzzle-head` attribute in rendered body markup is
  view output and stays byte-identical. The rule stated positively: the framework
  owns marker-bearing tags and the `<title>` element **in the shell head**; every
  other byte of the document belongs to the shell author or the view.
- The degradation ladder for a malformed or fragment shell is unchanged in
  behavior and now expressed as the region definition: no `</head>` → the region
  ends after the first `</title>`, so managed tags ride there; neither anchor →
  no region, and pending inserts warn and are skipped rather than throwing.
- The static data island's `</body>` anchor is likewise the SHELL's, so rendered
  content can no longer capture it (a `</body>` inside a raw `<script>` block used
  to steal the island).

Everything else is preserved byte-for-byte: escaping, insert order and position,
in-place replacement, duplicate collapse, removal of non-resolving fields, the
title-only pre-D84 path, and `prerender: false` (hybrid writes the shell verbatim;
static passes `content: null` / `head: null` and does no head work). Verified by
building `examples/static-docs` (static) and `examples/blog` (`--hybrid`) with one
compiler binary before and after: `dist/` is identical.

## Consequences

- The pathological cases the old code "handled" now behave correctly instead of
  destructively; they are pinned by tests in `tests/ssg-head.test.js`.
- The shell plan is memoized per shell STRING in a small bounded map, so
  `injectShell`/`injectStaticShell` keep their public signatures — a direct caller
  passing a one-off shell pays one compile and nothing else.
- Head injection stopped being the dominant cost of the prerender pass. On a
  synthetic 152-route build, `prerenderToDir` fell from 113ms to 30ms (hybrid) and
  62ms to 31ms (static), together with the once-per-build Router and the
  concurrent writer landed in the same round.

## Alternatives rejected

- **Keep the document-wide scan, just cache the regexes.** Recompilation was the
  smaller half; the scans themselves grow with page content, and caching regexes
  would have left the ownership overreach exactly as it was.
- **Parse the shell with an HTML parser.** D84 deliberately chose narrow string
  surgery with no parser dependency, and a parser would have to round-trip the
  shell author's bytes exactly to keep builds byte-stable.
- **Apply the head before injecting the body, but still by regex.** It fixes the
  overreach and none of the cost: the shell is still rescanned once per page.
