---
name: SPEC — the contract's section index, §35, and the deferred list
status: verified
connections:
  - DOC-SPEC-ANATOMY
  - DOC-SPEC-TEMPLATE
  - DOC-SPEC-VIEW
  - DOC-SPEC-DATA
  - DOC-SPEC-ROUTER
  - DOC-SPEC-BUILD
  - DOC-LANGUAGE-CORE
  - DOC-RELEASE-SURFACE
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D120-TARBALL-PUBLISH
  - DECISION-D144-PORTAL
  - DECISION-D180-COMPONENT-SLOT
verified_at: '2026-11-01T19:28:56.040Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Puzzle specification

**The contract.** Where any other document (README, guides, CLAUDE.md, examples) conflicts with the SPEC, the SPEC wins. `examples/todos/` is the canonical reference app; `examples/blog/` is the second.

## Section index

The contract is split across six chapter cards; this card is the entry point. Section numbers are global and never change — `§22` is `§22` whichever card holds it — because `§N` citations in other cards and in `client-runtime/`, `compiler/` and `puzzle-lang/` comments depend on them. New sections take the next number. [[DOC-LANGUAGE-CORE]] maps which sections are Puzzle language core and which are the PuzzleKit dialect ([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]).

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
| 15 | Router modes: hash and memory | [[DOC-SPEC-ROUTER]] |
| 16 | Skeleton loading | [[DOC-SPEC-VIEW]] |
| 17 | DOM islands | [[DOC-SPEC-TEMPLATE]] |
| 18 | Inline SVG assets: `{#svg}` | [[DOC-SPEC-TEMPLATE]] |
| 19 | Route snapshot in `data()`: `this.route` | [[DOC-SPEC-ROUTER]] |
| 20 | Schema validation enforcement | [[DOC-SPEC-DATA]] |
| 21 | Model relationships: `hasMany` / `belongsTo` | [[DOC-SPEC-DATA]] |
| 22 | Adapter write sync | [[DOC-SPEC-DATA]] |
| 23 | Router base path | [[DOC-SPEC-ROUTER]] |
| 24 | Composition markers: `<Children>`, `<Slot>`, `<Slot name>` (and `<Portal>`) | [[DOC-SPEC-TEMPLATE]] |
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
| 35 | Cross-cutting rules and distribution | this card |
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
| 61 | Auto-fetching finds: tracked fetch and the settle loop | [[DOC-SPEC-DATA]] |
| 62 | Lazy route views: `lazy()` | [[DOC-SPEC-ROUTER]] |
| 63 | `puzzle check`: type-checking `.pzl` with the app's own tsc | [[DOC-SPEC-BUILD]] |
| 64 | Snippets: `<Snippet>` + marker arguments | [[DOC-SPEC-TEMPLATE]] |
| 65 | Component families: dotted component tags | [[DOC-SPEC-TEMPLATE]] |
| 66 | Translations: the `t` function and `ctx.i18n` | [[DOC-SPEC-TEMPLATE]] |
| 67 | Runtime component selection: `<Component>` | [[DOC-SPEC-TEMPLATE]] |
| — | Deferred features | this card |
| — | Open questions | this card |

## 35. Cross-cutting rules and distribution

Rules that span several sections. Each is stated in full where it belongs; this list is the cross-reference.

- **Two-layer component state** (§4): a `data()` result replaces the model layer wholesale (omitted keys drop); `setData` writes a persistent local layer underneath. A `data()` commit beats an earlier `setData`; a later `setData` beats the model until the next commit.
- **Type-aware validation bounds** (§20): `number()`/`date()` fields reject wrong-type values in `min`/`max` instead of measuring string length.
- **Persisted sync provenance** (§22, §8): `_synced` rides out of band (`__synced`) in the persistence blob; hydration restores it.
- **Save-boundary guards** (§22): destroy wins over an in-flight save; a server pk that collides with another record is refused. Schema object/array defaults deep-clone per record.
- **Failure handling:** library functions fail soft on invalid decimals, dates, locales and time zones; `beforeUnmount` thenable rejections are logged (§34); a failed one-shot build keeps the last good `dist/` (§13).
- **Distribution:** `@magic-spells/puzzle` ships a `bin` shim (`bin/puzzle.js`) that resolves the per-platform binary package (`@magic-spells/puzzle-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,win32-x64}`; Windows on ARM maps to `win32-x64`) from `optionalDependencies`, so one `npm install` yields runtime + CLI. The release stamps the version into the binary with `-ldflags` and publishes the platform packages before the root ([[DECISION-D120-TARBALL-PUBLISH]]). `go install` is the fallback for unsupported platforms.

## Deferred features

Out of scope today. Docs may describe them only when marked **"Planned — not shipped"**. Rejected items stay listed so they are not re-proposed without new evidence.

- **Per-navigation (call-site) transition override.** Per-route/per-view override exists (§33).
- **A hard child boundary for scoped styles** (`@scope … to (…)`, §29).
- **App-level `settings`, `computed`, global `events`, `methods`** — rejected: module constants, singleton store records and view-scoped listeners cover them.
- **Global event bus (`this.$events`), `ctx.utils`, an app-config devtools hook** — rejected: singleton store records are the bus; the small ctx is a feature; `window.__PUZZLE_APP__` covers dev introspection. The §55 DevTools bridge is separate (dev-only, no config surface, no production bytes).
- **Framework-owned virtual scrolling** — out of scope; a piece can own one through §64 snippets.
- **Per-module hot swap** on top of the §27 state-preserving reload.
- **Element actions (`use:name`).** Refs (§38), lifecycle and `@event:outside` (§47) cover the cases. If pressure appears, the intended shape is dynamic function refs (`ref={ expr }` on the §31 handler cache), not a new directive namespace.
- **Named `<Portal>` outlets.** `<Portal>` takes no attributes today; `to`/`name` are compile errors. `<dialog>.showModal()` stays the tool for focus-trapped modals ([[DECISION-D144-PORTAL]]).
- **A `puzzle dev` mock API server** — rejected: the §52 mock adapter intercepts at the store's fetch seam and behaves the same in `puzzle dev` and Vitest; a server would only add mocking of plain `fetch` calls. `dev.proxy`'s handler chain is the seam if it comes back.
- **Async `beforeRequest` and an `options.fetch` override** (§49). Awaiting the hook puts an `await` before every adapter call and needs a coalescing story against the §22 per-record save chain; a whole-fetch override lets a bad implementation silently break the §22 guards. Widening sync → async later stays compatible.
- **Server-side query/pagination keys, TTL invalidation, relationship fault-in** on top of §61.
- **Link preloading** (prefetching a route's chunk on hover or viewport entry) on top of §59/§62.
- **Editor-level `.pzl` type checking** (language service / LSP). Waits for the TypeScript 7 tooling API; nothing builds on TypeScript 6-era compiler APIs. `puzzle check` (§63) is the shipped checker.
- **Open-ended dynamic module resolution** (`<component is="module-name">`, registries, lazy manifests) — rejected. `<Component>` (§67, [[DECISION-D180-COMPONENT-SLOT]]) selects only constructors its file already imports.

## Open questions

- `Puzzle.string()` vs a dedicated `t.string()`/`field.string()` namespace if `Puzzle` ever needs app-level statics. Starting with `Puzzle.*`.
