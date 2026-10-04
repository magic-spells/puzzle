# Puzzle feature comparison and development priorities

Research date: October 1, 2026. Repository snapshot: `ca8a3e6f`, on `release/0.8.0`.

## Assessment

Puzzle already covers a substantial application framework surface: routing, normalized records, validation, server adapters, templates, composition, motion, localization, testing, and build tooling. It also has **ESLint, Prettier, dedicated editor support, and a full DevTools extension**. These are existing competitive strengths. The strongest opportunities are **completing common developer workflows around those features**: editing and submitting forms, managing server query results, and deploying applications predictably.

Puzzle's product scope is **SPAs and static sites**, as Cory confirmed. Request-time SSR, hydration infrastructure, and framework-owned server actions are outside this roadmap. Their presence in other application frameworks is comparison context, not a Puzzle gap or an audience-expansion recommendation. An event bus, Sass, file-based routing, or more animation features would not be my next investments.

The learning tutorial is **already planned next**, per Cory. The **browser WASM compiler already exists**. Completing the tutorial and live editing experience is delivery of that existing direction, not a recommendation to build another compiler.

## Scope and ranking method

I interpreted “Reave” as **React**. The comparison covers Vue, React, Solid, Ember, and Svelte, distinguishing framework core from official companions, independent libraries, and application frameworks such as Nuxt, Next.js, SolidStart, and SvelteKit. Ember's FastBoot is an addon. Features supplied by these packages are developer expectations in the ecosystem, not necessarily built into the underlying framework.

The list below is ordered by **estimated breadth of developer demand within SPA and static-site development**, from common everyday workflows to specialized capabilities. No survey directly measures demand for this exact list, so the ordering is an informed estimate, not a measured popularity chart. Adjacent positions, especially within the same demand tier, should not be treated as precise. Capability confidence and demand estimates are separate.

Useful evidence from the State of JavaScript 2025 survey:

