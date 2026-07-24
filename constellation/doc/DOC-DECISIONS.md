---
name: DECISIONS.md — decision-log index (D1–D89)
status: verified
verified_at: '2026-07-24T05:49:35.947Z'
connections:
  - DOC-SPEC
verified_sha: d9591d6e01cb9c358acfa4d641174d08e1f05b23
---

Index of the ADR-lite decision log. Each decision D1–D89 now lives as its own DECISION card (full context, rationale, rejected alternatives); this card is the numeric index. [[DOC-SPEC]] is the enforceable contract — every SPEC change requires a new decision card, numbered here.

# Decision Log (index)

Running log of architectural decisions. **Each decision is a DECISION card** —
the cards carry the full Context / Decision / Alternatives / Consequences;
this index maps the historical D-numbers to them. Append new decisions as new
`DECISION-D<nn>-…` cards with the next number and add them here. Do not
renumber or delete entries; mark superseded decisions with the `supersedes`
field on the successor card.

[[DOC-SPEC]] is the enforceable contract; the decision cards record **why**.

## Founding & v1 contract

- **D1** [[DECISION-D01-SPA-ONLY]] — SPA-only, client-side-rendering framework
- **D2** [[DECISION-D02-CLASS-COMPONENTS]] — class-based components; `Puzzle.createView` removed
- **D3** [[DECISION-D03-SCRIPTS-REAL-JS]] — `<script>` blocks are real JavaScript (the most consequential decision in the project)
- **D4** [[DECISION-D04-EVENT-HANDLER-CONVENTION]] — bare identifier vs call expression in `@event`
- **D5** [[DECISION-D05-SCHEMA-BUILDERS]] — schema via `Puzzle.*` field builders
- **D6** [[DECISION-D06-COMPUTED-GETTERS]] — model computed properties are plain getters
- **D7** [[DECISION-D07-NAMING]] — `PuzzleApp`, `app.mount()`, "formatters"
- **D8** [[DECISION-D08-MINIMAL-CONFIG]] — minimal v1 config surface
- **D9** [[DECISION-D09-GO-ESBUILD-COMPILER]] — compiler is Go + an esbuild `onLoad` plugin
- **D10** [[DECISION-D10-PROTOTYPE-RENDER]] — generated `render()` attached via prototype assignment
- **D11** [[DECISION-D11-PROJECT-LAYOUT]] — `app/` source, `dist/` output
- **D12** [[DECISION-D12-TAILWIND-FIRST]] — Tailwind-first styling; `<style>` is global CSS in v1
- **D13** [[DECISION-D13-CLI-DEV-BUILD]] — CLI v1 is `puzzle dev` + `puzzle build`; build defaults to production
- **D14** [[DECISION-D14-TODOS-MILESTONE]] — the v1 milestone is the todos app, end-to-end
- **D15** [[DECISION-D15-PLAIN-CLASS-VIEW]] — `PuzzleView` is a plain class, not a web component
- **D16** [[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]] — default composition + callback props; no `$emit` (marker respelled by D74)
- **D17** [[DECISION-D17-RENDER-FUNCTIONS-VDOM]] — compiled render functions + runtime virtual DOM; no shadow DOM
- **D18** [[DECISION-D18-PER-NODE-LISTENERS]] — per-node event listeners; document delegation rejected for v1
- **D19** [[DECISION-D19-NAVIGATION-COMMIT]] — commit-ordered URL, nav tokens, catch-all 404, layout reuse
- **D20** [[DECISION-D20-PUZZLE-VIEW-ELEMENT]] — `<puzzle-view>` element for views/layouts only; components render inline
- **D21** [[DECISION-D21-ADAPTER-READ-PATH]] — server data via explicit load methods reading the model's adapter
- **D22** [[DECISION-D22-NO-ESCAPE-BY-DEFAULT]] — interpolation safety under the vdom; no escape-by-default
- **D23** [[DECISION-D23-REFRESH-PATTERN]] — derived-from-local-UI state re-runs `data()` via `this.refresh()`
- **D24** [[DECISION-D24-CLASS-NAME-EXTRACTION]] — compiled component name from the `export default class` declaration
- **D25** [[DECISION-D25-BARE-FORMATTER-CALLS]] — formatter calls compile to bare `__f.name(...)`; `__missing` deferred

