# Puzzle features: what is next

Merged 2026-10-04 from two independent reviews written 2026-10-01 against
`release/0.8.0` (one by Opus, one by Sol). Both compared Puzzle with Vue, React,
Solid, Svelte and Ember **plus each one's standard application framework**
(Nuxt, Next, SolidStart, SvelteKit, Ember CLI), because that bundle is what
developers compare against.

Puzzle's scope is **SPAs and static sites**. Request-time SSR, hydration and
framework-owned server actions are outside it; their presence elsewhere is
context, not a gap.

Rankings are informed estimates of how often a developer will expect a feature
and notice it missing. No survey measures this list directly, so adjacent
positions are not precise. Effort: S = small focused work, M = several focused
days, L = substantial, possibly more than one release.

## What Puzzle already covers

Not gaps, and not to be re-proposed as missing:

- **Routing**: nested routes and layouts, path/hash/memory modes, guards, lazy
  views, query snapshots, base paths, atomic navigation, scroll and focus
  handling, head tags.
- **Data**: a normalized store with relationships, validation, adapters,
  auto-fetching finds, request deduplication, optional persistence.
- **Templates and composition**: single-file `.pzl`, JS/TS scripts, component
  families, slots, snippets, portals, two-way binding, template functions.
- **Async and errors**: skeletons, `onError`, the app-level `errorView`, retry.
- **Motion**: enter/leave animations, visible-trigger enters, FLIP, morphs.
- **Localization**: `t`, plurals, fallback fill, locale switching, locale-aware
  date and number functions.
- **Output**: SPA, hybrid prerender, router-free static pages, opt-in code
  splitting.
- **Tooling**: a fast Go CLI, `puzzle check`, ESLint and Prettier plugins,
  VS Code / Sublime / Zed support, a DevTools extension, `/testing`,
  `/fixtures`, a mock adapter, AI skills.
- **Pieces**: 100+ components, including Field, radio-group, multi-select and
  virtual-list.

**Watchers and effects are not a gap.** Vue `watch`, Svelte `$effect`, Solid
`createEffect` and React `useEffect` have no Puzzle equivalent by design:
`data()` owns derived state, event handlers own side effects of user actions,
and `afterUpdate()` syncs things Puzzle does not render. Ember Octane made the
same choice.

## 0.9.0 — multilingual static sites

Theme: a public site in several languages, with real pages per language,
blog posts included.

| Feature | What it adds | Record | Size |
|---|---|---|---|
| **Locale URL prefixes** | `i18n: { routing: 'prefix' }`: `/es/…`, `/it/…`; one prerendered page per language; `link()` adds the prefix; `link(path, { locale })` and `{ locale: false }` | [D177](../constellation/decision/DECISION-D177-LOCALE-URL-PREFIXES.md) | L |
| **Language list for switchers** | `i18n.locales` returns `{ locale, label, href, active }` per language (breaking: was a list of tags) | D177 | S |
| **`hreflang` and `site`** | Alternate-language links on every page; a `site` setting for absolute URLs | D177 | S |
| **First-visit language redirect** | A small inline script using `navigator.languages` and the saved choice; `detect: false` removes it | D177 | S |
| **Translated page titles** | `meta: { title: { t: 'key' } }`, also for descriptions | D177 | S |
| **Bare `href` warning** | Build warning for a hand-written `href="/about"` that skips `link()` | D177 | S |
| **Language-switcher piece** | A drop-in piece built on `i18n.locales` | D177 | S |
| **Right-to-left languages** | `<html dir="rtl">` per language (Arabic, Hebrew, …) | D177 | S |
| **Sitemap** | `sitemap.xml` listing every page in every language | D177 | S |
| **Dynamic-route prerendering** | A `staticPaths` route field: `/blog/:slug` becomes one page per post, per language | new decision card | M |
| **`prev` on `afterUpdate`** | `afterUpdate(prev)` receives the props, params, route and data from before the update | new decision card | S |

