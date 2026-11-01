---
name: ROUTER.md — routing reference
status: verified
connections:
  - DOC-SPEC-ROUTER
  - DOC-SPEC
  - DOC-VIEW-LIFECYCLE
  - DOC-DATASTORE
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D175-TRANSLATIONS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D182-NAVIGATION-RESULT
  - DECISION-D183-ROUTE-VIEWS-AGENT-FIELD
verified_at: '2026-11-01T19:25:13.521Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

How to route a Puzzle app: routes, params, layouts, nested routes, links, URL-backed state, guards, scroll, modes, base paths, locales and 404s. The binding rules are [[DOC-SPEC-ROUTER]]; the § numbers below point there.

# Puzzle Router

The router maps URLs to views, wraps them in layouts, hands `:param` segments to `data()`, and keeps history honest. It runs in the SPA and in `output: 'hybrid'` builds (after takeover). `output: 'static'` pages have no router: links are plain page loads and navigation methods throw.

Path routing (the default) needs the server to serve `index.html` for every app route; `puzzle dev` and `puzzle preview` do this. On hosts where you can't set up that fallback, use hash mode.

## Defining routes

Routes are an array exported from `app/routes.js` and passed to `PuzzleApp`:

```js
// app/routes.js
import HomeView from './views/Home.pzl';
import UserView from './views/User.pzl';
import NotFound from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home' } },
  { path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
  { path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Not Found' } },
];
```

| Field | Purpose |
| ----- | ------- |
| `path` | `/about`, `/user/:id`, or `'*'` (catch-all, top level only, matched last). Top-level paths start with `/`. |
| `name` | Route identifier — match on it rather than on paths. |
| `view` | The `.pzl` view class, or `lazy(() => import('./views/X.pzl'))` to load it on first visit (§62). |
| `layout` | Wraps the view, which renders at the layout's `<Slot/>`. Top-level routes only. |
| `children` | Nested routes with relative paths (below). |
| `guard` | `({ to, from, ctx }) => verdict`, covering this route and every child (§48). |
| `meta` | `title`, `description`, `canonical`, `socialImage` — static strings, `{ t: 'key' }` for title/description, or `null` (§45). |
| `transitionMode` | `'sequential'` or `'overlap'` for navigations *into* this route (§33). |
| `prerender` | `false` anywhere in the chain makes hybrid/static builds write the plain shell at that path. |
| `staticPaths` | Build only: the param values to prerender for a `:param` route (§9, [[DECISION-D179-STATIC-PATHS]]). |
| `agent` | `false` hides the route from tools reading `router.views`; `{ name, about }` names and describes it (below). |

The first match wins, so declare `/user/new` before `/user/:id` (the router warns in development when a route is shadowed).

## Params in `data()`

`:param` values arrive as strings in `data(params, props)`. `data()` re-runs when they change; `/user/42` → `/user/7` keeps the same view instance:

```js
export default class UserView extends PuzzleView {
  data(params) {
    return { user: this.ctx.store.findOne('user', params.id) };
  }
}
```

Store ids ignore number/string differences, so the string param finds a numeric key. With the adapter, a missing record is fetched before the view commits ([[DOC-SPEC-DATA]] §61). The router waits for `data()`, so the old page stays until the new one is ready (unless the view declares a `<puzzle-skeleton>`).

## Where am I? `this.route`

Inside a routed `data()`, `this.route` describes the navigation being loaded: `{ path, pathname, query, hash, route, params, chain }`. At that point `router.current` and `location` still describe the *old* page, so use `this.route` for active-nav highlighting (§19):

```js
data() {
  const name = this.route.route.name;
  return { isProfile: name === 'account-profile', isTrips: name === 'account-trips' };
}
```

Compare route names (or `this.route.chain[0].name` for the section), not paths. Components the router doesn't manage get `this.route === null`; pass what they need as props.

## Layouts and `<Slot/>`

A layout is an ordinary view with one `<Slot/>` where the routed view renders. Consecutive routes that share a layout class reuse the instance.

```html
<puzzle-view class="min-h-screen flex flex-col">
  <header>…</header>
  <main><Slot/></main>
</puzzle-view>
```

`<Slot/>` is the router outlet. Components use `<Children/>` and `<Slot name="…"/>` for composition ([[DOC-SPEC-TEMPLATE]]).

## Nested routes

```js
{
  path: '/settings', name: 'settings', view: SettingsShell, layout: DefaultLayout,
  meta: { title: 'Settings' },
  children: [
    { path: '',        name: 'settings-index',   view: SettingsHome },   // /settings
    { path: 'profile', name: 'settings-profile', view: ProfileView, meta: { title: 'Your Profile' } },
    { path: 'billing', name: 'settings-billing', view: BillingView },    // inherits 'Settings'
  ],
}
```

