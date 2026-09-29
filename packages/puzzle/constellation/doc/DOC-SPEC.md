---
name: SPEC — the contract's section index, §35, and the cut list
status: verified
verified_at: '2026-08-14T05:01:26.637Z'
connections:
  - DOC-VIEW-LIFECYCLE
  - DECISION-D144-PORTAL
verified_sha: d74916a0e021b6bb86394551171838fbab161347
---

The enforceable v1 contract: exports/naming, config surface, .pzl anatomy, real-JS scripts rule, event conventions, template grammar, models/store/router surfaces, and the deferred-features cut list. When docs conflict, SPEC wins.

# Puzzle v1 Specification

**The contract.** Where any other document (README, user guides, CLAUDE.md, examples) conflicts with the SPEC, the SPEC wins. `examples/todos/` is the canonical reference application; `examples/blog/` is the second reference app.

## Section index

The contract is split across six domain cards; this card is the entry point. Section numbers are global and never change — `§22` is `§22` whichever card holds it — so the `§N` citations in other cards and in `client-runtime/` / `compiler/` / `puzzle-lang/` comments stay valid. A reader following a `§N` citation starts here. Which sections are Puzzle language core and which are the PuzzleKit dialect is mapped on [[DOC-LANGUAGE-CORE]] (D172).

