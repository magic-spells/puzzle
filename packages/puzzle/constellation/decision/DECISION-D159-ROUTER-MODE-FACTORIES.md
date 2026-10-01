---
name: D159 — Hash and memory router modes as imported factories
status: verified
connections:
  - DECISION-D34-HASH-ROUTING
  - DECISION-D42-MEMORY-MODE
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - COMPONENT-SSG
  - DECISION-D94-TESTING-EXPORT
  - DOC-SPEC-ROUTER
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/router/modes.js
  - client-runtime/router/router.js
  - client-runtime/app.js
  - client-runtime/ssg/index.js
---

## Context

Mode config strings were invisible to the bundler, so every path-mode app (the default and overwhelmingly common case) shipped the hash fragment parsing, the memory stack and their scattered `#mode` branches.

## Decision

Path routing stays inline and zero-config. Hash and memory are opt-in imports from `@magic-spells/puzzle/router-modes`:

```js
import { hashRouter } from '@magic-spells/puzzle/router-modes';
new PuzzleApp({ routerMode: hashRouter() }); // or memoryRouter({ initialPath })
```

- **Mode objects carry only the deviations** at the router's existing seams: `readPath` (URL read), `encode` (URL write, also behind `Router.url`), `clickFragment`/`clickLink` (interceptor), and for a `urlless` mode (memory) the entry bookkeeping history normally provides (`start`/`commit`/`go`/`clearPending`/`reset`). Scroll/focus/head suppressions stay as cheap core guards keyed off the mode's declared capabilities.
- **Validation:** the constructor accepts any object with a callable `create` and rejects a `create()` that returns nothing — a null `#mode` IS path mode at every seam, so an unbuilt hash mode would boot clean and route wrong. Strings (`'hash'`, `'memory'`, `'history'`) throw with a dev-only fix-it naming the import. Types brand `RouterMode` with a `unique symbol`, so only a factory's return value is assignable.
- **Internal consumers import the factory directly:** `/testing`'s `createTestApp` forces `memoryRouter`, and `ssg/index.js` uses it for the node-side prerender Routers (hybrid refuses hash/memory; static ignores them, so SSG href encoding is history-only).
- **Wiring for the subpath** (four places): `package.json` `exports`, `types/router-modes.d.ts`, the `tests-types/tsconfig.json` mapping, and the `Alias` line in `configureRuntime` (`compiler/internal/build/options.go`). Vitest tests import `../client-runtime/router/modes.js` by relative path.

## Alternatives

- A D89 scan/define gate — the signal is in `app.js` JavaScript, not templates.
- Extracting path mode too (`createWebHistory()`, Vue Router-style) — taxes the default with a mandatory import and removes no bytes.
- A full strategy interface for all three modes — indirection on the default path for no byte savings.
- A runtime `WeakSet` brand — costs bytes in every mode app to reject forged descriptors the duck-type check, falsy-`create()` check and type brand already cover.

## Consequences

Path-mode apps ship none of the hash or memory code. A mode object is an internal contract: hand-written descriptors are unsupported, not defended against.
