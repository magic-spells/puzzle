---
name: D159 — Hash and memory router modes as imported factories (v1.74)
status: built
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
---

Hash and memory routing are opt-in imports, not config strings. History mode
stays the inline zero-config default; the other two modes ship only in bundles
that import their factory from `@magic-spells/puzzle/router-modes`:

```js
import { hashRouter } from '@magic-spells/puzzle/router-modes';

new PuzzleApp({ routerMode: hashRouter() });
```

`routerMode` accepts a mode object produced by `hashRouter()` or
`memoryRouter(options)`; the strings `'hash'`/`'memory'` are a constructor
error whose message points at the import. History-mode apps — the default and
the overwhelmingly common case — ship none of the hash fragment parsing, the
memory stack, or their commit/click/scroll branches.

## Design

**Mode strategy objects, history inline.** The Router keeps its history
behavior as the built-in path — no indirection cost for the default. A mode
object supplies the deviations at the seams the router already owns:

- **URL read**: the hash branch of `#currentPath` (fragment parsing, base
  stripping) moves into `hashRouter()`'s `readPath(location, base)`.
- **URL write**: `#encodedUrl`'s hash arm becomes the mode's
  `encode(path, base)`; the module-level `encodeURL` keeps history encoding
  inline and delegates to a mode object when one is present.
- **Click interception**: `#tryHashFragment` and the hash absolute-URL branch
  of `#handleClick` move into the hash mode's click hook.
- **Memory plumbing**: the stack/index state, the `start()` seed,
  `go()/back()/forward()`'s stack walk, `#commitLocation`'s memory arms,
  `initialPath`, and the popstate-listener skip move into `memoryRouter()`.
  The scroll/focus/head suppressions stay as cheap core guards keyed off the
  mode object's declared capabilities rather than string comparisons.

**Internal consumers import the factory directly.** `/testing`'s
`createTestApp` imports `memoryRouter` (its public contract is unchanged — it
already forces memory and omits `routerMode` from its config type), and
`ssg/index.js` imports it for the two node-side prerender Routers. Hybrid
prerender already refuses hash/memory and static output ignores them, so the
SSG's route-href encoding is history-only by construction and hard-codes it;
`makeRouterStub` already forces history. The `link` formatter needs no change:
it is an injected `url` callback, and `Router.url` delegates to the mode's
`encode`.

**Wiring.** The subpath needs the four-place plumbing: a `package.json`
`exports` entry, `types/router-modes.d.ts`, a `tests-types/tsconfig.json`
mapping, and an explicit `Alias` line in `configureRuntime`
(`compiler/internal/build/options.go`). Vitest tests import the factories by
relative path (`../client-runtime/router/modes.js`); the vitest alias maps only
the bare specifier.

## Alternatives rejected

- **`routerMode: 'hash' | 'memory'` config strings** — invisible to the
  bundler, so every history-mode app shipped both other modes' code (~17
  scattered `#mode` branches). This was the status quo being removed.
- **A D89 scan/define gate** — the signal lives in `app.js` JavaScript, not in
  templates; D89 rejected script-token scanning.
- **Extracting history mode too, Vue Router-style (`createWebHistory()`
  required)** — punishes the zero-config default with a mandatory import and
  moves bytes without removing any: history is in every bundle regardless.
- **A full strategy interface for all three modes** — dispatch indirection on
  the default path and a wider public surface for no additional byte savings;
  the mode object only carries the deviations.
