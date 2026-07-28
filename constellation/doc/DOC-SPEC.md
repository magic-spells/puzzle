---
name: SPEC.md — the frozen v1 contract
status: built
verified_at: '2026-07-25T05:53:25.564Z'
connections:
  - DOC-VIEW-LIFECYCLE
  - DOC-DECISIONS
verified_sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
notes:
  - kind: verified
    text: >-
      Delta re-verification, not a full re-read of the contract. Checked the sections the drift
      since 214406a actually touches: §45 (rewritten — it still described the SPA syncing managed
      tags and hybrid takeover adopting them by identity, both deleted by D111), §54's parenthetical
      (the D89 scan gates flip only now), and §55 against client-runtime/devtools.js field by field
      (snapshot:route was missing path/hash/title). §8/§21 were verified by the D112 session at this
      same sha. The remaining sections carry forward from the prior stamp.
    sha: 87078756d4e8a665c4a582864fbe7273cbf6f286
  - kind: verified
    text: >-
      Now the index: preamble + §35 + deferred/open lists byte-identical, plus a 57-row section map.
      Contract text lives in the six DOC-SPEC-* domain cards; all 55 distinct §N citations resolve
      to exactly one heading.
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
---

The enforceable v1 contract: exports/naming, config surface, .pzl anatomy, real-JS scripts rule, event conventions, template grammar, models/store/router surfaces, and the deferred-features cut list. When docs conflict, SPEC.md wins.

# Puzzle v1 Specification

**Status: frozen contract for the v1 build.** Where any other document (README, USER_GUIDE, CLAUDE.md, older examples) conflicts with this file, this file wins. `examples/todos/` is the canonical reference application; `examples/blog/` is the second v1 reference app (blog domain; replaces the removed `example-app/`).