## Build & tooling (Phase 3+)

- **D26** [[DECISION-D26-TAILWIND-PIPELINE]] — node-read config, one-shot-per-build CLI, unified composition
- **D27** [[DECISION-D27-FAST-DEV-REBUILDS]] — direct CLI resolution + warm Tailwind watcher + esbuild incremental context (amends D26)
- **D27b** [[DECISION-D27B-BLOG-EXAMPLE]] — `examples/blog/` replaces the deprecated `example-app/` *(the log historically numbered two entries D27)*
- **D31** [[DECISION-D31-FORMATTER-TREESHAKE]] — compile-time formatter tree-shaking: manifest-seeded registry
- **D35** [[DECISION-D35-NO-SASS]] — no Sass support, ever

## Shipped amendments (v1.1–v1.47)


Each shipped as an additive amendment; the corresponding FEATURE card is the
slice-of-work view.

- **D28** [[DECISION-D28-ANIMATIONS]] — view & component animations (v1.1 → [[FEATURE-V1-1-ANIMATIONS]])
- **D29** [[DECISION-D29-LOOP-COUNTER]] — `{#for}` trailing `, name` loop counter (v1.2 → [[FEATURE-V1-2-LOOP-COUNTER]])
- **D30** [[DECISION-D30-NESTED-ROUTES]] — children arrays, chain-prefix reuse, root-only layouts (v1.3 → [[FEATURE-V1-3-NESTED-ROUTES]])
- **D32** [[DECISION-D32-CLI-TOOLING]] — init/generate/add/doctor/info (v1.4 → [[FEATURE-V1-4-CLI-TOOLING]])
- **D33** [[DECISION-D33-ROUTER-SCROLL]] — router-owned window scroll (v1.5 → [[FEATURE-V1-5-SCROLL-BEHAVIOR]])
- **D34** [[DECISION-D34-HASH-ROUTING]] — opt-in `routerMode: 'hash'` (v1.6 → [[FEATURE-V1-6-HASH-ROUTING]])
- **D36** [[DECISION-D36-UNLESS]] — `{#unless}` inverted conditional (v1.7 → [[FEATURE-V1-7-TEMPLATE-EVENT-GRAMMAR]])
- **D37** [[DECISION-D37-CASE-WHEN]] — `{#case}`/`{:when}` multi-branch block (v1.7 → [[FEATURE-V1-7-TEMPLATE-EVENT-GRAMMAR]])
- **D38** [[DECISION-D38-EVENT-MODIFIERS]] — `@event:modifier={...}` (v1.7 → [[FEATURE-V1-7-TEMPLATE-EVENT-GRAMMAR]])
- **D39** [[DECISION-D39-SKELETON]] — `<puzzle-skeleton>` loading templates (v1.8 → [[FEATURE-V1-8-SKELETONS]])
- **D40** [[DECISION-D40-ELSE-IF]] — `{:else if}` conditional chaining (v1.9 → [[FEATURE-V1-9-ELSE-IF]])
- **D41** [[DECISION-D41-SCROLL-ANCHORS-PERSISTENCE]] — anchor-target scrolling + sessionStorage scroll persistence (v1.10 → [[FEATURE-V1-10-SCROLL-FOLLOWUPS]])
- **D42** [[DECISION-D42-MEMORY-MODE]] — `routerMode: 'memory'` + go/back/forward API (v1.11 → [[FEATURE-V1-11-MEMORY-MODE]])
- **D43** [[DECISION-D43-FORMATTER-MISSING-GUARD]] — the `__missing` formatter typo-guard, superseding the D25 deferral (v1.12 → [[FEATURE-V1-12-FORMATTER-GUARD]])
- **D44** [[DECISION-D44-DOM-ISLANDS]] — the `island` DOM-ownership attribute (v1.13 → [[FEATURE-V1-13-DOM-ISLANDS]])
- **D45** [[DECISION-D45-BACKSPACE-DELETE-FILTERS]] — `backspace`/`delete` key filters (v1.13 → [[FEATURE-V1-13-DOM-ISLANDS]])
- **D46** [[DECISION-D46-INLINE-SVG]] — `{#svg 'path'}` compile-time SVG inlining from `app/assets/` (v1.14 → [[FEATURE-V1-14-INLINE-SVG]])
- **D47** [[DECISION-D47-ROUTE-SNAPSHOT]] — per-navigation route snapshot `this.route` through the D19 gate; reuseLayout commit reorder (v1.15 → [[FEATURE-V1-15-ROUTE-SNAPSHOT]])
- **D48** [[DECISION-D48-SCHEMA-VALIDATION]] — schema validation enforces at the local write boundary: throw on write, `{ valid, errors }` to render (v1.16 → [[FEATURE-SCHEMA-VALIDATION]])
- **D49** [[DECISION-D49-MODEL-RELATIONSHIPS]] — `hasMany`/`belongsTo` resolve as lazy store-backed getters with FK-by-convention (v1.17 → [[FEATURE-MODEL-RELATIONSHIPS]])
- **D50** [[DECISION-D50-ADAPTER-WRITE-SYNC]] — adapter write path: explicit `save()`/`delete()` verbs, local-first, validate-before-sync (v1.18 → [[FEATURE-ADAPTER-WRITE-SYNC]])
- **D51** [[DECISION-D51-ROUTER-BASE-PATH]] — one `routerBase` applied at the path-shape boundary: pathname prefix (history), in-fragment prefix (hash), inert (memory) (v1.19 → [[FEATURE-ROUTER-BASE-PATH]])
- **D52** [[DECISION-D52-SKELETON-ANTIFLASH]] — skeleton anti-flash: opt-in `min-duration` hold; the error slot resolves won't-build (v1.20 → [[FEATURE-SKELETON-FOLLOWUPS]])
- **D53** [[DECISION-D53-NAMED-SLOTS]] — named slots: `<slot name>` with fallbacks, filled by `slot="…"` attributes on direct component children (v1.21 → [[FEATURE-NAMED-SLOTS]])
- **D54** [[DECISION-D54-TYPESCRIPT-SCRIPTS]] — `<script lang="ts">` TypeScript, transpile-only via esbuild; `.pzl` stays the only extension (v1.22 → [[FEATURE-TYPESCRIPT-SCRIPTS]])
- **D55** [[DECISION-D55-MORPH-TRANSITIONS]] — shared-element morph route transitions: `data-puzzle-morph` identity pairing + one router morph-handler slot; engine stays an optional peer (v1.23 → [[FEATURE-MORPH-TRANSITIONS]])
- **D56** [[DECISION-D56-OVERLAP-TRANSITIONS]] — overlapping route transitions: opt-in `transitionMode: 'overlap'`, fixed-pin positioning keeps D28's no-wrapper rule (v1.24 → [[FEATURE-OVERLAPPING-TRANSITIONS]])
- **D57** [[DECISION-D57-HMR-STATE-RELOAD]] — HMR as a state-preserving dev reload: snapshot/restore across the SSE reload, per-module swap explicitly not built (v1.25 → [[FEATURE-HMR]])
- **D58** [[DECISION-D58-LIST-KEYING]] — list keying: pk-aware `ViewNode.keyOf` auto-key, explicit `key={…}` overrides instead of doubling, null keys warn once (v1.26 → [[FEATURE-V1-26-LIST-KEYING]])
- **D59** [[DECISION-D59-SCOPED-STYLES]] — `<style scoped>` via native `@scope` wrapping + one root-stamped attribute; the compiler still never parses CSS (v1.27 → [[FEATURE-SCOPED-STYLES]])
- **D60** [[DECISION-D60-DROP-CONSOLE-OPT-OUT]] — production console-strip becomes opt-out: `build: { dropConsole: false }` in puzzle.config.js keeps user console calls; default (strip) unchanged, dev builds never strip
- **D61** [[DECISION-D61-ATOMIC-LOCATION-COMMIT]] — URL/history/title commit atomically with the incoming mount, inside #swap's commit window after the out phase + token checks; restores D19's stated atomicity, closes the phantom-history-entry and URL/view-divergence holes (v1.28 → SPEC §30)
- **D62** [[DECISION-D62-HANDLER-CACHING]] — data-independent `@event` handlers emit per-instance cached closures (`this.__h`); component callback props stop defeating shallowEqual, cached DOM listener sites stop rebinding per patch (v1.29 → [[FEATURE-V1-29-COMPOSITION-FIXES]], SPEC §31)
- **D63** [[DECISION-D63-HIDDEN-TAB-FLUSH]] — store flush keeps rAF primary but gains a `document.hidden` schedule branch + fallback timer; hidden-tab apps deliver (throttled) instead of freezing (v1.29 → [[FEATURE-V1-29-COMPOSITION-FIXES]])
- **D64** [[DECISION-D64-MEMO-HELPER]] — `this.memo(key, deps, factory)`: per-instance reference-stable derived values, the blessed idiom for object/array props under shallowEqual (v1.29 → [[FEATURE-V1-29-COMPOSITION-FIXES]], SPEC §32)
- **D65** [[DECISION-D65-PER-ROUTE-TRANSITION-MODE]] — per-route/per-view `transitionMode` override, resolved destination-only (route field → view/layout field → app default), amends D56 (v1.30 → SPEC §33)
- **D66** [[DECISION-D66-APP-LIFECYCLE-HOOKS]] — app lifecycle hooks `beforeMount`/`mounted`/`beforeUnmount` on the config; the FEATURE-APP-SURFACE triage re-rejects the rest of the umbrella (v1.31 → SPEC §34, [[FEATURE-APP-SURFACE]])
- **D67** [[DECISION-D67-SSG-STATIC-BUILD]] — static site generation as an additive build output mode: `puzzle build --static` prerenders per-route HTML via a ViewNode serializer + node prerender step, router takeover at nav #0; amends D1's scope, not its architecture (v1.33 → SPEC §36, [[FEATURE-V1-33-SSG]])
- **D68** [[DECISION-D68-CROSS-VIEW-MORPH]] — cross-view morphs: enableMorph captures sibling-swap sources at the router's leave hook and flies a clone at enter (both directions, skeleton-aware, click-candidate pinning for polish); router untouched, amends D55 (v1.35 → SPEC §37, [[FEATURE-V1-35-CROSS-VIEW-MORPH]])
- **D69** [[DECISION-D69-MORPH-ROLES]] — directional morph roles: `data-puzzle-morph-trigger` (launches only) / `data-puzzle-morph-target` (receives only, preferred landing on id collision) alongside symmetric plain `data-puzzle-morph`; trigger→target pairs are forward-only — direction as an element property, not a history property (v1.36 → SPEC §37)
- **D70** [[DECISION-D70-TEMPLATE-COMMENTS]] — template comments: `{## }` inline (brace-depth scan, not string-aware) + `{#comment}…{/comment}` raw-discard block (nestable, can wrap broken markup); both erased at the lexer, text positions only (v1.37 → SPEC §6)
- **D71** [[DECISION-D71-SLOT-FORWARDING]] — default-slot forwarding through a component invocation: `<Card><children/></Card>` in a layout forwards the routed page into Card's default slot (expansion walk descends into call-site children); named markers there are compile errors — decision minted retroactively for the wrapper-layout fix, which had mis-cited D69 (v1.38 → SPEC §24)
- **D72** [[DECISION-D72-ELEMENT-REFS]] — element refs: static `ref="name"` → `this.refs.name`, populated pre-`mounted()`, re-pointed on replacement, guarded-null on removal; compiled to a per-instance cached setter (`this.__ref`), braces form rejected by the expression boundary (v1.39 → SPEC §38)
- **D73** [[DECISION-D73-SCROLL-TRIGGER-ANIMATIONS]] — scroll-triggered enter animations: `trigger: 'visible'` + `triggerOffset` on the `in` spec; paused-WAAPI from-state hold, shared per-rootMargin IntersectionObserver, hook bracket defers to the reveal, every degradation lands on `'mount'` behavior; runtime-only, amends D28 (v1.40 → SPEC §39)
- **D74** [[DECISION-D74-CHILDREN-MARKER]] — `<children/>` replaces the bare `<slot/>`: one role per spelling (`<children/>` default marker with optional fallback, `<slot name>` named-only with `name` required, `<Slot/>` router outlet, bare-only); emission byte-stable (`SLOT_TAG` markers unchanged), runtime/SSG untouched; amends D16/D53/D71 spellings pre-npm-publish (v1.41 → SPEC §24)
- **D75** [[DECISION-D75-IMPORT-ALIAS]] — the `@` app import alias: `@/…` resolves to the app's `app/` directory in every bundle (one esbuild alias entry, segment-boundary matching leaves `@magic-spells/…` untouched); fixed and zero-config, a general `resolve.alias` stays deferred (v1.42 → SPEC §40)
- **D76** [[DECISION-D76-CLI-UPGRADE]] — CLI update notification + `puzzle upgrade`: `build`/`dev` print a cache-first, never-blocking newer-release notice (TTY-only; `CI`/`PUZZLE_NO_UPDATE_CHECK` skip it); `upgrade` detects project/global/manual install context and drives the user's own package manager (lockfile-detected, dep-field preserved, result confirmed) — npm stays the owner of installation, the binary never self-replaces (v1.43 → SPEC §41)
- **D77** [[DECISION-D77-INIT-PROMPTS]] — interactive `puzzle init`: TTY-gated template + TypeScript prompts when the flags are absent (name → template → TS, flags win, non-TTY byte-identical); widens D32's sole prompt exception now that the installed CLI is the only onboarding path — `create-puzzle-app` stays unpublished (v1.44 → SPEC §42)
- **D78** [[DECISION-D78-AGENT-SKILL-DISTRIBUTION]] — agent-skill distribution: the app-builder AI skill lives in-repo (`skills/puzzle/SKILL.md`), is embedded into the binary, and `puzzle add skills` installs it into every detected Claude Code/Codex/Cursor config dir — huh checkbox multi-select on a TTY (all pre-selected), silent install-to-all otherwise, pieces-style `--overwrite`; also fixed `ui.IsTerminal` to a real isatty check (`/dev/null` no longer counts as a TTY) (v1.45 → SPEC §13 amendment)
- **D79** [[DECISION-D79-LINK-FORMATTER]] — path-shaped template links: `router.url(path)` mode-encodes a path-shaped route into the href (`base + path` history, `'#' + base + path` hash, unchanged memory; non-`/` strings pass through), plus a built-in router-bound `link` formatter (`{ path | link }`) registered by PuzzleApp at mount **if absent** (user config wins); closes D34's `<a href>` seam and absorbs D51's history-mode base prefixing — runtime-only, no compiler or §2 config change; hash-mode interceptor deliberately does NOT claim plain `/x` hrefs (v1.46 → SPEC §6/§9/§15)
- **D80** [[DECISION-D80-REGISTRY-ACCEPT-HEADER]] — registry fetch asks for `application/json`: npm 406s the abbreviated install-v1 format on version endpoints, so D76's specified header broke the update notice and `puzzle upgrade` in every release; test registry now emulates the 406 (fix → SPEC §41)
- **D81** [[DECISION-D81-STATIC-PAGES-MODE]] — true static-pages output mode: `output: 'static'` / `--static` now emits per-route HTML with no router, no SPA takeover, and no `app.js` — each page ships a per-page `mountStatic` module importing only its own classes (keyed on new codegen `__pzlModule` stamps), shared runtime split into chunks, build-time data serialized into an inline island and rehydrated client-side; the D67 prerendered-SPA mode is renamed `output: 'hybrid'` / `--hybrid`, byte-identical (v1.47 → SPEC §36 amendment, [[FEATURE-V1-47-STATIC-PAGES]])
- **D82** [[DECISION-D82-A11Y-WARNINGS]] — compiler accessibility warnings: five conservative, positioned, non-fatal template diagnostics (img/input-image `alt`, iframe `title`, `a` `href`, static positive `tabindex`) on the existing `Result.Warnings` channel; any static/dynamic/mixed attr counts as present, template + skeleton scanned; no suppression syntax, no ARIA matrix, generated JS byte-identical (v1.48 → SPEC §43, [[FEATURE-V1-48-A11Y-WARNINGS]])
- **D83** [[DECISION-D83-QUERY-REPLACE]] — router query snapshot + `replace()`: the route snapshot gains `pathname`/`query` (frozen null-proto, `URLSearchParams` decoding, repeated keys → arrays)/`hash`, parsed once per navigation; `replace(path)` mirrors `push()` through the same atomic-commit pipeline via one added boolean (`replaceState` keeping the scroll-entry key; memory `stack[index]` overwrite; scroll untouched by default) — the internal action-enum refactor explicitly rejected (v1.49 → SPEC §44, [[FEATURE-V1-49-QUERY-REPLACE]])
- **D84** [[DECISION-D84-HEAD-MANAGEMENT]] — route head management: reserved `meta` fields `title`/`description`/`canonical`/`socialImage`, per-field leaf→root resolution (`null` suppresses), `data-puzzle-head`-marked managed tags rendered by SSG shell surgery AND the SPA commit path (identity adoption on takeover, memory mode no-op, title-only apps byte-identical); `robots`/`themeColor`, data-derived values, and per-network overrides deferred (v1.50 → SPEC §45, [[FEATURE-V1-50-HEAD-MANAGEMENT]])
- **D85** [[DECISION-D85-FLIP-ATTRIBUTE]] — FLIP keyed-reorder animation via a `flip` directive ATTRIBUTE (bare, or `flip={ flipOptions }` — the object built in data(), inline literals not being template expressions), joining `key`/`island`/`ref` in the directive strip lists — the `animate:flip` syntax namespace rejected for its grammar/tooling ripple; translation-only First/Last measurement around keyed reconciliation, visual-rect capture on rapid reorders, WeakMap-tracked Puzzle-owned animations, reduced-motion/no-WAAPI/no-flip fast paths free (v1.51 → SPEC §46, [[FEATURE-V1-51-FLIP]])
- **D86** [[DECISION-D86-OUTSIDE-MODIFIER]] — the `outside` event modifier: `@event:outside={ handler }` attaches to `document` (CAPTURE phase — immune to unrelated `stopPropagation`, and the opening interaction can never self-dismiss) and gates on `el.contains(event.target)` before every other modifier step; framework-owned cleanup on every removal shape via the D72 `releaseSubtree` walk; event-generic (`@pointerdown:outside`, `@focusin:outside`), one `eventGenericMods` table entry, zero grammar/tooling ripple — retires the hand-rolled pattern 16 puzzle-pieces carry (32 removeEventListener sites); `use:` actions deferral reinforced (v1.52 → SPEC §5/§47, [[FEATURE-V1-52-OUTSIDE-MODIFIER]])
- **D87** [[DECISION-D87-ROUTE-GUARDS]] — route guards: an inherited `guard` route field (`({ to, from, ctx }) => verdict`, any depth — guard the top-level route to lock its layout subtree; children may add stricter guards), run root→leaf sequentially in `#navigate` before any view construction or the D19 load gate, re-run on every matched navigation (params/query-only included), token-checked across awaits; verdicts are return values — `false` blocks, a string path redirects through public `replace()` (denied URL never in history, ten-redirect cycle cap reset on commit), throws follow the data()-failure posture; prerender interplay is warnings-only (hybrid: guarded markup ships publicly, `prerender: false` opts out; static: guards never run) — global `beforeEach`+`meta.requiresAuth`, root-only placement, throw-based redirects, the `auth` field name, and hard prerender enforcement all rejected (v1.53 → SPEC §48, [[FEATURE-V1-53-ROUTE-GUARDS]])
- **D88** [[DECISION-D88-SOURCEMAP-OPT-OUT]] — `build.sourceMap`: production linked source maps become opt-in (default off) for SPA + true-static bundles; dev and the temporary Node prerender bundle keep their maps, the static bundle is stripped by a post-pass; mirrors D60's `build.*` opt-out precedent (0.2.0 hardening → SPEC §36 / build config)

- **D89** [[DECISION-D89-FEATURE-USAGE-TREESHAKE]] — pay-for-what-you-use runtime: a build-time usage scan emits `__PUZZLE_HAS_FLIP__` / `__PUZZLE_HAS_HEAD_TAGS__` esbuild defines that fold inlined runtime probes, so `views/flip.js` and the new `headTags.js` ship only to apps that use them; generalizes D31's per-app inclusion to whole modules via D57's define+DCE mechanism, and splits `head.js` into title core + managed-tag machinery (0.2.0 hardening → SPEC §45 / build pipeline)

## Open questions (tracked, not yet decided)

- `Puzzle.*` vs dedicated builder namespace (see [[DECISION-D05-SCHEMA-BUILDERS]]).
- Whether `puzzle dev` serves `/api` mocks (post-v1).