- Among 10,525 respondents to the build-step question, static typing received 7,891 selections and better development experience 5,460.
- Among 10,623 respondents to the rendering-pattern question, SPA received 9,467 selections, SSR 6,308, and SSG 4,865. These were multiple-choice answers, not mutually exclusive market shares.
- State management and code architecture were the two leading general JavaScript pain points. These broad findings support investment in developer workflows; they do not establish a numerical ranking of forms, context, or caching. [Survey usage results](https://2025.stateofjs.com/en-US/usage/).

The survey's framework commentary also identifies performance, state management, and complexity as recurring problems. Adding every competitor's API could erode Puzzle's simplicity advantage. [Framework results](https://2025.stateofjs.com/en-US/libraries/front-end-frameworks/).

This is a feature and product-direction review, not a security audit or comparative performance benchmark. Presence of tests and docs was verified; production accessibility, documentation usability, and ecosystem integrations were not exhaustively tested.

## Verified baseline: what Puzzle already has

`npm view @magic-spells/puzzle version`, using a temporary npm cache, returned **0.8.0**. The repository has `v0.8.0`, and the working package is also `0.8.0`. The two commits after the tag update release prose. Some `CLAUDE.md` and Constellation release-state paragraphs still describe 0.8.0 as unpublished; this report uses the registry and tag as release ground truth. Those files were not changed.

The frozen [SPEC](../constellation/doc/DOC-SPEC.md), its domain cards, and [release surface](../constellation/doc/DOC-RELEASE-SURFACE.md) establish this inventory:

| Area | Present capabilities | Relevant limits |
| --- | --- | --- |
| Components and templates | Single-file `.pzl`, JS/TS scripts, component families, keyed loops, incremental row/static subtree caching, functions, refs, raw blocks, sanitized HTML | Templates use a deliberately closed JavaScript-shaped grammar; scripts remain real JS/TS |
| Composition | Default children, named slots, fallbacks, parameterized snippets, forwarding, Portal | Snippets have leaf restrictions; Portal uses a framework outlet, not arbitrary named targets |
| Component data | Per-view `data()`, automatic tracked subscriptions, async settlement, persistent local state, memoization, lifecycle | Local `setData()` does not generally rerun `data()` without `refresh()`; direct record assignment is not observed |
| Forms and models | Implicit native two-way binding; schema validation, defaults, primary keys, relationships, record methods | Binding is a selected native-control matrix; it is not a complete form-state system |
| Datastore | Normalized records, local queries, optional persistence, server adapters, auto-fetching finds, concurrent-read deduplication, guarded save reconciliation | Query identities, freshness policies, and offline synchronization remain separate gaps |
| Routing | Nested routes/layouts, path/hash/memory modes, guards, query snapshots, base paths, atomic navigation, scroll restoration, focus/announcement | No named-route navigation or link prefetch |
| Async and errors | Initial skeletons, `onError`, app-configured `errorView` replacing failed views/components, retry, lazy route views/layouts | These do not automatically provide per-query/per-mutation state or independently configured subtree boundaries |
| Motion | WAAPI view/component enter/leave, visible-trigger enters, FLIP, optional morph integration, overlap transitions, reduced-motion handling | Morph/overlap interaction coverage is explicitly experimental |
| Localization and functions | Translation JSON, fallback fill, CLDR plurals, interpolation, locale switching, lazy locale downloads, display/date/number functions, application function registry | Locale-specific static URLs, rich text, RTL automation, and stronger key typing are future work |
| Styles and assets | Tailwind, global CSS, native scoped CSS, public-file copying, compile-time inline SVG from `app/assets/` | No general image processing pipeline or Sass support |
| Output | SPA, hybrid prerender plus SPA takeover, router-free static pages, optional SPA code splitting | No request-time SSR or DOM-adoption hydration; parameterized routes are not automatically enumerated |
| Development tools | Fast Go/esbuild CLI, scaffolding/generation, preview/doctor/info, source maps, build error reporting, state-preserving reload, build profiling | State-preserving reload is a full-page reload |
| Linting and formatting | Dedicated ESLint plugin for `.pzl` JS/TS scripts and section validation; Prettier plugin for JS/TS and CSS formatting while preserving template semantics | Implemented; not a missing-feature recommendation |
| Editor support | Dedicated VS Code, Sublime Text, and Zed integrations for Puzzle syntax and embedded languages; VS Code snippets, completions, hover help, and component-template insertion | Implemented; not a missing-feature recommendation |
| DevTools | Chrome extension with Views, Store, Subscriptions, Router, and Performance panels; state inspection/editing, navigation history, render profiling | Implemented; not a missing-feature recommendation |
| Testing | `/testing`, `/fixtures`, deterministic fixtures and mock adapter; Vitest, Go, type, packaging, and browser checks in the repository | Existing framework checks do not equal a turnkey scaffolded testing workflow for every application |
| Pieces and AI | **102 Piece manifests** in the current registry; themes; agent skills installed/upgraded through CLI | Existing pieces include Field, radio-group, multi-select, and virtual-list: those widgets are not missing |
| Learning and browser compilation | Documentation and examples; existing WASM parser/codegen bridge | Tutorial is planned next; live editor/worker/preview delivery should be tracked separately from the implemented compiler |

Two marketing qualifications matter. The current README reports **21.9 KB gzip for a minimal complete app** and **26.0 KB for the todos app**, rather than a universal 22 KB framework cost. Its approximately 200 ms production build claim is for the todos example on Apple Silicon. Neither is an apples-to-apples benchmark against bare React/Vue/Solid/Svelte rendering runtimes. [README:7–8](../README.md).

The current project term is **template functions**, rather than filters or pipes: 0.8.0 replaced pipe syntax with function calls. [Release surface, function library](../constellation/doc/DOC-RELEASE-SURFACE.md).

Tooling was undercredited in the original assessment. The ESLint and Prettier packages and editor integrations already exist; marketplace/publication status does not make their functionality absent. The developer-tooling category is covered and should not have been ranked as a missing feature. Sources: [ESLint plugin](../../puzzle-eslint/README.md), [Prettier plugin](../../puzzle-prettier/README.md), [DevTools panels](../../puzzle-devtools/README.md), [VS Code](https://github.com/magic-spells/puzzle-vscode), [Sublime Text](https://github.com/magic-spells/puzzle-sublime), [Zed](https://github.com/magic-spells/puzzle-zed). Editor capabilities were checked against the local editor repositories under `editors/` alongside the monorepo.

## How the mature frameworks establish expectations

| Expectation | Vue | React | Solid | Ember | Svelte |
| --- | --- | --- | --- | --- | --- |
| Application routing/data | Vue Router/Pinia companions; query libraries separate | Router/state/query packages or application framework | Solid Router companion with query/actions | Integrated router/services; EmberData companion | SvelteKit routing/load/actions; core state separate |
| Shared dependencies | Core provide/inject | Core Context | Core Context | Core service DI | Core context |
| Forms and async | Native/component bindings; async components | Form actions/status; Suspense/transitions | Resources/Suspense; Router actions | Input/actions; route loading/error substates | Bindings/await/boundaries; Kit form actions |
| Server rendering | Core primitives; Nuxt application stack | React DOM primitives; Next.js or another application stack | Core primitives; SolidStart application stack | FastBoot addon | Core primitives; SvelteKit application stack |
| Development feedback | Language tools, `vue-tsc`, DevTools | TS/JSX tooling, React DevTools | TS/JSX tooling; emerging Start tools | CLI/test conventions, Ember Inspector | Language tools, `svelte-check`, Vite/Kit |

Sources for routing/data: [Vue tooling and ecosystem integrations](https://vuejs.org/guide/scaling-up/tooling), [React application setup](https://react.dev/learn/creating-a-react-app), [Solid Router query](https://docs.solidjs.com/solid-router/reference/data-apis/query), [Ember routing](https://guides.emberjs.com/release/routing/), [SvelteKit loading](https://svelte.dev/docs/kit/load).

Sources for dependency sharing: [Vue](https://vuejs.org/guide/components/provide-inject.html), [React](https://react.dev/reference/react/createContext), [Solid](https://docs.solidjs.com/concepts/context), [Ember](https://guides.emberjs.com/release/services/), [Svelte](https://svelte.dev/docs/svelte/context).

Sources for forms/async: [Vue bindings](https://vuejs.org/guide/essentials/forms.html), [React forms](https://react.dev/reference/react-dom/components/form), [Solid Suspense](https://docs.solidjs.com/reference/components/suspense), [Ember loading/error routes](https://guides.emberjs.com/release/routing/loading-and-error-substates/), [Svelte boundaries](https://svelte.dev/docs/svelte/svelte-boundary), [SvelteKit form actions](https://svelte.dev/docs/kit/form-actions). Vue Suspense remains [experimental](https://vuejs.org/guide/built-ins/suspense.html); React Suspense also needs an appropriate data integration, rather than making any fetch suspensible automatically.

Sources for rendering/tooling: [Vue SSR](https://vuejs.org/guide/scaling-up/ssr.html), [React server APIs](https://react.dev/reference/react-dom/server), [SolidStart](https://docs.solidjs.com/solid-start/v2), [FastBoot](https://fastboot.emberjs.com/), [SvelteKit adapters](https://svelte.dev/docs/kit/adapters), [React DevTools](https://react.dev/learn/react-developer-tools), [Ember Inspector](https://guides.emberjs.com/release/ember-inspector/), [Svelte language tools](https://github.com/sveltejs/language-tools).

Puzzle already supplies several things these ecosystems assemble from additional packages. Conversely, mature ecosystems offer more integration choices, installed tooling, and operational experience. Neither observation means every missing ecosystem feature belongs in Puzzle core.

## Findings ranked from broadest expected demand to narrowest

Demand tiers are estimates for Puzzle's SPA/static-site audience. **Partial** means the foundation exists but the workflow is incomplete. **Missing/deferred** means the capability is explicitly absent or unscheduled. Out-of-scope server rendering is excluded from this ranking. Effort includes design, implementation, tests, and documentation: S = small focused work; M = several focused days; L = substantial work, potentially multiple releases. These are relative estimates, not delivery commitments.

| Rank | Developer expectation | Demand | Puzzle status | Recommended treatment; effort / risk |
| --- | --- | --- | --- | --- |
| 1 | Complete form editing/submission lifecycle | Very broad | Partial; helper unscheduled | Optional forms module plus Pieces integration; L / medium |
| 2 | Server query results, pagination, invalidation, freshness | Broad | Partial; explicitly deferred | Extend optional adapter/query surface; L / high |
| 3 | Environment configuration and predictable deployment | Broad | Partial; deploy presets unscheduled | Verified recipes/presets plus public configuration contract; M / low–medium |
| 4 | Authentication/session integration examples | Broad for applications with accounts | Primitives exist; turnkey integration not established | Reference integration, not a homegrown authentication core; M / medium |
| 5 | Independent async regions and mutation status | Broad | Partial | Optional resource/mutation helpers; M–L / medium–high |
| 6 | Dynamic-route SSG, useful metadata, and content URLs | Broad for content/catalog sites | Partial; path enumeration absent | Build-time route enumeration first; L / medium |
| 7 | Component/module hot updates | Broad during development | Deferred; reload already preserves selected state | Benchmark real editing friction before replacing reload; L / high |
| 8 | Route prefetch | Medium–broad | Explicitly deferred | Chunk-only prefetch before query-aware prefetch; M / medium |
| 9 | Scoped dependency/context provision | Medium–broad in larger component trees | Explicitly unscheduled | Design subtree isolation; L / medium |
| 10 | Component authoring/interoperability conveniences | Medium | Partial, with deliberate restrictions | Validate needs for reusable DOM lifecycles, targeting, and embedding; M–L / medium |
| 11 | General asset imports and optional image optimization | Medium; high for image-heavy sites | Partial | Hashed asset imports, then optional image integration; M–L / medium |
| 12 | Turnkey application testing and isolated component development | Medium | Test primitives exist; full scaffold/integration unverified | Test scaffold and a component sandbox; M / low–medium |
| 13 | Retaining views across navigation | Medium for tabs/editors; lower elsewhere | KeepAlive-style retention unscheduled | Opt-in retention only after lifecycle/cache design; L / high |
| 14 | Content collections and narrow build integrations | Medium for content sites; lower for SPAs | Unscheduled/no public build plugin contract | Content prebuild integration before general plugin API; M–L / medium–high |
| 15 | Locale URLs, multilingual SEO, rich translations, RTL | Narrower overall; high for global public sites | Basic localization exists; extensions planned | Locale URLs/static output first; L / medium–high |
| 16 | Offline write synchronization and conflict handling | Specialized | Persistence exists; offline queue/conflicts excluded | Opt-in adapter only for demonstrated workloads; L / high |

### 1. Forms: drafts, errors, submission, reset

Validation and two-way binding exist. Missing workflow: a form-owned draft that can temporarily contain invalid input, field errors, touched/dirty state, pending submission, server field errors, reset, and accessible integration with native controls and Pieces.

Native automatic binding explicitly excludes radio groups, multiple selects, file inputs, component props, deep paths, and dirty tracking. This does not mean those HTML controls or equivalent Pieces cannot be used: authors provide handlers. A required record field cannot be cleared through validated record binding; the documented workaround is a local draft. [D147:139–152](../constellation/decision/DECISION-D147-IMPLICIT-TWO-WAY-BINDING.md). The forms helper is [unscheduled in the plan:67](../constellation/plan.md); Field already supplies error display/ARIA wiring. [Field.pzl](../../puzzle-pieces/registry/ui/field/Field.pzl). Confidence: **high**.

Build an optional helper, not a mandatory schema-generated form renderer. Keep validation errors on the form, preserving the existing decision against persistent `record.errors`. Mature expectations include submission state in [React](https://react.dev/reference/react-dom/components/form). Puzzle's helper should submit to an application's existing API through its adapters or authored handlers; framework-owned server actions are outside scope.

### 2. Server query lifecycle

Puzzle already deduplicates reads, settles `data()`, normalizes records, and supports explicit `loadMany(type, options)` calls. Transport pagination is possible today. The missing layer is **query-specific result identity and metadata**: separate filtered result sets, cursors/totals, invalidation, freshness, background refresh, and clearly defined cancellation/retry policies.

The SPEC explicitly excludes server-side query/pagination keys, TTL invalidation, request cancellation, and relationship fault-in. [SPEC-DATA:214](../constellation/doc/DOC-SPEC-DATA.md). Collection auto-fetch state is keyed by model type, rather than a full query identity. [adapter.js:347](../client-runtime/datastore/adapter.js). Confidence: **high**.

Start with explicit invalidation and query handles containing result IDs and metadata. Add freshness policies afterward. Preserve normalized record identity and shared-request ownership; aborting a request because one view disappears can break another consumer. This is the kind of workflow provided by independent [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview) and companion [Solid Router query/revalidation](https://docs.solidjs.com/solid-router/reference/data-apis/query). It is not universally a framework-core feature.

### 3–4. Deployment and authenticated applications

**Deployment/public configuration:** Package already documented deployment behavior into tested host recipes: SPA fallback, static 404 handling, base paths, cache headers, lazy-chunk retention, and production API origins. The public config has no first-class environment-mode/injection surface. Config files can execute JavaScript and read Node environment variables; that does not establish a browser environment-variable contract. Evidence: [config.go:38–90](../compiler/internal/config/config.go), [bundle options:56](../compiler/internal/build/options.go), [deploy presets in plan:69](../constellation/plan.md). Confidence: **high** for presets, **medium** for the inferred env workflow gap. [Vite's environment convention](https://vite.dev/guide/env-and-mode) is a useful comparison; exposing values should be deliberately public, not wholesale copying of process environment.

**Authentication:** Route guards, adapters, headers/credentials, and store state already enable client auth flows. A concrete opportunity is a maintained example covering session bootstrap, guarded routes, login/logout, expired-session recovery, and backend authorization. No provider SDK interoperability test was performed; this is an integration proposal, not a claim that authentication is impossible. [SPEC-ROUTER §48](../constellation/doc/DOC-SPEC-ROUTER.md), [SPEC-DATA §49](../constellation/doc/DOC-SPEC-DATA.md). Confidence: **medium**. Async `beforeRequest` is deliberately deferred, so token-refresh recipes must respect the current synchronous contract. Prefer cookie-session/backend or provider SDK integration over building an auth service. [SvelteKit auth guidance](https://svelte.dev/docs/kit/auth).

### 5–8. Async UX and navigation

**Independent async/mutations:** Skeletons and error views cover important cases, including failed components. They do not supply named resource handles, mutation pending/error/result state, or configurable local fallback boundaries. Failed saves retain local edits and can be retried; optimistic local editing already works. Automatic rollback and retry/backoff are separate capabilities. [SPEC-DATA:119](../constellation/doc/DOC-SPEC-DATA.md), [SPEC-VIEW §60](../constellation/doc/DOC-SPEC-VIEW.md). Confidence: **high**. Begin with a small optional mutation helper before designing a broad Suspense-equivalent API. Compare [Solid Suspense](https://docs.solidjs.com/reference/components/suspense) and [Svelte boundaries](https://svelte.dev/docs/svelte/svelte-boundary).

**Dynamic SSG/metadata:** `/posts/:slug` and `/products/:id` are skipped in prerender builds. Authors can construct explicit routes, but no route enumeration hook exists. Add build-time parameter enumeration without introducing file-based routing, which D67 rejected. Browser navigation updates title; description/canonical/social metadata is build-time only. Content-driven route metadata and sitemap output would make public-site builds more complete; updating SPA tags alone would not make a client-only site reliably crawlable. [SPEC-BUILD:78](../constellation/doc/DOC-SPEC-BUILD.md), [head.js:88](../client-runtime/head.js), [D67](../constellation/decision/DECISION-D67-HYBRID-PRERENDER.md). Confidence: **high** for enumeration/head limitations. Compare [Next.js static parameters](https://nextjs.org/docs/app/api-reference/functions/generate-static-params).

**Hot updates:** Current reload preserves records and JSON-safe view-local state; it is implemented and useful. Per-module replacement could additionally retain focus, selection, scroll, and nonserializable component/third-party state across edits. It is explicitly deferred, not a broken existing HMR promise. [SPEC-BUILD:42–48](../constellation/doc/DOC-SPEC-BUILD.md). Confidence: **high**. Measure editing friction and reload latency before investing in lifecycle-sensitive hot replacement. [Vite HMR API](https://vite.dev/guide/api-hmr).

**Prefetch:** Lazy views and splitting already exist. Hover/viewport route chunk prefetch is the missing next layer; query/data prefetch needs the query identities in rank 2. Set resource limits and respect data-saving preferences. [SPEC deferred list:118](../constellation/doc/DOC-SPEC.md). Confidence: **high**. [SvelteKit link options](https://svelte.dev/docs/kit/link-options) distinguish code and data preloading, a useful API boundary.

### 9–12. Reusable components, assets, and application tooling

**Scoped context:** Module imports and singleton records satisfy global utility/state needs. They do not provide isolated dependencies for two independent form/editor subtrees. Per-subtree provide/inject is explicitly unscheduled. [plan:68](../constellation/plan.md). Confidence: **high**. Investigate an opt-in scoped provider with ownership, shadowing, and teardown rules; do not reopen the rejected generic app globals/event bus. Vue/React/Solid/Svelte context and Ember service DI demonstrate related, differently scoped expectations.

**Component authoring/interoperability:** Refs, lifecycle, islands, callbacks, slots, and snippets already enable integrations. Remaining constraints include string-only refs, no reusable element-action API, named Portal targets, and snippet leaf restrictions. Multi-app embedding also needs care: the Portal decision explicitly describes shared outlet state. [SPEC deferred list](../constellation/doc/DOC-SPEC.md), [D144](../constellation/decision/DECISION-D144-PORTAL.md). Confidence: **high** for these constraints; **medium** for market demand. Validate concrete widgets before adding APIs. Custom-element publication is a narrower optional output goal, distinct from consuming custom elements, which Puzzle already does. [Vue publication](https://vuejs.org/guide/extras/web-components.html), [Svelte publication](https://svelte.dev/docs/svelte/custom-elements).

**Assets/images:** Public assets and inline SVG are present. The inspected build surface does not expose general file-loader configuration or an image-transform pipeline. Hashed imports for images/fonts are a smaller first step than image resizing, responsive formats, and optimization. [bundle options:56–74](../compiler/internal/build/options.go), [SPEC-ANATOMY:155](../constellation/doc/DOC-SPEC-ANATOMY.md). Confidence: **medium**. Use an optional tool/CDN integration; compare [Vite asset handling](https://vite.dev/guide/assets.html), [SvelteKit images](https://svelte.dev/docs/kit/images), and [Next.js Image](https://nextjs.org/docs/app/getting-started/images), distinguishing asset bundling from image optimization.

**Testing/component sandbox:** Puzzle has meaningful test helpers, fixtures, and DevTools. The next question is whether a new app can scaffold unit/component/browser tests and run components in isolation with representative states. A lightweight Pieces sandbox may be a better first investment than full Storybook integration. [Puzzle testing docs](../constellation/doc/DOC-TESTING.md). Confidence: **medium** because no clean-consumer testing scaffold was exercised. [Svelte CLI integrations](https://svelte.dev/packages) show the expected convenience around testing and component development. Preserve accessibility as an acceptance criterion: existing compiler warnings, focus/announcements, reduced motion, and Piece ARIA support are foundations, not missing features; browser keyboard/a11y checks should validate new workflows.

### 13–16. More specialized opportunities

**View retention:** Tabs, editors, and return navigation may want retained component instances. KeepAlive-style retention is explicitly unscheduled. [plan:67](../constellation/plan.md). Confidence: **high**. Define subscriptions, hidden-state behavior, eviction, and lifecycle/morph interaction before implementing; compare [Vue KeepAlive](https://vuejs.org/guide/built-ins/keep-alive.html).

**Content/build integrations:** Content collections and build analysis are unscheduled; the public config does not expose a general plugin API. [plan:69](../constellation/plan.md), [config.go](../compiler/internal/config/config.go). Confidence: **high** for the roadmap, **medium** for integration demand. A Markdown/content prebuild step with declared output/dependencies is easier to maintain than arbitrary bundler hooks. Pair content with dynamic SSG. Avoid bundling Sass support into this request: [D12](../constellation/decision/DECISION-D12-TAILWIND-FIRST.md) permanently rejects it. [Nuxt Content](https://content.nuxt.com/) supplies a companion-package comparison.

**Advanced i18n:** Basic translation is implemented. D175 specifically plans locale URL prefixes, per-locale prerendering and `hreflang`, translated route titles, rich text, key-union types, and RTL direction. [D175, future work](../constellation/decision/DECISION-D175-TRANSLATIONS.md). Confidence: **high**. Prioritize locale URLs for public multilingual sites; generic ICU expansion was rejected and should not be casually re-proposed. [Nuxt i18n routing](https://i18n.nuxtjs.org/docs/guide/).

**Offline sync:** Browser persistence is not an offline write queue. The SPEC explicitly excludes offline queuing and conflict resolution. [SPEC-DATA:125](../constellation/doc/DOC-SPEC-DATA.md). Confidence: **high**. Only fund durable replay, reconnect, and conflict UX if offline-first applications are a target. Ordinary online applications do not need this complexity.

## What I would build next

The ranking covers SPA and static-site workflows. Build order also accounts for implementation cost and dependencies. I would sequence these investments:

1. **Finish the planned tutorial and live browser experience.** Reuse the existing WASM compiler. Acceptance: a learner edits a `.pzl` example, sees positioned diagnostics and a preview, and can progress through state, events, composition, models, routing, and testing. The compiler currently reports TypeScript transformation unavailable and refuses filesystem SVG reads; either document those lesson limits or add separate transforms/virtual assets. Do not imply complete desktop build-pipeline parity. [WASM component card](../constellation/component/COMPONENT-PLAYGROUND-COMPILER.md), [WASM entry](../compiler/cmd/pzl-wasm/main.go).
2. **Deliver one complete forms workflow.** Acceptance: temporarily invalid input remains editable; touched errors display accessibly; pending submit prevents duplicates; backend errors map to fields; reset restores defaults; native controls and existing Pieces work without duplicated state logic.
3. **Add explicit server invalidation, then query identity/pagination.** Acceptance: two concurrent filters retain distinct result sets; pagination metadata survives; mutation invalidation refreshes the correct query; negative cache and shared requests behave predictably; stale responses cannot overwrite newer intent.
4. **Ship deployment recipes and public configuration conventions.** Acceptance: a scaffolded SPA and static app deploy with working deep links, base paths, correct cache behavior, and separate development/production API origins. Configuration tests must demonstrate that unintended process environment values are not emitted into client bundles.
5. **Choose the next SPA/static-site workflow investment.** Content/catalog demand favors dynamic SSG plus locale URLs; large application demand favors scoped context and resource/mutation helpers.

Keep optional capability packages separate where practical, consistent with the existing `/adapter`, `/morph`, `/testing`, and feature-gated runtime design. Improvements to tutorials and deployment should not add browser runtime bytes. Forms/query/context features should have measured opt-in bundle cost.

## Specific typing refinement within existing tooling

Puzzle already has TypeScript support, `puzzle check`, editor integrations, linting, formatting, and DevTools. A narrower documented checker limitation is worth recording separately: D165 says `data()`-derived keys fall through `Record<string, any>` and virtual files do not link component contracts. The component emitter checks supplied expressions without comparing the complete prop set to a child's interface. [D165:62–66](../constellation/decision/DECISION-D165-PUZZLE-CHECK.md), [checker emitter:652](../compiler/internal/check/emitter.go).

Typed `data()` return checking and cross-component prop checking would be refinements to existing tooling, not evidence that editor support is missing. They are not assigned a popularity rank here. Any implementation must respect D165's constraint against TypeScript 6 compiler APIs. This note records the checker scope; it does not recommend replacing the existing editor integrations.

## Considered but not automatic backlog items

- **SSR, DOM-adoption hydration, and framework-owned server actions:** outside Puzzle's SPA/static-site product scope. Existing build-time prerendering remains part of the static-site offering. Peer server-rendering features are factual comparison context, not reasons to add them to Puzzle.
- **ESLint, Prettier, editor support, DevTools, and TypeScript support:** implemented. Do not list the developer-tooling category as missing. More specific checker refinements are described separately above.
- **Router, datastore, validation, error handling, lazy routes, fixtures, and virtual lists:** already implemented. A virtual-list Piece exists even though framework-owned virtualization is out of scope.
- **Tutorial/browser compiler:** tutorial planned; WASM compiler implemented. The remaining user experience is already-directed work.
- **Event bus, generic app globals, Sass, file-based routing, unrestricted dynamic components:** documented rejected approaches or deliberate boundaries; no new user-demand evidence here justifies reversing them.
- **More animation features or named routes:** possible conveniences, but less compelling than the workflow gaps. FLIP/morph/transition support is already unusually broad.
- **Mobile/native output, microfrontends, or custom-element output:** specialized expansion options, not universal mature-framework requirements. Several comparison frameworks also rely on separate ecosystems for these.
- **“Good documentation” as a completed quality claim:** substantial docs exist. The planned tutorial and testing with new users should establish whether they are easy to learn from.

## Verification and limits

Source/card inspection covered the public release surface, relevant frozen SPEC domains and decisions, checker emission, adapter/query state, bundle/config options, head management, the WASM bridge, and relevant Piece manifests. Peer claims use current official framework/library documentation; survey evidence comes from its publisher.

Required repository checks passed:

- `npm_config_cache=/private/tmp/puzzle-feature-audit-npm-cache npx vitest run`: **148 files, 2,704 tests passed**. The initial default-cache run failed one packaging check on an npm cache permission error; rerunning with the temporary cache resolved it.
- `npm run test:runtime-types`: passed.
- `go test ./...` in `compiler/`: passed.
- `go test ./...` in `packages/puzzle-lang`: passed.

No source code, SPEC, decision cards, release tags, or package versions were changed. No comparative app benchmark, clean-consumer deployment, browser/a11y sweep, exhaustive integration test, or direct developer demand study was performed. Feature confidence is high where the SPEC explicitly describes the boundary; inferred integration gaps are marked medium. A small survey or interviews with prospective Puzzle users should validate the relative demand ranking before funding major architectural work.
