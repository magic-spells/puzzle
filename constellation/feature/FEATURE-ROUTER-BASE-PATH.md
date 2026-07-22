---
name: "v1.19 — Router base-path support (history + hash modes)"
status: verified
connections:
  - DECISION-D51-ROUTER-BASE-PATH
  - DECISION-D34-HASH-ROUTING
  - DECISION-D42-MEMORY-MODE
  - FEATURE-V1-6-HASH-ROUTING
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - DOC-ROUTER
  - DOC-SPEC
verified_at: '2026-07-12T00:14:46.752Z'
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: three-seam base application reviewed against SPEC §23 at
      ship; tests/router-base.test.js (20) + all router suites + full suite green (480
      vitest).
---

# v1.19 — Router base-path support

The remaining half of the old router-modes follow-up card (its `'memory'` half
shipped in v1.11). Driven by [[DECISION-D51-ROUTER-BASE-PATH]]; contract in
[[DOC-SPEC]] §23.

## Intent

An app deployed at `https://host/myapp/` routes correctly with one config line
(`routerBase: '/myapp'`) while app code stays base-free in both URL-carrying
modes.

## Scope

**In (shipped):**
- One `routerBase` config (PuzzleApp passthrough → Router `base`), applied at
  the path-shape boundary behind the existing mode seams: `#currentPath` strips
  on read, the commit's pushState prefixes on write, the click interceptor takes
  only under-base URLs (outside-base same-origin links fall through — a real
  navigation away). History: pathname prefix; hash: in-fragment prefix
  (`#/myapp/user/1`, D41 anchors compose: `#/myapp/docs#faq`); memory: inert.
- `push()`, matching, `current`, `params`, `this.route` never see the base;
  hrefs are real URLs and carry it.
- Normalization (`'myapp'`/`'/myapp/'` → `'/myapp'`; `''`/`'/'` → none),
  `#`/`?` constructor throw, warn-once + pass-through when loaded outside the
  base.

**Out (rejected in D51):** per-route bases, runtime base switching, `<base
href>` sniffing, base-free hrefs rewritten at intercept time (breaks
middle-click/new-tab).

## Outcome

Shipped in v1.19. Router + config passthrough only — router.js (three seams +
`normalizeBase`), app.js (`routerBase`), `tests/router-base.test.js` (20
tests); [[DOC-ROUTER]] base-path section. Base-less apps byte-identical; full
suite green at ship time.