| § | Section | Card |
| --- | --- | --- |
| 1 | Naming & entry points | [[DOC-SPEC-ANATOMY]] |
| 2 | App configuration | [[DOC-SPEC-ANATOMY]] |
| 3 | `.pzl` file anatomy | [[DOC-SPEC-ANATOMY]] |
| 4 | `<script>` blocks are real JavaScript | [[DOC-SPEC-ANATOMY]] |
| 5 | Event handler convention | [[DOC-SPEC-TEMPLATE]] |
| 6 | Template grammar | [[DOC-SPEC-TEMPLATE]] |
| 7 | Models & schema builders | [[DOC-SPEC-DATA]] |
| 8 | Store | [[DOC-SPEC-DATA]] |
| 9 | Router | [[DOC-SPEC-ROUTER]] |
| 10 | Component context | [[DOC-SPEC-ANATOMY]] |
| 11 | Project layout & build | [[DOC-SPEC-ANATOMY]] |
| 12 | Animations | [[DOC-SPEC-VIEW]] |
| 13 | CLI tooling | [[DOC-SPEC-BUILD]] |
| 14 | Router scroll behavior | [[DOC-SPEC-ROUTER]] |
| 15 | Hash routing | [[DOC-SPEC-ROUTER]] |
| 16 | Skeleton loading | [[DOC-SPEC-VIEW]] |
| 17 | DOM islands | [[DOC-SPEC-TEMPLATE]] |
| 18 | Inline SVG assets: `{#svg}` | [[DOC-SPEC-TEMPLATE]] |
| 19 | Route snapshot in `data()`: `this.route` | [[DOC-SPEC-ROUTER]] |
| 20 | Schema validation enforcement | [[DOC-SPEC-DATA]] |
| 21 | Model relationships: `hasMany` / `belongsTo` | [[DOC-SPEC-DATA]] |
| 22 | Adapter write sync | [[DOC-SPEC-DATA]] |
| 23 | Router base path | [[DOC-SPEC-ROUTER]] |
| 24 | Composition markers: `<Children>`, `<Slot>`, `<Slot name>` | [[DOC-SPEC-TEMPLATE]] |
| 25 | TypeScript scripts: `<script lang="ts">` | [[DOC-SPEC-ANATOMY]] |
| 26 | Overlapping route transitions | [[DOC-SPEC-ROUTER]] |
| 27 | Dev HMR: state-preserving reload | [[DOC-SPEC-BUILD]] |
| 28 | List keying and row caching | [[DOC-SPEC-TEMPLATE]] |
| 29 | Scoped styles: `<style scoped>` | [[DOC-SPEC-ANATOMY]] |
| 30 | Atomic location commit | [[DOC-SPEC-ROUTER]] |
| 31 | Cached event handlers | [[DOC-SPEC-TEMPLATE]] |
| 32 | `this.memo()` — reference-stable derived values | [[DOC-SPEC-VIEW]] |
| 33 | Per-route / per-view transition mode | [[DOC-SPEC-ROUTER]] |
| 34 | App lifecycle hooks | [[DOC-SPEC-VIEW]] |
| 35 | 0.1.0 hardening rules | this card |
| 36 | Static output — `output: 'hybrid' \| 'static'` | [[DOC-SPEC-BUILD]] |
| 37 | Cross-view morphs | [[DOC-SPEC-VIEW]] |
| 38 | Element refs — `ref="name"` → `this.refs` | [[DOC-SPEC-VIEW]] |
| 39 | Scroll-triggered enter animations — `trigger: 'visible'` | [[DOC-SPEC-VIEW]] |
| 40 | Module resolution — the `@` app alias | [[DOC-SPEC-ANATOMY]] |
| 41 | CLI update notification + `puzzle upgrade` | [[DOC-SPEC-BUILD]] |
| 42 | Interactive `puzzle init` prompts | [[DOC-SPEC-BUILD]] |
| 43 | Compiler accessibility warnings | [[DOC-SPEC-TEMPLATE]] |
| 44 | Router query snapshot + `replace()` | [[DOC-SPEC-ROUTER]] |
| 45 | Route head management | [[DOC-SPEC-ROUTER]] |
| 46 | FLIP keyed-reorder animation: `flip` | [[DOC-SPEC-VIEW]] |
| 47 | The `outside` event modifier | [[DOC-SPEC-TEMPLATE]] |
| 48 | Route guards: `guard` | [[DOC-SPEC-ROUTER]] |
| 49 | Adapter request hook: `beforeRequest` | [[DOC-SPEC-DATA]] |
| 50 | Dev build-error reporting | [[DOC-SPEC-BUILD]] |
| 51 | Router focus management + route announcement | [[DOC-SPEC-ROUTER]] |
| 52 | Schema-driven fixtures + the mock adapter | [[DOC-SPEC-DATA]] |
| 53 | App-author test utilities: `@magic-spells/puzzle/testing` | [[DOC-SPEC-BUILD]] |
| 54 | The `--fixtures` build switch | [[DOC-SPEC-BUILD]] |
| 55 | The DevTools bridge and wire protocol | [[DOC-SPEC-BUILD]] |
| 56 | Dev-only runtime performance profiling + render assertions | [[DOC-SPEC-BUILD]] |
| 57 | Raw template blocks: `{#raw}…{/raw}` | [[DOC-SPEC-TEMPLATE]] |
| 58 | Opt-in server adapter subpath | [[DOC-SPEC-DATA]] |
| 59 | Opt-in SPA code splitting — `build.splitting` | [[DOC-SPEC-BUILD]] |
| 60 | App-level error handling: `onError` + `errorView` | [[DOC-SPEC-VIEW]] |
| 61 | Auto-fetching finds: tracked fault-in and the settle loop | [[DOC-SPEC-DATA]] |
| 62 | Lazy route views: `lazy()` | [[DOC-SPEC-ROUTER]] |
| 63 | `puzzle check`: type-checking `.pzl` with the app's own tsc | [[DOC-SPEC-BUILD]] |
| 64 | Snippets: `<Snippet>` + marker arguments | [[DOC-SPEC-TEMPLATE]] |
| 65 | Component families: dotted component tags | [[DOC-SPEC-TEMPLATE]] |
| 66 | Translations: the `t` function and `ctx.i18n` | [[DOC-SPEC-TEMPLATE]] |
| — | Deferred features | this card |
| — | Open questions | this card |

## 35. 0.1.0 hardening rules

Rules fixed before the API ossified; each is stated in full in the section it belongs to (§4, §20, §22, §27, §34), and this section is their index.