- The parent view renders its matched child at its own `<Slot/>`; a non-leaf view without one warns in development.
- Child paths are relative. Add an index child (`path: ''`) or the parent's bare URL falls through to the catch-all.
- Every level's `data(params)` gets the full merged params.
- Moving between siblings keeps the shell instance and swaps only the pane.
- A child cannot declare `layout`, a leading-`/` path, or `'*'`, and a `:param` name may not repeat within one chain.

## Navigating

```js
this.ctx.router.push('/user/42');           // new history entry
this.ctx.router.replace('/items?q=cabin');  // replace the current entry, keep scroll
this.ctx.router.back();                     // also forward() and go(n)
```

Plain `<a>` tags are intercepted — there is no link component. The browser keeps the click when it is modified (Cmd/Ctrl/Shift/Alt) or not a left click, the link has `download` or a `target` other than `_self`, it points to another origin, or it is `mailto:`/`tel:`.

**Write hrefs with `link()`** so they are right in every mode and under any base path:

```html
<a href="{ link('/about') }">About</a>
<a href="{ link('/user/' + user.id) }">{ user.name }</a>
```

`link` calls `router.url()`: `/about` in path mode (with `routerBase`), `#/about` in hash mode. Because the attribute is a real URL, new-tab and copy-link work. External URLs pass through.

`await router.push(path)` tells you what happened (§30):

```js
const result = await this.ctx.router.push('/account');
if (result.ok) {
  result.route.path;      // where it landed — '/login' if a guard redirected
  result.redirectedFrom;  // '/account' after a redirect, else undefined
  result.catchAll;        // true when it landed on the '*' route
} else {
  result.reason;          // 'blocked' | 'superseded' | 'not-found' | 'error'
  result.error;           // the failure, for 'error' (also sent to onError)
}
```

`push()` and `replace()` never reject. A push to the page you're on is a no-op that resolves `ok`, unless another navigation is loading.

## URL-backed state: `query` and `replace()`

Filters, tabs, search and pagination belong in the URL. Read them from `this.route.query` (frozen; repeated keys become arrays, `?debug` is `''`) and write them with `replace()`, which adds no history entry, leaves scroll alone, and on the same route leaves focus where it is, so typing is never interrupted (§44, §51):

```html
<input value={ q } placeholder="Filter…" @input={ updateFilter(event) } />
```

```js
data() {
  const q = this.route?.query?.q ?? '';
  const needle = q.trim().toLowerCase();
  return { q, items: this.ctx.store.findMany('item').filter((it) => it.title.toLowerCase().includes(needle)) };
}

events = {
  updateFilter: (event) => {
    const v = event.target.value;
    this.ctx.router.replace(v ? '/items?q=' + encodeURIComponent(v) : '/items');
  },
};
```

Use `push()` when the change should be a Back-button stop (wizard steps). Query values never appear in `params`. Working example: `examples/stays`.

## Titles and head tags

`meta.title` becomes `document.title` on each navigation; the nearest title up the chain wins. `description`, `canonical` and `socialImage` become `og:`/`twitter:`/canonical tags **only in prerendered HTML** (hybrid and static builds) — the browser never syncs them, which is fine because crawlers fetch each URL fresh. Set root-route defaults for any field you use; `null` suppresses an inherited value (§45).

## Route guards

```js
const requireAuth = ({ to, ctx }) => {
  if (ctx.store.findMany('session').length === 0) {
    return '/login?redirect=' + encodeURIComponent(to.path);
  }
};

export default [
  { path: '/login', name: 'login', view: LoginView, layout: MainLayout },
  {
    path: '/account', name: 'account', view: AccountShell, layout: MainLayout,
    guard: requireAuth,                    // locks /account and every child
    children: [
      { path: '',      name: 'account-profile', view: ProfileView },
      { path: 'admin', name: 'account-admin',   view: AdminView, guard: requireAdmin }, // requireAuth, then requireAdmin
    ],
  },
];
```

Return `undefined`/`true` to allow, `false` to stay put, or a path to redirect. Guards run root → leaf before anything loads, on every navigation including the first, so a denied page never constructs or flashes. They may be async. Restore sessions in `beforeMount` so guards can read the store synchronously, and finish login with:

```js
const redirect = this.route.query.redirect;
this.ctx.router.replace(typeof redirect === 'string' ? redirect : '/');
```

Guards are UX, not security — authorize on the server. Hybrid builds warn for each prerendered guarded page (add `prerender: false`); static builds warn that guards never run (§48).

## Transitions and morphs

