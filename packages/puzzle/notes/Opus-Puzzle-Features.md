# Puzzle vs. Vue, React, Solid, Svelte, Ember: blind spots

Written 2026-10-01 against `release/0.8.0`, using `DOC-RELEASE-SURFACE`, the
DOC-SPEC section index and its "Deferred features" / "Not shipped" lists.
Puzzle is compared with each framework **plus its standard meta-framework**
(Nuxt, Next, SolidStart, SvelteKit, Ember CLI), because that bundle
is what developers really compare against.

## What Puzzle already covers

Puzzle already matches or beats the field on: routing (nested routes, guards,
lazy views, scroll and focus handling, head tags), a built-in data store with
relationships, validation and adapters, two-way binding, i18n, single-file
components, scoped CSS and Tailwind, animations, FLIP, morphs, slots, snippets,
portals, error views, skeletons, TypeScript plus `puzzle check`, component
testing utilities, fixtures and a mock adapter, ESLint and Prettier plugins, a VS Code extension (completion, hover, snippets) plus Sublime and Zed grammars, code splitting, SPA, hybrid and
static output, a fast Go CLI, AI skills, DevTools, and a 100+ piece component
library. Its built-in store, i18n, fixtures and morphs go further than what most
of the other frameworks ship in core.

**Planned next: an interactive tutorial with a live in-browser playground.**
This matches Svelte's tutorial, the Vue SFC Playground and the Solid
Playground, and those are some of the most-cited reasons people try those
frameworks. The WASM parser+codegen core (D164) is already built, so it is
left out of the gap list below. To get the most from it, give every docs page
a "try it" link that opens the snippet in the playground, and add shareable
playground URLs (code stored in the URL hash) so people can paste reproductions
into issues.

## Gaps, ranked from most to least expected

The ranking is how often a developer coming from another framework will expect
the feature and notice it is missing. The **Status** column says whether Puzzle
has deliberately deferred or rejected the feature. If it has, the gap is a
product decision that needs revisiting, not an oversight.

