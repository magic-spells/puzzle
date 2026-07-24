---
name: ROUTER.md — routing reference
status: verified
verified_at: '2026-07-24T01:11:18.110Z'
connections:
  - COMPONENT-ROUTER
  - DOC-SPEC
  - DOC-DECISIONS
  - DOC-VIEW-LIFECYCLE
  - DOC-MODELS
  - DOC-DATASTORE
verified_sha: 214406a27c9beb7a34a7a1a265f5dd8bf8f28fc0
---

The full v1 routing surface: route definition shape, dynamic `:param` segments delivered to `data(params, props)`, layouts and the `<Slot/>` injection point, nested routes via `children` (v1.3), `router.push()` plus automatic link interception and `go()`/`back()`/`forward()` (v1.11), `router.replace()` and the parsed `query`/`pathname`/`hash` snapshot fields for URL-backed transient state (v1.49), `meta.title` → `document.title` plus the reserved head fields (`description`/`canonical`/`socialImage`) rendered as managed head tags (v1.50), the v1 route lifecycle (with v1.1 transition animations), window scroll management (v1.5; anchor targets + reload persistence v1.10), opt-in hash mode for static hosts (v1.6), URL-less memory mode for tests and embeds (v1.11), sub-path deploys via `routerBase` (v1.19), path-shaped hrefs via `router.url()` and the `link` formatter (v1.46), route guards via the inherited `guard` route field (v1.53), and the settled `path: '*'` catch-all 404 convention (D19).

# Puzzle Router

Part of the Puzzle docs — see [[DOC-SPEC]] for the frozen v1 contract.

Puzzle is SPA-only, and the router is the piece that makes it feel like an application: it maps URLs to views, wraps them in layouts, delivers `:param` segments to `data()`, and keeps the browser history honest. This document covers the full v1 routing surface: route definitions, params, layouts and `<Slot/>`, navigation, and the route lifecycle.

**The router defaults to the HTML5 history API.** In this default (history) mode your server — or `puzzle dev`, which does it for you — must serve `index.html` for every app route, the standard history-API fallback. For static hosts where you can't configure that fallback (GitHub Pages, S3, `file://`), **v1.6 adds opt-in hash routing** (`routerMode: 'hash'`, D34) which carries the route in `location.hash` instead — no server rewrite needed. See [Hash mode (v1.6)](#hash-mode-v16) below.

---

## Defining Routes

Routes are an array of plain objects exported from `routes.js` and passed to `PuzzleApp`. This is the real `routes.js` from the todos example app:

```js
// routes.js
import HomeView from './views/Home.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Todos - Simple and Fast'
    }
  }
];
```

Wired up in `app.js`:

```js
import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
});

app.mount();
```