Dynamic-route prerendering was the top-ranked gap in one review ("static site
mostly means blogs, docs and products"). Without it a multilingual blog would
get its fixed pages translated and none of its posts.

## 0.10.0 — candidates

Everything else the two reviews raised, ordered by expected demand. This is
more than one release can hold; pick from the top.

| # | Feature | Puzzle today | Suggested treatment | Size / risk |
|---|---|---|---|---|
| 1 | **Forms lifecycle**: a draft that may hold invalid input, touched/dirty state, field errors, submit state, server errors, reset | Validation and two-way binding; no form-level state | Optional forms module plus Pieces integration; no schema-generated renderer | L / medium |
| 2 | **Server query lifecycle**: pagination, query identity, invalidation, freshness, refetch | `findOne`/`findMany` auto-fetch; collection state keyed by model type only | Explicit invalidation and query handles first, freshness after | L / high |
| 3 | **Context / provide-inject** for a subtree | Singleton store records act as globals; nothing scoped | Needs a decision card first: it brushes the rejected event bus and `ctx.utils` | M–L / medium |
| 4 | **Deployment recipes and public env config** | Deploy behaviour documented; no first-class browser env contract | Tested host recipes; a deliberate public-variable convention | M / low |
| 5 | **Auth and session reference example** | Guards, adapters and store make it possible; no maintained example | A reference integration, not a homegrown auth core | M / medium |
| 6 | **Independent async regions and mutation status** | Skeletons and `errorView`; no per-query or per-mutation state | A small optional mutation helper before any Suspense-like API | M–L / medium |
| 7 | **Per-component HMR** | A state-preserving full reload | Measure real editing friction before replacing reload | L / high |
| 8 | **Link prefetch** on hover or when visible | None | Chunk-only prefetch first; data prefetch needs #2 | S–M / medium |
| 9 | **Named routes** (`router.push({ name, params })`) | `name` is informational only | Small API addition | S / low |
| 10 | **Dynamic components** chosen at runtime | `{#case}` is the workaround | Verify what is possible today first; the unrestricted form is a deliberate boundary | S–M |
| 11 | **Markdown and content collections** | None; no public build plugin contract | A content prebuild step; pairs with dynamic-route prerendering | M / medium |
| 12 | **Element actions** (tooltip, autofocus, …) | Refs plus lifecycle; only `@event:outside` built in | The intended shape is `ref={ fn }` | S–M |
| 13 | **Asset imports and image optimization** | Public files and inline SVG | Hashed imports for images and fonts, then an optional image integration | M–L / medium |
| 14 | **App test scaffold and component sandbox** | `/testing` primitives; the pieces demo covers pieces only | Scaffolded tests in `puzzle init`; a light sandbox before any Storybook work | M / low |
| 15 | **Component-level lazy loading** | `lazy()` covers route views and layouts | Extend to components | S–M |
| 16 | **Keep-alive / retained views** | Not present | Design subscriptions, eviction and lifecycle first | L / high |
| 17 | **Compile to web components** | No | Fits the Magic Spells web-component ecosystem | M |
| 18 | **i18n remainder**: rich-text translations (a link inside a sentence), key-union types for `puzzle check` | Listed as future work in D175 | Generic ICU was rejected; do not re-propose it | M |
| 19 | **Checker refinements**: typed `data()` return, cross-component prop checking | `data()` keys fall through `Record<string, any>` (D165) | Must respect D165's constraint against TypeScript compiler APIs | M |
| 20 | **Offline write sync** and conflict handling | Persistence only | Only for a demonstrated offline-first workload | L / high |

## Separate track: tutorial and live playground

Planned independently of the framework releases. The WASM parser and codegen
core (D164) is built; what remains is the editor, worker and preview. Give
every docs page a "try it" link into the playground and add shareable URLs
(code in the URL hash) so people can paste reproductions into issues. Known
lesson limits to document or fix: the WASM compiler reports TypeScript
transformation as unavailable and refuses filesystem SVG reads.

## Not planned

Deliberate boundaries; no new evidence in either review justifies reversing
them.

- **SSR, hydration, server actions**: outside the product scope.
- **Event bus, generic app globals, Sass, file-based routing**: rejected in
  decision cards (Sass in D12, file-based routing in D67).
- **Vite/Rollup plugin compatibility**: Puzzle builds with esbuild by design;
  fill important cases (image optimization, PWA) one at a time on demand.
- **Native / mobile target**: Capacitor works for any SPA; a docs recipe is
  enough.
- **More animation features**: FLIP, morphs and transitions are already
  unusually broad.

## Marketing qualifications worth keeping straight

- The README sizes are **21.9 KB gzip for a minimal complete app** and
  **26.0 KB for the todos app**, not a universal framework cost.
- The ~200 ms production build is the todos example on Apple Silicon.
- Neither is an apples-to-apples benchmark against a bare rendering runtime.