| # | Gap | Who has it | Puzzle today | Status | Effort |
|---|-----|-----------|--------------|--------|--------|
| 1 | **Prerendering dynamic routes** (`/blog/:slug` → one page per post) | Next `generateStaticParams`, Nuxt/SvelteKit prerender entries, Astro `getStaticPaths` | Skipped with a warning (`staticPaths` is on the not-shipped list) | Not shipped | **Low–Med**: biggest return for the cost; "static site" mostly means blogs, docs and products |
| 2 | **Context / provide-inject** (pass a theme, user or config down the tree without prop drilling) | React context, Vue provide/inject, Svelte `setContext`, Solid context, Ember services | Singleton store records act as a global; nothing is scoped to a subtree | The event bus and `ctx.utils` were rejected. Context was never decided directly | Med |
| 3 | **Remote-data caching: pagination, query keys, staleness/TTL, refetch** | TanStack Query (React/Vue/Solid/Svelte), Ember Data, SWR | `findOne`/`findMany` auto-fetch with no pagination or invalidation | Deferred (§61) | Med–High. Pagination is the part every real app hits first |
| 4 | **Per-component HMR** (edit a component and keep app state without a reload) | All five through Vite (`@vitejs/plugin-*`, Ember Vite) | A state-preserving full reload | Deferred | Med–High |
| 5 | **Dynamic components** (render a component chosen at runtime) | Vue `<component :is>`, `<svelte:component>`/runes, JSX variables, Solid `<Dynamic>`, Ember `{{component}}` | No documented equivalent; `{#case}` is the workaround | Not found in the cards; worth verifying | Low–Med |
| 6 | **Form helpers** (dirty/touched state, field error display, submit state, reset) | Vue (VeeValidate/FormKit), React Hook Form, Felte/Superforms, Ember Changeset | Schema validation and two-way binding, but no form-level state | No decision card | Med; could be a piece rather than core |
| 7 | **Link prefetching** (load a route's chunk/data on hover or when visible) | Next, Nuxt, SvelteKit (`data-sveltekit-preload`), SolidStart | None | Deferred | Low–Med |
| 8 | **Named routes / typed route helpers** (`router.push({ name, params })`) | Vue Router, Ember, TanStack Router, SvelteKit typed routes | The `name` field is informational only | Not shipped | Low |
| 9 | **Markdown / content pages** for static sites | Nuxt Content, mdsvex, Astro, Next MDX | None | No decision card | Med. Pairs with #1 |
| 10 | **Element directives / actions** (reusable DOM behavior: tooltip, autofocus, click-outside) | Svelte `use:`, Vue directives, Ember modifiers, Solid `use:` | Refs plus lifecycle; only `@event:outside` is built in | Deferred; the intended shape is `ref={ fn }` | Low–Med |
| 11 | **Plugin ecosystem compatibility** (PWA, image optimization, icons, MDX…) | Everything Vite-based | esbuild only, so Vite/Rollup plugins don't apply | By design | n/a. Fill the important cases (image optimization, PWA) one at a time if demand shows up |
| 12 | **Keep-alive / cached views** (a tab keeps its state when you switch away) | Vue `<KeepAlive>`, Ember (by pattern), Svelte/React by pattern | Not present | No decision card | Med |
| 13 | **Component-level lazy loading** (`defineAsyncComponent`, `React.lazy` + Suspense) | Vue, React, Solid, Svelte | `lazy()` covers route views and layouts; components need a manual `import()` | Partial | Low–Med |
| 14 | **Component workshop / Storybook support** | Storybook supports Vue, React, Svelte, Solid and Ember | The pieces demo plays this role for pieces, but apps have nothing | None | Med |
| 15 | **Compile to web components** (ship a Puzzle component as a custom element) | Vue `defineCustomElement`, Svelte `customElement`, Solid `solid-element` | No | None | Med. Fits the Magic Spells web-component ecosystem nicely |
| 16 | **Virtual list** | Mostly libraries (TanStack Virtual, vue-virtual-scroller) | Out of core; a piece can own one through snippets | Deferred to pieces | Low (as a piece) |
| 17 | **Native / mobile target** | React Native, NativeScript-Vue, Capacitor (any) | None | Out of scope | n/a (Capacitor works for any SPA; a docs recipe is enough) |

## Not a gap: watchers / effects

Vue `watch`, Svelte `$effect`, Solid `createEffect` and React `useEffect` have
no Puzzle equivalent, and Puzzle doesn't need one. It is built so that this
glue code isn't necessary:

- `data()` owns derived state and reruns on prop, route and store changes.
- Event handlers own side effects a user action causes.
- `afterUpdate()` syncs things Puzzle doesn't render (third-party widgets,
  scroll, focus) after a render that came from outside the view.

Modern Ember made the same choice: Octane discouraged observers in favor of
tracked getters plus actions.

**Optional convenience: a `prev` argument on `afterUpdate`.** Today, comparing
against an old value means stashing it on the instance yourself. Instead,
`afterUpdate` could receive a frozen, shallow snapshot taken just before the
update:

```js
afterUpdate(prev) {
  if (prev.props.center !== this.props.center) this.map.setCenter(this.props.center);
  if (prev.props.user !== this.props.user) this.setData({ draft: null });
}
```

- `prev` holds `props`, `params`, `route` and `data` (the merged `getData()`).
  It leaves out `refs`, `element` and `ctx`.
- `mounted()` covers the first render, so `afterUpdate` always gets a real `prev`.
- Records keep identity across mutations (D170), so compare fields in
  `prev.data` to catch edits. `!==` on a record only detects a different record.
- It adds no new hook, no reactive primitive, and no change to existing
  `afterUpdate()` overrides. It would get a short decision card (next free:
  D177). Before building it, confirm that prerender never calls `afterUpdate`.

## Suggested next builds

0. **Tutorial + live playground** (already planned; see above).
1. **Dynamic-route prerendering (#1):** a `staticPaths` route field. It makes
   the static output claim hold up for real sites.
2. **Context (#2):** scoping values to a subtree. It needs a decision card first
   because it brushes against the rejected event-bus/`ctx.utils` line.
3. **Pagination and staleness in the store (#3):** unblocks real CRUD apps.
4. **Dynamic components (#5):** confirm whether a runtime-chosen component is
   possible today; if not, it's a small, frequently-expected addition.
5. **`prev` on `afterUpdate`** (see above): small, whenever convenient.