### Route definition shape

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `path` | string | URL pattern. Static segments (`/about`) or dynamic `:param` segments (`/user/:id`). |
| `name` | string | Route identifier (e.g. `'home'`, `'user'`). |
| `view` | PuzzleView class | The `.pzl` view rendered when the route matches. Imported at the top of `routes.js`. |
| `layout` | PuzzleView class | The layout that wraps the view. The view renders at the layout's `<Slot/>`. **Top-level routes only** (v1.3) — nested children inherit the chain's layout; a `layout` on a child throws. |
| `children` | array of route objects | Nested child routes with **relative** paths (v1.3). The parent's view renders its matched child at its own `<Slot/>`. See [Nested Routes](#nested-routes-v13). |
| `guard` | function | Navigation guard (v1.53). Runs before the route loads or commits; covers this node **and every child**. Allow, block, or redirect. See [Route guards](#route-guards-v153). |
| `meta.title` `meta.description` `meta.canonical` `meta.socialImage` | string or `null` | The four **reserved head fields** (v1.50, D84). `title` is set as `document.title` on navigation; all four also render as managed head tags (`og:*`/`twitter:*` mirrors, `<link rel="canonical">`). **Static strings only** — no functions or data-derived values. Each field resolves **independently**, nearest-defined leaf → root in a nested chain; `undefined` inherits, `null` explicitly suppresses an inherited value. All optional. See [`meta.title` and head metadata](#metatitle-and-head-metadata-v150). |

### Dynamic segments

Add `:param` segments to capture parts of the URL:

```js
import HomeView from './views/Home.pzl';
import UserView from './views/User.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home' } },
  { path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout, meta: { title: 'User Profile' } },
];
```

Navigating to `/user/42` matches the `user` route with `params.id === '42'`. Param values arrive as strings — convert them yourself if your model uses numeric ids.

---

## Params in the View: `data(params, props)`

`:param` segments arrive as the first argument to the view's `data()` method:

```js
// views/User.pzl <script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class UserView extends PuzzleView {
  async data(params, props) {
    // /user/:id  →  params.id
    const user = await this.ctx.store.findOne('user', params.id);
    return { user };
  }
}
```

```html
<puzzle-view class="user-page">
  <h1>{ user.fullName }</h1>
  <p>{ user.email }</p>
</puzzle-view>
```

**Params are reactive.** Per [[DOC-SPEC]] §4, `data()` re-runs on route-param change — navigating from `/user/42` to `/user/7` re-runs the same view's `data()` with the new `params`, rather than tearing the view down and rebuilding it. You don't need to watch the URL yourself; just read `params` in `data()` and the framework keeps the view in sync.

`data()` may be `async`; the router waits for it to resolve before rendering the new view (see [Route Lifecycle](#route-lifecycle-in-v1)).

---

## The route snapshot: `this.route` (v1.15)

**Settled (D47, SPEC §19).** Inside any routed `data()` run, `this.route` is `{ path, pathname, query, hash, route, params, chain }` (the parsed `pathname`/`query`/`hash` fields joined in v1.49 — next section) — the same shape as `router.current` — describing **the navigation this `data()` run belongs to**. Use it for anything derived from "where is the app navigating", most importantly active-nav highlighting:

```js
// AccountShell.pzl — parent view whose <Slot/> hosts Profile / Trips / Wishlist
data(params, props) {
  const name = this.route.route.name;      // leaf route name of THIS navigation
  return {
    isProfile:  name === 'account-profile',
    isTrips:    name === 'account-trips',
    isWishlist: name === 'account-wishlist',
  };
}
```

Why not `window.location.pathname` or `ctx.router.current`? Both describe the **committed** state, and a routed `data()` runs **before** the commit (D19: data gates the URL). For a reused ancestor — exactly the view that owns tab navs — they are one navigation stale, which paints the *previous* tab as active. They're also mode-dependent (`location.pathname` never moves in hash mode, doesn't exist meaningfully in memory mode). `this.route` is correct in the gate, on back/forward, and in all three modes.

- Match on **route names** (`this.route.route.name`, or `this.route.chain[0].name` for section-level highlighting), not on `path` — `path` is the raw pushed path and can carry `?query` and `#anchor` suffixes (v1.10).
- Store-change re-runs keep the snapshot; only the next navigation replaces it.
- `this.route` is `null` in components the router doesn't manage — pass route-derived state down as props from the routed view.

---

## URL-backed transient state: `query`, `hash`, and `replace()` (v1.49)

**Settled (D83, SPEC §44).** Filters, tabs, search terms, pagination — transient UI state that belongs in the URL so it's shareable, reload-safe, and deep-linkable. v1.49 gives it a read surface and a write surface.

**Reading.** The route snapshot (`this.route`, `router.current`) carries three parsed fields alongside the raw `path`:

- `pathname` — `path` minus query and hash (still base-free).
- `query` — a **frozen, null-prototype object** parsed with `URLSearchParams` decoding: a single value is a string (`?q=cabin` → `{ q: 'cabin' }`), repeated keys become a frozen array in source order (`?tag=a&tag=b` → `{ tag: ['a', 'b'] }`), a valueless key is `''` (`?debug` → `{ debug: '' }`). Malformed percent input never throws.
- `hash` — `''` or the raw fragment including the leading `#`.

Query values **never merge into route `params`** — `data(params)` signatures are unchanged; views read `this.route.query`. Parsing happens once per navigation, so reading `query` is free.

**Writing: `router.replace(path)`.** Push's no-history-entry sibling: the identical match/load/cancellation/atomic-commit pipeline (a failed or superseded replace commits nothing), the same same-path no-op guard. The differences are the point: it **replaces the current history entry** instead of minting one — fifty filter keystrokes are not fifty Back presses — and it **never touches scroll by default** (a keystroke must not jump the page; a custom `scrollBehavior` function still runs and may override). A query-only replace to the same route re-runs the view's `data()` with the new snapshot — no `refresh()` needed.

The per-keystroke filter pattern:

```html
<input value={ q } placeholder="Filter…" @input={ updateFilter(event) } />
```

```js
data() {
  const q = this.route?.query?.q ?? '';
  const needle = q.trim().toLowerCase();
  const items = this.ctx.store.findMany('item')
    .filter((it) => it.title.toLowerCase().includes(needle));
  return { q, items };
}

events = {
  updateFilter: (event) => {
    const v = event.target.value;
    this.ctx.router.replace(v ? '/items?q=' + encodeURIComponent(v) : '/items');
  },
};
```

Each keystroke replaces the URL in place, the snapshot updates, `data()` re-runs with the new `query`, and the list recomputes — and `/items?q=cabin` is now a shareable link that reproduces the filtered view on load. Use `push()` instead when the state change should be a Back-button stop (e.g. moving between wizard steps); use `replace()` for state a user churns through. In static output (`output: 'static'`) there is no router — `replace` throws like every navigation method (working example: `examples/stays`, the Search view's destination filter).

---

## Layouts and `<Slot/>`

Every route names a `layout` — a normal `.pzl` component whose template contains a single `<Slot/>`. When the route renders, the routed view is placed exactly where the `<Slot/>` sits. This gives every page shared chrome (header, footer, nav) without repeating markup in each view.

The real layout from the todos app ([examples/todos/app/layouts/Default.pzl](../examples/todos/app/layouts/Default.pzl)), trimmed to structure:

```html
<puzzle-view class="min-h-screen flex flex-col">
  <header class="py-8">
    <h1>Puzzle Todos</h1>
  </header>

  <main class="flex-1 py-12">
    <div class="max-w-2xl mx-auto px-5">
      <Slot/>   <!-- the routed view renders here -->
    </div>
  </main>

  <footer class="py-6">
    <p>Made with Puzzle Framework</p>
  </footer>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class DefaultLayout extends PuzzleView {
  data(params, props) {
    return {
      title: props.title || 'Puzzle Todos'
    };
  }
}
</script>
```

Layouts are full `PuzzleView` components — they can have `data()`, `events`, and lifecycle hooks like any other component. Different routes can use different layouts (e.g. `DefaultLayout` for pages, `AuthLayout` for login).

Note: `<Slot/>` is the **router outlet** — the place the router injects the routed view. Reusable components use `<children/>` for their default marker and `<slot name="…">` for named slots (v1.21, D53; the bare lowercase `<slot/>` was retired in v1.41, D74); scoped slots remain deferred. See [[DOC-SPEC]] §24.

---

## Nested Routes (v1.3)

**Settled (D30, SPEC §9).** A route can declare nested child routes with `children: [...]`. A **routed view** then hosts its matched child at its own `<Slot/>` — the same injection mechanism layouts already use. This is how you build a shell-with-panes section (a `/settings` shell whose `/settings/profile` and `/settings/billing` panes swap while the shell chrome stays put) without one flat view per URL.

```js
// routes.js
import DefaultLayout from './layouts/Default.pzl';
import SettingsShell from './views/SettingsShell.pzl';
import SettingsHome  from './views/SettingsHome.pzl';
import ProfileView   from './views/Profile.pzl';
import BillingView   from './views/Billing.pzl';

export default [
  {
    path: '/settings',
    name: 'settings',
    view: SettingsShell,       // renders the matched child at its <Slot/>
    layout: DefaultLayout,     // layout is top-level only
    meta: { title: 'Settings' },
    children: [
      { path: '',        name: 'settings-index',   view: SettingsHome },   // matches /settings
      { path: 'profile', name: 'settings-profile', view: ProfileView, meta: { title: 'Your Profile' } },
      { path: 'billing', name: 'settings-billing', view: BillingView },
    ],
  },
];
```

The `SettingsShell` view just drops a `<Slot/>` where the active pane should render — exactly like a layout:

```html
<puzzle-view class="settings">
  <nav class="settings-tabs">
    <a href="/settings/profile">Profile</a>
    <a href="/settings/billing">Billing</a>
  </nav>
  <section class="settings-pane">
    <Slot/>   <!-- the matched child view renders here -->
  </section>
</puzzle-view>
```

### Relative paths and index children

- Child paths are **relative** — they compose onto the parent (`/settings` + `profile` → `/settings/profile`). An **absolute** child path (leading `/`) is a config error and throws at construction.
- An **index child** with `path: ''` composes to exactly the parent path, so it matches the bare `/settings` URL.
- A parent that has `children` but **no** index child does **not** match its own bare URL — `/settings` then falls through to the catch-all (`'*'`). This is deliberate: an empty pane is almost always a mistake, so you opt in to "what shows at `/settings`" with an explicit `path: ''` child.

### Layouts stay at the top

`layout` is a **top-level-route field**. Layouts are root shells (an auth wall, the app chrome), so children inherit the chain's layout and never declare their own — a `layout` on a child throws. A layout only ever swaps when the chain diverges at its very first segment.

Route guards (v1.53) make the auth wall literal: a `guard` on the top-level route locks the layout's whole subtree with one declaration — see [Route guards](#route-guards-v153).

Other config errors that throw at construction: `path: '*'` inside a `children` array, and a duplicated `:param` name within one chain (e.g. `:id` at two levels).

### Params merge down the chain

The full URL is matched once and **every level's `data(params)` receives the full merged params object** — the parent view and the child view (and the layout) all see the same `params`. This mirrors how a layout already receives the routed view's params in flat routing.

```js
// routes: /org/:orgId  →  children: [{ path: 'team/:teamId', view: TeamView }]
// URL /org/9/team/42  →  every level's data() gets { orgId: '9', teamId: '42' }

export default class TeamView extends PuzzleView {
  async data(params) {
    const team = await this.ctx.store.findOne('team', params.teamId); // teamId from the leaf segment
    return { team };
  }
}
```

`meta.title` is resolved **nearest-defined, leaf → root**: navigating to `/settings/profile` uses the leaf's `'Your Profile'`; `/settings/billing` (no leaf title) inherits the parent's `'Settings'`.

### Reuse and transitions

Navigating between siblings reuses the shared chain prefix. Going from `/settings/profile` to `/settings/billing`, the `SettingsShell` **instance is kept** — its `data()` re-runs with the new merged params (and is **awaited before the URL commits**, per D19) and only its `<Slot/>` content swaps; the profile pane is torn down and the billing pane mounted. Nothing above the divergence point is recreated.

Transition animations follow the generalized one-animator rule (D28 → D30): **the topmost swapped view animates, and everything below rides along.** On a sibling-pane swap the reused shell doesn't animate — only the pane does. When the chain diverges higher up (e.g. leaving `/settings` entirely for `/dashboard`), the shallower swapped view is the animator and the deeper fresh views mount without their own enter animation. Full mechanics: [[DOC-VIEW-LIFECYCLE]] §4 and [[DOC-DECISIONS]] D30.

> Note: a parent view that omits `<Slot/>` from its template preloads its child but has nowhere to render it — a dev warning fires. Give every non-leaf view a `<Slot/>`.

Flat routes (no `children`) are entirely unchanged by this feature.

---

## Navigation

### Programmatic: `router.push()`

Navigate from component code via the router on the context object:

```js
events = {
  openUser: (user) => {
    this.ctx.router.push(`/user/${user.id}`);
  },

  goHome: () => {
    this.ctx.router.push('/');
  },
};
```

`push()` updates the URL with the history API (`pushState`), matches the new route, and runs the route lifecycle below. The browser's back/forward buttons work as expected.

### Link clicks are intercepted automatically

Plain `<a>` tags pointing at app routes are handled by the router — no special link component is needed:

```html
<a href="/user/42">View profile</a>   <!-- client-side navigation, no page reload -->
```

The router leaves links alone (letting the browser handle them normally) when they clearly aren't in-app navigations:

- **External links** — hrefs to a different origin (`https://example.com/...`)
- **`download` attribute** — `<a href="/report.pdf" download>`
- **`target` attribute** — `<a href="/user/42" target="_blank">`

Modified clicks (Cmd/Ctrl-click to open in a new tab) also fall through to the browser.

### `meta.title` and head metadata (v1.50)

On every successful navigation, the matched route's `meta.title` is written to `document.title`, so the browser tab reflects the current page. Routes without `meta.title` leave the title unchanged.

**Settled (D84, SPEC §45).** `meta` also carries three more reserved head fields — `description`, `canonical`, `socialImage` — rendered as **managed head tags**: `title` derives `og:title` + `twitter:title`, `description` derives the standard description meta + `og:description`/`twitter:description`, `canonical` derives `<link rel="canonical">` + `og:url`, and `socialImage` derives `og:image` + `twitter:image` (+ `twitter:card`). Every managed tag carries a `data-puzzle-head` marker, and the framework only ever creates, updates, or removes marker-bearing tags — your hand-written head elements are never touched. Values are **static strings** (`null` to suppress an inherited value; no functions or data-derived values), each resolved independently leaf → root exactly like the title walk above.

The head sync rides the **same atomic commit as the title** — a failed or superseded navigation touches neither — and both prerender output modes bake the same tags into each page's HTML, so crawlers and link-preview bots see them **before any JavaScript runs** (on hybrid takeover the SPA adopts the prerendered tags in place, no duplicates). Define root-route defaults for any field you use, so child routes can't leave a stale inherited value showing. Memory mode remains a full document no-op — an embedded app must not touch the host page's head.

---

## Route guards (v1.53)

**Settled (D87, SPEC §48).** Any route can declare a `guard` — a function that runs **before** the navigation constructs views, loads data, or commits anything, and decides whether the user may go there. The canonical use is an auth wall:

```js
// routes.js
const requireAuth = ({ to, ctx }) => {
  if (ctx.store.findMany('session').length === 0) {
    return '/login?redirect=' + encodeURIComponent(to.path);
  }
};

export default [
  { path: '/login', name: 'login', view: LoginView, layout: MainLayout },
  {
    path: '/account',
    name: 'account',
    view: AccountShell,
    layout: MainLayout,
    guard: requireAuth,        // locks /account and every child below it
    children: [
      { path: '',      name: 'account-profile', view: ProfileView },
      { path: 'trips', name: 'account-trips',   view: TripsView },
    ],
  },
];
```

### Guard the parent — the subtree is covered

A guard covers its own node **and every descendant**: children never repeat it. Because `layout` is a top-level field, a guard on a top-level route is exactly "this layout is locked down." A child may additionally declare its own guard for a stricter sub-section — the navigation runs every guard along the matched chain **root → leaf, sequentially, first failure wins**:

```js
{
  path: '/account',
  guard: requireAuth,                    // runs first, covers everything below
  children: [
    { path: '',      view: ProfileView },                       // requireAuth
    { path: 'admin', view: AdminView, guard: requireAdmin },    // requireAuth, then requireAdmin
  ],
}
```

Guards re-run on **every** matched navigation — pushes, link clicks, back/forward, params-only changes (`/user/1` → `/user/2`), query-only changes, and the initial navigation (where `from` is `null`).

### The guard function and its verdicts

`guard({ to, from, ctx })` — `to`/`from` are frozen route snapshots (the `router.current` shape: `path`, `pathname`, `query`, `hash`, `route`, `params`, `chain`); `ctx` is the same three-service context views get (`store`, `router`, `formatters`).

| Return | Effect |
| ------ | ------ |
| `undefined` / `true` | Allow — the next guard in the chain runs, then the normal load-then-commit pipeline. |
| `false` | Block — stay put. Nothing commits: no URL, history, title, tree, or scroll change. |
| a path string | Redirect — the **router** performs it with `replace()` semantics, so the denied URL never becomes a history entry. The destination's own guards run normally. |

Guards may be `async`; the router awaits each one before proceeding, and a navigation superseded during the await abandons silently. A guard that **throws** is treated like a failed `data()`: the error is logged and the app stays put. Redirect loops are capped (ten guard redirects without a commit log an error and stay put); a guard redirect to the path you're already on is the normal same-path no-op.

### Denied means nothing happened

Guards run before the D19 load gate, so a blocked or redirected navigation never constructs the denied view, never runs its `data()`, and never touches the URL — there is no flash of protected content and no partial commit. This also means guards are cheap to run on every navigation: a synchronous store read costs nothing.

### Sessions and redirect-after-login

Restore any persisted session in the app-level `beforeMount(app)` hook (v1.31, D66) — it is awaited **before** the initial navigation, so guards can be synchronous store reads. For returning the user to the page they were denied, the guard encodes it in the query (as in `requireAuth` above) and the login view reads it back:

```js
// Login.pzl <script> — after a successful sign-in
const redirect = this.route.query.redirect;
this.ctx.router.replace(typeof redirect === 'string' ? redirect : '/');
```

`replace()` keeps `/login` itself out of the back stack. See `examples/stays` for the full working flow.

### Guards are UX, not security

A client-side guard gates **rendering and navigation** — your API must authorize every request independently. Two build-time reminders exist (warnings only, no behavior change):

- **Hybrid output** warns for each prerendered page whose chain declares a guard — its markup ships publicly in `dist/`. Set `prerender: false` on the guarded route to exclude it (that's the quiet opt-out).
- **Static output** warns when any route declares a guard — static pages have no router, so guards never run there.

---

## Route Lifecycle in v1

What happens on navigation, in order:

```
router.push('/user/42')  (or intercepted link click, or back/forward)
      ↓
1. Route matched against the routes array (params extracted)
      ↓
2. Route guards run root → leaf (v1.53) — a block or redirect ends the
                                 navigation here; nothing below happens
      ↓
3. New view created()          — initialize local state with setData()
      ↓
4. New view data(params) runs  — awaited if async; store queries auto-subscribe
      ↓
5. render()                    — view rendered into the layout's <Slot/>;
                                 document.title set from meta.title
      ↓
6. New view mounted()          — DOM is live; old view is destroyed()
```

If only params changed on the *same* route (`/user/42` → `/user/7`), the view is not recreated — its `data()` re-runs with the new params (step 4 onward, guards included).

**Route transition animations (v1.1).** When a view declares an `animations` class field, navigation plays it: the old view runs its `out` animation and is destroyed, then — atomically with the new view mounting (v1.28, D61) — the URL/title commit and the new view runs its `in` animation — **sequentially** (not overlapping). A navigation superseded or failed during the `out` phase commits nothing. Four lifecycle hooks bracket the phases (`viewWillHide`/`viewDidHide` around `out`, `viewWillShow`/`viewDidShow` around `in`) and fire even for views without an `animations` field. One animator per transition: a view swapped inside a **reused** layout animates alone; a **layout swap** animates the layout as the unit. Full contract: [[DOC-SPEC]] §12 and [[DOC-DECISIONS]] D28. Cross-fade/overlapping transitions shipped in v1.24 — next paragraph.

**Overlapping transitions (v1.24, D56).** Opt in app-wide with `transitionMode: 'overlap'` in the PuzzleApp config: the old view's `out` and the new view's `in` play **concurrently** (cross-fades, shared-axis slides). The router pins the leaver in place — inline `position: fixed` at its measured rect, `pointer-events: none`, no wrapper element — mounts the newcomer immediately (the D19 commit point is unchanged), and tears the leaver down when its out settles. Interruption stays instant (at most two route elements ever coexist). Constraints: ancestors of the mount container must not carry `transform`/`filter`/`contain` (they re-root the `fixed` pin), and combining with a registered morph handler is best-effort — pick one mechanism per app. Sequential remains the default; omit `transitionMode` and nothing changes. Full contract: [[DOC-SPEC]] §26 and [[DOC-DECISIONS]] D56.

**Skeleton views don't gate on data (v1.8, D39).** A fresh routed view (or layout) whose `.pzl` declares a `<puzzle-skeleton>` does **not** gate the commit on its `data()`: the navigation proceeds without awaiting the load, the view mounts showing its skeleton, and the real content patches in when the data commits. (Since v1.28/D61 the URL/title ride the swap itself, so in sequential mode they still follow the outgoing view's `out` animation — the skeleton exemption bypasses the *data* gate, not the transition.) Reused ancestors still gate (visible content never regresses), and skeleton-less views keep the D19 await-then-commit semantics exactly. The traded guarantee: a skeleton view's failed load is logged after the URL has already moved — the skeleton stays up, and surfacing the error is the view's job. See [[DOC-SPEC]] §16.

**Shared-element morph transitions (v1.23, D55).** Mark two elements with the same `data-puzzle-morph` value — a card on a persistent view and the shell of a route-mounted dialog — and activate with one line in app.js: `enableMorph(app)` from `@magic-spells/puzzle/morph` (requires the optional peer `@magic-spells/morph-engine`). Navigating to the dialog's route morphs it open out of the card; navigating away (close button, backdrop, **browser back**) morphs it shut — the router awaits the reverse flight before destroying the outgoing view, riding the same sequential out phase as `animations.out`. The initial navigation never morphs (deep links render plainly), params-only navigations never trigger it, and `prefers-reduced-motion` disables it. Morph elements must not use transform-based positioning, stylesheet `opacity`, or a changing dynamic `style={}` binding, and morphing views shouldn't also declare `animations.in/out`. See [[DECISION-D55-MORPH-TRANSITIONS]] and `examples/kanban-morph`.

**Cross-view morphs (v1.35, D68).** The pairing also works when the two elements never coexist — a card in a list view and the header of its sibling detail view. `enableMorph` captures the outgoing view's morph elements at the leave phase (while they're still measurable) and flies a clone into the matching element of the entering view, both directions including browser back/forward, skeleton views included (the flight waits for the real template). Nothing to configure — the same attribute and the same one-line opt-in. The target view's `in` animation should be opacity-only (the flight measures the landing rect once at start). For **directional** morphs (v1.36, D69), use the role spellings instead of plain: `data-puzzle-morph-trigger="id"` on the list card (launches, never receives) and `data-puzzle-morph-target="id"` on the detail header (receives — preferred over a plain element when the id appears twice in the arriving view — and never launches), which makes the pair forward-only: going back renders the list plainly. Plain `data-puzzle-morph` on both ends stays the symmetric, round-tripping spelling for dialogs. See [[DECISION-D68-CROSS-VIEW-MORPH]], [[DECISION-D69-MORPH-ROLES]], and `examples/music`.

---

## Scroll Behavior (v1.5)

**Settled (D33, SPEC §14).** By default the router manages **window scroll** for you, so navigating to a new route starts at the top and back/forward returns you to where you were. You don't wire anything up — it's on by default.

| Navigation | Default scroll |
| ---------- | -------------- |
| `push()` / intercepted link | Scroll to the top (`0, 0`). |
| `push()` to a path with a `#anchor` (v1.10) | Scroll to that element (`getElementById`); **top** if it isn't in the DOM. |
| Back / forward (popstate) | Restore the position that entry was at when you left it; **top** if none was saved. |
| Initial navigation (first paint) | Untouched — the browser owns first paint. |
| Failed / superseded navigation | Untouched — scroll is applied only when a navigation actually commits. |

Saved positions live in memory and — since v1.10 (D41) — are mirrored to `sessionStorage` (capped at 50 entries, fail-soft if storage is unavailable), so **back/forward restore survives a full page reload**. The landing happens after the new view has mounted and after the old view's `out` animation finishes, so there's no jump mid-transition.

### Anchor targets (v1.10)

**Settled (D41, SPEC §14).** `push('/docs#faq')` — or a link like `<a href="/docs#faq">` (the interceptor keeps the fragment) — lands the window at the element with that id once the view has mounted, falling back to top when the element isn't in the committed DOM (e.g. a skeleton view whose real template hasn't landed — the router never re-scrolls after the fact). On back/forward the saved position wins over the anchor, and a custom `scrollBehavior` function wins over everything — the anchor rides in `to.path` if you want to handle it yourself. In hash mode the anchor rides inside the fragment: `push('/docs#faq')` writes `#/docs#faq`, and `<a href="#/docs#faq">` is a route link; bare `#faq` hrefs remain native anchors (with the hash-mode caveat below).

### Opting out: `scrollBehavior: false`

If your app's shell scrolls an **inner panel** rather than the window, a window scroll-to-top is meaningless — so turn scroll management off entirely with `scrollBehavior: false` in the `PuzzleApp` config. This is what the music example does: its layout is `overflow-hidden` and only a track-list column scrolls, so the router should keep its hands off `window`.

```js
// app.js
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  scrollBehavior: false,   // shell scrolls an inner panel — leave window scroll alone
});
```

### Customizing: `scrollBehavior(to, from, savedPosition)`

Pass a function to decide the landing per navigation. It returns `{ x, y }` to scroll there, or a falsy value (`null`/`false`) to leave scroll alone.

| Argument | Shape | Notes |
| -------- | ----- | ----- |
| `to` | `{ path, params, route, chain }` | The route being navigated to. |
| `from` | `{ path, params, route, chain }` | The route being left; `null` on the initial navigation. |
| `savedPosition` | `{ x, y }` or `null` | The target entry's saved position — **non-null only on back/forward**; `null` on `push()`. |

For example, keep the scroll position when moving between the panes of an `/account` section, but scroll to the top for every other navigation:

```js
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  scrollBehavior: (to, from, savedPosition) => {
    // Back/forward: honor the remembered position.
    if (savedPosition) return savedPosition;
    // Staying within /account/* — don't jump the user around.
    if (to.path.startsWith('/account') && from?.path.startsWith('/account')) return null;
    // Everything else: top.
    return { x: 0, y: 0 };
  },
});
```

A function that **throws** is logged and treated as "leave scroll alone" — the navigation itself is unaffected.

---

## Hash mode (v1.6)

**Settled (D34, SPEC §15).** By default the router routes off the pathname, which needs the `index.html` history-API fallback above. On a **static host you can't configure** — GitHub Pages, an S3 bucket, `file://` — that fallback doesn't exist, so a deep link or a reload would 404. Opt into **hash mode** and the route rides in `location.hash` instead; the pathname never changes, so **no server rewrite rules are needed**.

```js
// app.js
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  routerMode: 'hash',   // route lives in location.hash; default is 'history'
});
```

The URL then looks like `https://host/app/index.html#/user/123?tab=posts` — the pathname stays put and the route (with any query) lives after the `#`.

### Your routes, `push()`, and params don't change

The app-facing API is **path-shaped in both modes** — no `#` ever appears in your code:

- Route definitions are identical (`{ path: '/user/:id', ... }`).
- `this.ctx.router.push('/user/123')` is unchanged.
- `router.current.path` is `'/user/123'`, and `params.id` is `'123'`.

Flip `routerMode` in that one config line and everything else — views, layouts, nested routes, `meta.title` — behaves exactly as before.

### Links

**Write links path-shaped with the `link` formatter (v1.46, D79)** — the portable spelling that works in every mode:

```html
<a href="{ '/about' | link }">About</a>
<a href="{ '/user/' + user.id | link }">{ user.name }</a>
```

The formatter calls `router.url(path)` at render time: history mode renders `/about` (prefixed under a `routerBase`), hash mode renders `#/about`, memory mode leaves it unchanged. Strings not starting with `/` pass through untouched, so external URLs and `mailto:` links can be piped safely (or just not piped). Because the **attribute itself** is rewritten, cmd-click, open-in-new-tab, and copy-link all get the correct URL — something click interception alone could never fix. Flipping `routerMode` (or `routerBase`) is then truly a one-line change with zero template edits. `router.url()` is also public for script-land hrefs.

How the interceptor treats hrefs in hash mode (unchanged by D79):

- `<a href="#/about">` is a **route link** — intercepted and routed via `push` (full commit semantics). Hand-written hash hrefs remain valid; `| link` is the portable spelling.
- A bare `<a href="#faq">` stays a **native in-page anchor** — the router leaves it to the browser.
- A same-origin link with a **different pathname** falls through to the browser (a real navigation away from the app shell) — deliberately *not* claimed, so plain-path escape-hatch links keep working; that's also why path-shaped route links must go through `| link`.

> **Caveat (inherent to hash routing).** Clicking a bare in-page anchor (`#faq`) replaces the whole fragment, which clobbers the current route from the URL. The rendered view survives and **back** returns you to the route, but the URL no longer names it while you're on the anchor. This is true of hash routing everywhere, not a Puzzle quirk — hash-mode apps should avoid bare-anchor links.

### Everything else works identically

Scroll behavior (v1.5), transition animations (v1.1), and nested routes (v1.3) all work the same in hash mode: the D19 commit is still atomic (the URL moves only after `data()` resolves; a failed nav moves nothing), scroll keys still ride in `history.state`, and back/forward still restore. The router listens on `popstate` only in both modes — an in-page anchor traversal is ignored and never tears down the app.

---

## Memory mode (v1.11)

**Settled (D42, SPEC §15).** The third `routerMode`: the route lives entirely in router state — `location`, `history`, and `document.title` are **never read or written**. Two audiences: **tests** (navigate and assert without jsdom history gymnastics) and **embedded/iframe apps** that must not clobber the host page's URL or tab title.

```js
// app.js
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  routerMode: 'memory',
  routerInitialPath: '/dashboard',   // optional; default '/' (memory mode only)
});
```

Everything app-facing is unchanged: route definitions, `push()`, `current.path`, params, nested routes, transitions, and the atomic commit all behave exactly as in history mode. What's different, all deliberately:

- **Back/forward is programmatic** — there's no browser chrome, so use `router.back()` / `router.forward()` / `router.go(n)` (below). The router keeps its own entry stack with browser semantics (`push()` after going back truncates the forward entries).
- **`meta.title` does not set `document.title`** — an embedded widget must not rename the host page's tab.
- **Scroll management is a no-op** — `scrollBehavior` is accepted but inert; there are no history entries to restore against, and an embed shares the window with its host.
- **`routerInitialPath`** names the first route (there's no URL to read). Setting it in history/hash mode is a constructor throw — the URL is the initial path there.

> **Embed caveat.** Link interception is document-global in every mode, so same-origin pathname links in the *host* page get intercepted too. Keep an embedded app's links scoped, or navigate programmatically.

---

## Base path (v1.19)

**Settled (D51, SPEC §23).** Deploying under a sub-path — `example.com/myapp/…` instead of the domain root — takes one config line. It works in both URL-carrying modes (history and hash) and is inert under memory mode, so the same config runs in tests.

```js
// app.js
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  routerBase: '/myapp',   // leading '/' ensured, trailing '/' trimmed; '' / '/' = no base
});
```

**Your app code stays base-free.** Route definitions, `push('/user/1')`, `router.current`, `params`, and `this.route` never mention the base — only the URL carries it. Internally the base is applied at the path-shape boundary: reads strip it after the mode-specific raw read, writes prefix it before the mode-specific encoding.

```js
// routes.js — no base anywhere
export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
  { path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
];

// in a component — push paths are base-free; the URL that lands is /myapp/user/1
this.ctx.router.push('/user/1');
this.ctx.router.current.path; // '/user/1'
```

**But `<a href>`s carry the base.** An anchor is a *real document URL* — middle-click, copy-link, and open-in-new-tab have to work — so write hrefs with the base (`href="/myapp/user/1"`, or a relative href). Only `push()` paths are base-free.

Per mode:

- **History mode** — the URL is `/myapp/user/1`. The click interceptor intercepts only same-origin URLs **under the base** (stripping it before `push()`); a same-origin link *outside* the base falls through to the browser as a real navigation away from the app. Loaded at a pathname outside the base, the router **warns once** and passes the pathname through un-stripped (typically landing on your catch-all) — visible and debuggable, not silent misrouting.
- **Hash mode** — the base rides in-fragment: `#/myapp/user/1`. The [anchor convention](#anchor-targets-v110) composes untouched (`#/myapp/docs#faq` → path `/docs#faq`). With a base set, the exact `#<base>` fragment (→ `/`) and `#<base>/…` fragments are routes; any other `#/…` fragment is left to the browser like a bare in-page anchor.
- **Memory mode** — there's no URL, so `routerBase` is accepted but **inert** (like `scrollBehavior` there).

**Normalization + validation.** `'myapp'`, `'/myapp'`, and `'/myapp/'` all normalize to `/myapp`; `''` and `'/'` mean no base (a base-less app is byte-identical to before). A base containing `'#'` or `'?'` is a constructor throw. Scroll keys (v1.10) are unaffected — they ride `history.state`, not the URL.

---

## 404 / NotFound Routes

**Settled (D19, SPEC §9):** declare an optional catch-all route with `path: '*'` — it is always matched **last**, regardless of where it appears in your routes array:

```js
import NotFound from './views/NotFound.pzl';

export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout },
  { path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Not Found' } },
];
```

Without a catch-all, an unmatched URL logs a warning and the current view stays put. Full navigation semantics (commit ordering, cancellation, layout reuse): [[DOC-VIEW-LIFECYCLE]] §4.

---

## API Reference (v1 Router Surface)

The router is available in components as `this.ctx.router` (one of exactly three context services: `store`, `router`, `formatters`).

| Member | Signature | Description |
| ------ | --------- | ----------- |
| `push(path)` | `router.push('/user/123')` | Navigate to `path`, run the route lifecycle, update `document.title` (and managed head tags, v1.50) from `meta` (history/hash modes). |
| `replace(path)` (v1.49) | `router.replace('/items?q=cabin')` | Like `push()` — same pipeline, same atomic commit — but **replaces the current history entry** and leaves scroll untouched by default. For URL-backed transient state (see [URL-backed transient state](#url-backed-transient-state-query-hash-and-replace-v149)) — and the redirect verb (auth/guard redirects, post-action redirects). |
| `go(n)` (v1.11) | `router.go(-2)` | Move through history: delegates to `history.go(n)` in history/hash mode; moves the internal stack in memory mode. Out-of-range `n` is a silent no-op. |
| `back()` / `forward()` (v1.11) | `router.back()` | Shorthands for `go(-1)` / `go(1)`. |
| `url(path)` (v1.46) | `router.url('/about')` | Encode a base-free path as a mode-correct href (`/about`, `#/about`, …). Templates should use the `link` formatter, which calls this. |

And that's essentially it for components — `push()`/`replace()`, the v1.11 history methods, `url()`, plus automatic link interception cover the intended navigation surface. Declarative route protection is the `guard` field (v1.53 — see [Route guards](#route-guards-v153)), not a method. Named-route navigation remains **Planned — not shipped** (see [[DOC-SPEC]]). (Hash routing is available as of v1.6, memory mode as of v1.11 — see above.)

---

## Related Documentation

- **[[DOC-SPEC]]** — the frozen v1 contract (§9 covers the router)
- **[[DOC-MODELS]]** — models and schema builders
- **[[DOC-DATASTORE]]** — store queries and reactivity (how `data()` subscriptions work)
- **[examples/todos/app/routes.js](../examples/todos/app/routes.js)** — the canonical route definitions