The organizing principle for v1: **the todos app compiling and running end-to-end is the only milestone that matters.** Every feature not needed for that is explicitly deferred (see [Deferred features](#deferred-features-post-v1)).

---

## Section index

The spec is split across six domain cards. Section numbers are globally unique and never change: `§22` is `§22` no matter which card holds it, so the `§N` citations in the other cards and in `client-runtime/` / `compiler/` comments stay valid. This card remains the entry point, and the binding contract is the six cards in aggregate. A reader following a `§N` citation from code should start here and use this table to find the section.

| § | Section | Card |
| --- | --- | --- |
| 1 | Naming & entry points | [[DOC-SPEC-ANATOMY]] |
| 2 | App configuration (v1 surface) | [[DOC-SPEC-ANATOMY]] |
| 3 | `.pzl` file anatomy | [[DOC-SPEC-ANATOMY]] |
| 4 | `<script>` blocks are real JavaScript | [[DOC-SPEC-ANATOMY]] |
| 5 | Event handler convention | [[DOC-SPEC-TEMPLATE]] |
| 6 | Template grammar (v1) | [[DOC-SPEC-TEMPLATE]] |
| 7 | Models & schema builders | [[DOC-SPEC-DATA]] |
| 8 | Store (v1 surface) | [[DOC-SPEC-DATA]] |
| 9 | Router (v1 surface) | [[DOC-SPEC-ROUTER]] |
| 10 | Component context | [[DOC-SPEC-ANATOMY]] |
| 11 | Project layout & build | [[DOC-SPEC-ANATOMY]] |
| 12 | Animations (v1.1) | [[DOC-SPEC-VIEW]] |
| 13 | CLI tooling (v1.4) | [[DOC-SPEC-BUILD]] |
| 14 | Router scroll behavior (v1.5) | [[DOC-SPEC-ROUTER]] |
| 15 | Hash routing (v1.6) | [[DOC-SPEC-ROUTER]] |
| 16 | Skeleton loading (v1.8) | [[DOC-SPEC-VIEW]] |
| 17 | DOM islands (v1.13) | [[DOC-SPEC-TEMPLATE]] |
| 18 | Inline SVG assets: `{#svg}` (v1.14) | [[DOC-SPEC-TEMPLATE]] |
| 19 | Route snapshot in `data()`: `this.route` (v1.15) | [[DOC-SPEC-ROUTER]] |
| 20 | Schema validation enforcement (v1.16) | [[DOC-SPEC-DATA]] |
| 21 | Model relationships: `hasMany` / `belongsTo` (v1.17) | [[DOC-SPEC-DATA]] |
| 22 | Adapter write sync (v1.18) | [[DOC-SPEC-DATA]] |
| 23 | Router base path (v1.19) | [[DOC-SPEC-ROUTER]] |
| 24 | Composition markers: `<Children/>`, `<Slot/>`, `<Slot name>` (v1.21, amended v1.41, v1.64) | [[DOC-SPEC-TEMPLATE]] |
| 25 | TypeScript scripts: `<script lang="ts">` (v1.22) | [[DOC-SPEC-ANATOMY]] |
| 26 | Overlapping route transitions (v1.24) | [[DOC-SPEC-ROUTER]] |
| 27 | Dev HMR: state-preserving reload (v1.25) | [[DOC-SPEC-BUILD]] |
| 28 | List keying (v1.26) | [[DOC-SPEC-TEMPLATE]] |
| 29 | Scoped styles: `<style scoped>` (v1.27) | [[DOC-SPEC-ANATOMY]] |
| 30 | Atomic location commit (v1.28) | [[DOC-SPEC-ROUTER]] |
| 31 | Cached event handlers (v1.29) | [[DOC-SPEC-TEMPLATE]] |
| 32 | `this.memo()` — reference-stable derived values (v1.29) | [[DOC-SPEC-VIEW]] |
| 33 | Per-route / per-view transition mode (v1.30) | [[DOC-SPEC-ROUTER]] |
| 34 | App lifecycle hooks (v1.31) | [[DOC-SPEC-VIEW]] |
| 35 | 0.1.0 release hardening (v1.32) | this card |
| 36 | Static output — `output: 'hybrid' \| 'static'` (v1.33; amended v1.47/D81) | [[DOC-SPEC-BUILD]] |
| 37 | Cross-view morphs — sibling-swap capture flights in `enableMorph` (v1.35) | [[DOC-SPEC-VIEW]] |
| 38 | Element refs — `ref="name"` → `this.refs` (v1.39) | [[DOC-SPEC-VIEW]] |
| 39 | Scroll-triggered enter animations — `trigger: 'visible'` (v1.40) | [[DOC-SPEC-VIEW]] |
| 40 | Module resolution — the `@` app alias (v1.42) | [[DOC-SPEC-ANATOMY]] |
| 41 | CLI update notification + `puzzle upgrade` (v1.43) | [[DOC-SPEC-BUILD]] |
| 42 | Interactive `puzzle init` prompts (v1.44) | [[DOC-SPEC-BUILD]] |
| 43 | Compiler accessibility warnings (v1.48) | [[DOC-SPEC-TEMPLATE]] |
| 44 | Router query snapshot + `replace()` (v1.49) | [[DOC-SPEC-ROUTER]] |
| 45 | Route head management (v1.50) | [[DOC-SPEC-ROUTER]] |
| 46 | FLIP keyed-reorder animation: the `flip` directive attribute (v1.51) | [[DOC-SPEC-VIEW]] |
| 47 | The `outside` event modifier: `@event:outside` (v1.52) | [[DOC-SPEC-TEMPLATE]] |
| 48 | Route guards: the `guard` route field (v1.53) | [[DOC-SPEC-ROUTER]] |
| 49 | Adapter request hook: `beforeRequest` (v1.55) | [[DOC-SPEC-DATA]] |
| 50 | Dev build-error reporting (v1.55) | [[DOC-SPEC-BUILD]] |
| 51 | Router focus management + route announcement: `focusBehavior` (v1.56) | [[DOC-SPEC-ROUTER]] |
| 52 | Schema-driven fixtures + the mock adapter (v1.57; self-contained module v1.61) | [[DOC-SPEC-DATA]] |
| 53 | App-author test utilities: `@magic-spells/puzzle/testing` (v1.58) | [[DOC-SPEC-BUILD]] |
| 54 | The `--fixtures` build switch (v1.61) | [[DOC-SPEC-BUILD]] |
| 55 | The DevTools bridge and wire protocol (v1.63) | [[DOC-SPEC-BUILD]] |
| 56 | Dev-only runtime performance profiling + render assertions | [[DOC-SPEC-BUILD]] |
| — | Deferred features (post-v1) | this card |
| — | Open questions (tracked, not blocking) | this card |

## 35. 0.1.0 release hardening (v1.32)

The pre-release hardening bundle (branch fix/pre-0.1.0-hardening): correctness fixes plus three deliberate semantic changes, decided before the API ossifies under external users. Amendments are annotated inline in the sections they change (§4, §6, §20, §22, §27, §34); this section is the index.

**Semantic changes (deliberate):**

- **Two-layer component state** (§4 class contract): `data()` results now REPLACE the model layer wholesale instead of merging forever — omitted keys drop; `setData` state lives in a persistent local layer underneath. Precedence: a `data()` commit beats an earlier `setData`; a later `setData` beats the model until the next commit. Nothing in the shipped examples relied on key accumulation (zero test updates needed).
- **Type-aware validation bounds** (§20): declared `number()`/`date()` fields reject wrong-runtime-type values in `min`/`max` instead of measuring string length.
- **Persisted sync provenance** (§22, §8 wire shape): `_synced` rides out-of-band (`__synced`) in the persistence blob; hydration restores real provenance instead of assuming synced.

**Correctness fixes (no intended semantic surface):** schema object/array defaults deep-clone per record; save-boundary reconciliation guards (destroy-wins, pk-collision refusal — §22); `mounted()` defers to the first landed commit when a prop update supersedes the initial async `data()` (never fires against the placeholder anchor); router-owned mount rejections observed; deferred redirect pushes survive a sync commit throw; memory-mode `go()` chains synchronous calls correctly; `beforeUnmount` thenable rejections logged (§34); two-phase HMR restore (§27); formatter fail-soft (invalid decimals/dates/locales/time zones). Compiler: empty/Vue-dotted event names are positioned errors with did-you-mean (§5); failed one-shot builds no longer wipe the last good `dist/` (staging swap); template reads of `<script>`-imported names warn (§6 expression boundary); MixedAttr `key=` suppresses the synthetic key (§28); classname extraction is comment/string-aware; `{#svg}` rejects backslash paths (§18).

**Distribution (new, no runtime change):** `@magic-spells/puzzle` ships a `bin` shim resolving per-platform binary packages (`@magic-spells/puzzle-{darwin-arm64,darwin-x64,linux-x64,linux-arm64}`) from `optionalDependencies` — one `npm install` yields runtime + CLI; release workflow stamps `puzzle --version` via ldflags and publishes platform packages before the root. `go install` remains the unsupported-platform fallback.

## Deferred features (post-v1)

Explicitly out of scope for v1. Docs may describe them only if marked **"Planned — not in v1"**.

- ~~Cross-fade / overlapping route transitions~~ — shipped in v1.24 (§26, D56: opt-in `transitionMode: 'overlap'`, fixed-pin positioning). A per-route/per-view override shipped in v1.30 (§33, D65 — destination-only); a per-NAVIGATION (call-site) override remains deferred.
- ~~Named slots~~ — shipped in v1.21 (§24, D53); scoped slots remain deferred. (Event modifiers, `{#unless}`, and multi-branch `{#case}` shipped in v1.7 — D36/D37/D38; the `{#switch}` name was rejected in favor of `{#case}`.)
- ~~Scoped styles (`<style scoped>`)~~ — shipped in v1.27 (§29, D59: native `@scope` wrapping, root-stamped attribute). A hard child boundary (`to (…)`) remains deferred on top of it.
- ~~Schema validation enforcement, relationships~~ — both shipped: validation enforcement in v1.16 (§20, D48), `hasMany`/`belongsTo` resolution in v1.17 (§21, D49)
- ~~Adapter write sync, custom adapter methods~~ — shipped in v1.18 (§22, D50: `save()`/`delete()`/`store.request()`). Query fault-in remains deferred (re-affirmed in D50).
- App-level `settings`, `computed`, global `events`, `methods` — re-rejected at the D60 triage (module constants / singleton store records / view-scoped listeners cover the observed demand). ~~App lifecycle hooks~~ — shipped in v1.28 (§30, D60: `beforeMount`/`mounted`/`beforeUnmount` on the config).
- Global event bus (`this.$events`), `ctx.utils`, devtools hook — re-rejected at the D60 triage (singleton store records are the bus; the 3-service ctx is a selling point; `window.__PUZZLE_APP__` covers dev introspection, D57). The D60 rejection was of an **app-config** hook and still stands; the D100 DevTools bridge (§55) is a different object — a dev-only wire protocol with no config surface and no production bytes.
- Virtual scrolling
- ~~HMR~~ — shipped in v1.25 as a state-preserving dev reload (§27, D57). Per-module hot swap (patching a changed component without a reload) remains deferred on top of it.
- Element actions (`use:name` directives) — considered at the 2026-07 framework-gap review and deferred: D72 refs already deliver element-lifetime callbacks, view lifecycle covers document-listener patterns, and the dominant dismiss-behavior case shipped as the `@event:outside` modifier (v1.52, §47/D86) — which further narrows what an action system would add. If real pressure appears, the intended shape is dynamic function refs (`ref={ expr }` on the §31 handler cache), not a new directive namespace.
- `<Portal>` — considered at the same review and deferred: §26's containing-block contract already keeps `position: fixed` overlays reliable, the native top layer (`<dialog>.showModal()`, `popover`) covers modals/popovers on our ES2022 floor, and a portal entangles the one-animator transition, overlap pinning, morph scanning, and SSG inline serialization. Document the native pattern instead.
- A **`puzzle dev` mock API server** (`dev: { mock: … }`, the long-standing open question below) — considered alongside D95 and deferred once the client-side mock adapter shipped. The adapter intercepts at the Store's fetch seam, so it needs no server and behaves **identically in `puzzle dev` and in Vitest**, which a dev-server mock structurally cannot. Shipping both would mean two overlapping mechanisms with different reach. The case a server uniquely serves — mocking plain `fetch` calls that never go through an adapter, and seeing the traffic in the network tab — is real but thin. Revisit if it comes up; `dev.proxy`'s config block and handler-chain registration are the seam it would use.
- An **async `beforeRequest`** (§49, D91) — the obvious next ask is inline token refresh, but awaiting the hook puts an `await` in front of every adapter call and needs a story for coalescing concurrent refreshes against the §22 per-record save chain. Refresh arguably belongs in a wrapper around the verb. Widening sync→async later is compatible; narrowing is not. A whole-`fetch` override (`options.fetch`) is deferred on the same grounds — strictly more powerful, but it hands the app the entire request contract and lets a bad implementation break the §22 guards silently.
- Lazy route views + code splitting + link preloading — real for large apps, but Puzzle bundles are small enough that the pressure is weak today, and it undercuts the §16 skeleton story (a skeleton cannot render before its module arrives). Deserves its own release; static mode's per-page splitting is the in-repo precedent. (Also listed at §36.)

## Open questions (tracked, not blocking)

- `Puzzle.string()` vs a dedicated `t.string()`/`field.string()` namespace if `Puzzle` ever needs app-level statics. Starting with `Puzzle.*`.
- ~~Whether `puzzle dev` should also serve `/api` mocks for adapter development~~ — answered by D95: the client-side mock adapter needs no server and works identically in dev and Vitest. A dev-server mock stays deferred (see the cut list).