- **Two-layer component state** (§4): a `data()` result replaces the model layer wholesale (omitted keys drop); `setData` writes a persistent local layer underneath. A `data()` commit beats an earlier `setData`; a later `setData` beats the model until the next commit.
- **Type-aware validation bounds** (§20): declared `number()`/`date()` fields reject wrong-runtime-type values in `min`/`max` instead of measuring string length.
- **Persisted sync provenance** (§22, §8 wire shape): `_synced` rides out-of-band (`__synced`) in the persistence blob; hydration restores real provenance.
- **Store and view correctness:** schema object/array defaults deep-clone per record; save-boundary reconciliation guards (destroy-wins, pk-collision refusal — §22); `mounted()` waits for the first landed commit when a prop update supersedes the initial async `data()`; router-owned mount rejections are observed; deferred redirect pushes survive a sync commit throw; memory-mode `go()` chains synchronous calls; `beforeUnmount` thenable rejections are logged (§34); HMR restore is two-phase (§27); library functions fail soft on invalid decimals, dates, locales and time zones.
- **Compiler:** empty or Vue-dotted event names are positioned errors with did-you-mean (§5); a failed one-shot build keeps the last good `dist/` (staging swap); a template read of a `<script>`-imported name warns (§6); a MixedAttr `key=` suppresses the synthetic key (§28); classname extraction is comment/string-aware; `{#svg}` rejects backslash paths (§18).
- **Distribution:** `@magic-spells/puzzle` ships a `bin` shim that resolves a per-platform binary package (`@magic-spells/puzzle-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}`) from `optionalDependencies`, so one `npm install` yields runtime + CLI. The release stamps `puzzle --version` via ldflags and publishes the platform packages before the root; `go install` is the unsupported-platform fallback.

## Deferred features

Out of scope today. Docs may describe them only when marked **"Planned — not shipped"**.

- **Per-navigation (call-site) transition override.** Per-route/per-view override exists (§33); a call-site one does not.
- **A hard child boundary for scoped styles** (`@scope … to (…)`, §29).
- **App-level `settings`, `computed`, global `events`, `methods`** — rejected: module constants, singleton store records and view-scoped listeners cover the demand.
- **Global event bus (`this.$events`), `ctx.utils`, an app-config devtools hook** — rejected: singleton store records are the bus; the small ctx is a feature; `window.__PUZZLE_APP__` covers dev introspection. The §55 DevTools bridge is a different thing (dev-only wire protocol, no config surface, no production bytes).
- **Framework-owned virtual scrolling.** Out of scope; a piece can own one through §64 snippets.
- **Per-module hot swap** on top of the §27 state-preserving reload.
- **Element actions (`use:name`).** Refs (§38), view lifecycle and `@event:outside` (§47) cover the cases; if pressure appears, the intended shape is dynamic function refs (`ref={ expr }` on the §31 handler cache), not a new directive namespace.
- **User-placed `<Portal>` outlets** (`to`/`name` — reserved compile errors today). `<dialog>.showModal()` stays the tool for focus-trapped modals ([[DECISION-D144-PORTAL]]).
- **A `puzzle dev` mock API server.** The client-side mock adapter (§52) intercepts at the store's fetch seam and behaves identically in `puzzle dev` and Vitest, which a server cannot; a server would only add mocking of plain `fetch` calls. `dev.proxy`'s handler chain is the seam if it comes back.
- **Async `beforeRequest` and an `options.fetch` override** (§49). Awaiting the hook puts an `await` before every adapter call and needs a coalescing story against the §22 per-record save chain; a whole-fetch override lets a bad implementation silently break the §22 guards. Widening sync→async later stays compatible.
- **Server-side query/pagination keys, TTL invalidation, relationship fault-in** on top of §61.
- **Link preloading** (prefetching a route's chunk on hover or viewport entry) on top of §59/§62.
- **Editor-level `.pzl` type checking** (language service / LSP). Existing implementations sit on the TypeScript 6 compiler API, which this project will not depend on; revisit when the TypeScript 7 tooling API ships. `puzzle check` (§63) is the shipped checker.

## Open questions

- `Puzzle.string()` vs a dedicated `t.string()`/`field.string()` namespace if `Puzzle` ever needs app-level statics. Starting with `Puzzle.*`.