Declare `animations` on views and layouts; navigation plays the old view's `out`, then the new view's `in` ([[DOC-SPEC-VIEW]] §12). `transitionMode: 'overlap'` (app-wide, per route, or per view class) plays them together (§26, §33). A `<puzzle-skeleton>` view commits at once and shows its skeleton while data loads. Shared-element morphs come from `enableMorph(app)` and `data-puzzle-morph` attributes ([[DOC-SPEC-VIEW]] §37, `examples/music`, `examples/kanban-morph`).

## Scroll and focus

By default a push scrolls to the top, Back/Forward restores the saved position (even after a reload), `push('/docs#faq')` lands on `#faq`, and the first load is left to the browser. After each navigation focus moves to the new view and the title is announced to screen readers (§14, §51).

```js
new PuzzleApp({
  scrollBehavior: false,   // the shell scrolls an inner panel; leave window alone
  // or: (to, from, savedPosition) => savedPosition ?? { x: 0, y: 0 }
  focusBehavior: (to) => document.querySelector('main h1'),
});
```

## Router modes

```js
import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';

new PuzzleApp({ routerMode: hashRouter() });                          // #/user/1 — static hosts, file://
new PuzzleApp({ routerMode: memoryRouter({ initialPath: '/dash' }) }); // no URL — tests and embeds
```

Omit `routerMode` for path routing; a string like `'hash'` throws. App code is the same in every mode: routes, `push('/user/1')`, `current.path` and `link()` hrefs. In hash mode avoid bare `#faq` links — they replace the route fragment. Memory mode touches no URL, title, scroll or `<html lang>`, but link interception is still document-wide (§15).

## Base path

`routerBase: '/myapp'` deploys under a sub-path. App code never mentions the base; `link()` hrefs and the address bar carry it. It works in path and hash mode and is ignored in memory mode (§23).

## Switching locale

With `i18n` configured, `this.ctx.i18n.setLocale('es')` loads the new strings and rebuilds the current page in place: same URL, no history entry, no scroll or focus change, no animations. Store records survive; `setData` state starts fresh. The promise rejects if the page could not be rebuilt (§9, `examples/i18n`).

With `i18n.routing: 'prefix'` each non-default locale lives under its own URL prefix (`/es/about`) and `setLocale` loads that URL instead. Routes, `push()` and `this.route` stay prefix-free; `link()` adds the prefix (`link('/about', { locale: 'es' })` for another locale), and `ctx.i18n.locales` gives a switcher its `{ locale, label, href, active }` entries. Prefix routing needs path mode (§9, [[DECISION-D177-LOCALE-URL-PREFIXES]]).

## 404

Declare a `path: '*'` route; it is matched last wherever it sits. Without one, an unmatched URL logs a warning, the current view stays, and `push()` resolves `'not-found'`. Prerendered builds write it to `dist/404.html`.

## Listing routes for tools: `router.views` and `agent`

`router.views` lists every leaf route as frozen data, in declaration order, without the catch-all. An agent panel, a sitemap widget or a command palette reads it instead of walking the route table:

```js
export default [
  { path: '/', name: 'home', view: HomeView, agent: { name: 'home', about: 'Dashboard' } },
  {
    path: '/admin', view: AdminShell, agent: false,       // hides /admin and every child…
    children: [
      { path: '',     view: AdminHome },
      { path: 'help', view: AdminHelp, agent: { name: 'admin-help', about: 'How to use admin' } }, // …except this one
    ],
  },
  { path: '/tasks/:taskId', name: 'task', view: TaskView, meta: { title: 'Task' }, agent: { name: 'task' } },
];

const pages = router.views.filter((v) => v.agent);
const here = router.views.find((v) => v.chain.at(-1) === router.current.route); // the current page's entry
```

Each entry is `{ path, params, name, meta, title, agent, chain }`. `agent` resolves from the leaf up, so a child's own value beats its parent's. The router never acts on it — a hidden route still navigates and prerenders. In development an invalid `agent` throws, a name used by two different `agent` objects warns, and once any route uses `agent` a warning lists the routes that set neither `false` nor `{ name }` (§9).

## API

`this.ctx.router` (also `app.router`):

| Member | Description |
| ------ | ----------- |
| `push(path)` | Navigate with a new history entry. Resolves a `NavigationResult`; never rejects. |
| `replace(path)` | Same, but replaces the current entry and leaves scroll alone. |
| `go(n)` / `back()` / `forward()` | History movement in every mode. |
| `url(path, options?)` | Mode-, base- and locale-correct href (what `link()` calls). |
| `current` | The committed snapshot `{ path, pathname, query, hash, route, params, chain }`. |
| `views` | Every leaf route as frozen `{ path, params, name, meta, title, agent, chain }` entries. |

Named-route navigation is not supported.
