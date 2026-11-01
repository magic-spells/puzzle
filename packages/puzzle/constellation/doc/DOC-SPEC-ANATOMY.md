---
name: SPEC — app anatomy, config, and script blocks
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-VIEW-LIFECYCLE
  - DECISION-D185-APP-IDLE
  - DECISION-D188-TICK
  - DECISION-D189-AGENT-HOOKS
  - DECISION-D178-AFTERUPDATE-PREV
verified_at: '2026-11-01T19:26:46.557Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

The contract for app shape: exports and entry points, the app and build config surfaces, `.pzl` file anatomy, the real-JavaScript `<script>` rule, component context, project layout, TypeScript scripts, scoped styles, and the `@` module alias. See [[DOC-SPEC]] for the section index.

## 1. Naming & entry points

The runtime is the npm package `@magic-spells/puzzle`:

```js
import { PuzzleApp, PuzzleView, PuzzleModel, Puzzle, lazy } from '@magic-spells/puzzle';
```

| Export | Purpose |
| --- | --- |
| `PuzzleApp` | Application class. Instantiate once, call `.mount()`. |
| `PuzzleView` | Base class for every `.pzl` component, view and layout. |
| `PuzzleModel` | Base class for models in `app/models`. |
| `Puzzle` | Schema field builders (`Puzzle.string()`, …). |
| `lazy` | Lazy route views (§62). |

The root also exports `PuzzleValidationError` (§20) and, for compiled modules only (not user surface), `FormatterRegistry`, `ViewNode`, the marker tags (`SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG`), `displayValue`, `urlValue`, `listRows`, `loopItems`, `loopRange` and `dynamicComponent`. Subpaths: `./adapter` (§58), `./router-modes` (§15), `./morph` (§37), `./ssg`, `./static`, `./testing` (§53), `./fixtures` (§52), `./puzzle-env`, plus `./formatters/manifest` and `./i18n/manifest`, which a Puzzle build replaces at bundle time.

- Apps start with **`app.mount()`**.
- Components are **class-based** (`extends PuzzleView`). `PuzzleView` is a **plain JavaScript class**, not a custom element and no shadow DOM; the ViewManager owns all DOM work ([[DOC-VIEW-LIFECYCLE]]). `<puzzle-view>` is only the template root element name.

## 2. App configuration

```js
// app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',       // CSS selector or Element for the mount point
  routes,               // route definitions
  models,               // model registry from app/models/index.js
  adapter,              // optional: server sync capability (§58)
  formatters: {         // optional: the app's own template functions
    byline: (name) => (name ? `By ${name}` : 'By an unknown author'),
  },
  apiURL: '/api',       // optional: base URL for adapter requests
});

app.mount();
```

**The whole `PuzzleApp` config:** `target` (required), `routes`, `models`, `formatters`, `apiURL`, `storage` (a Storage-like object for persistence, §8), `adapter` (§58), `beforeRequest` (§49), `scrollBehavior` (§14), `focusBehavior` (§51), `routerMode` (an imported mode object, §15), `routerBase` (§23), `transitionMode` (§26), `beforeMount`/`mounted`/`beforeUnmount` (§34), and `onError`/`errorView` (§60). The `formatters` key registers the app's template **functions** (§6); one named like a standard function (`pluralize`, `currency`, …) replaces it, with a development warning ([[DECISION-D174-STANDARD-FORMATTERS]]). App-level `settings`, `computed`, global `events` and `methods` are rejected ([[DOC-SPEC]] cut list).

**`puzzle.config.js`** is build config. The compiler reads it (`compiler/internal/config`); the runtime never does. Unknown keys are ignored.

| Key | Meaning |
| --- | --- |
| `styles: { use: ['tailwindcss'] }` | The only style pipeline (§11). |
| `build.dropConsole` | Boolean. Production strips `console.*` unless `false` ([[DECISION-D60-DROP-CONSOLE-OPT-OUT]]). |
| `build.sourceMap` | Boolean, default `false`: a linked source map for builds ([[DECISION-D88-SOURCEMAP-OPT-OUT]]). |
| `build.splitting` | Boolean, default `false`: lazy chunks for dynamic `import()` (§59). |
| `build.hashNames` | Boolean, on by default in production: content-hashed output names (§59). |
| `dev.proxy` | `{ '/api': 'http://localhost:8080' }`: same-origin prefixes `puzzle dev` forwards ([[DECISION-D110-DEV-PROXY-PREFIX-VALIDATION]]). |
| `output` | `'static'` or `'hybrid'`; absent is the SPA build (§36). |
| `i18n` | `{ locales, defaultLocale, routing?: 'prefix', detect?: boolean }`: translations (§11, §66, [[DOC-SPEC-BUILD]] §13). |
| `site` | The app's public origin, for `hreflang` and the sitemap ([[DOC-SPEC-BUILD]] §13). |

### `app.idle()` — wait for the app to go quiet

```js
const quiet = await app.idle({ timeout: 10000 }); // true when idle; false on timeout
```

`idle()` resolves `true` once two consecutive frames find no `mount()` or navigation in flight, no store flush or view render pending, no async `data()` running, no `setLocale()` switch loading, and, with the adapter, no tracked find's fetch in flight ([[DECISION-D185-APP-IDLE]]). Each check runs after its frame's callbacks, so a `setData()` render scheduled before it has landed. It resolves `false` when `timeout` ms (default 10000) run out first, and never rejects; a timeout that is not a finite number ≥ 0 logs a development error and uses 10000. A hidden tab steps on timers. An app neither mounted nor mounting resolves `true` at once. It cannot see user timers, animations, IntersectionObserver triggers, writes or fetches nothing awaits (an unawaited `save()` or `loadMany()`), or a path- or hash-mode `back()`/`forward()`/`go()` before its `popstate` fires. Views reach the same method as `this.ctx.idle()` (§10). The testing module's `settled()` drives work to a fixed point instead ([[DOC-TESTING]]).

## 3. `.pzl` file anatomy

```html
<puzzle-view class="my-component">
  <!-- markup + template syntax -->
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class MyComponent extends PuzzleView { ... }
</script>

<style>
/* optional global CSS */
</style>
```

- `<puzzle-view>` is required; `<puzzle-skeleton>` (§16), `<script>` (`lang="ts"`, §25) and `<style>` (`scoped`, §29) are optional. Sections are recognized only at the top level, so a `<script>`/`<style>` element inside a template body is ordinary markup.
- Component imports (other `.pzl` files) live in `<script>`, where esbuild resolves them.
- At most one `<style>` block per file, emitted as global CSS unless `scoped`. Styling is Tailwind-first.
- **Two emission modes ([[DECISION-D20-PUZZLE-VIEW-ELEMENT]]).** Files under `app/views/**` and `app/layouts/**` compile to a real `<puzzle-view>` element carrying the tag's attributes: the boundary navigation swaps and animations target (§12). It is an unknown element, so it is `display: inline` unless the app styles it. **Components render inline** with no wrapper element. For a component, `<puzzle-view>` is only the template delimiter: it must carry **no attributes** (compile error) and the template needs a **single root element**.

## 4. `<script>` blocks are real JavaScript

The contents of `<script>` are standard JavaScript (or TypeScript, §25), no dialect. The compiler hands the block to esbuild **untouched**; the Go compiler never parses the script body. Editors, ESLint, Prettier and TypeScript work with no special tooling.

- `events` and `animations` are **class fields** (`events = { ... };`), with **no commas between class members**.
- Handlers in `events` **must be arrow functions.** The field initializer runs during construction with `this` bound to the instance, so each arrow captures the component. Method shorthand (`addTodo(event) { ... }`) parses, but the runtime calls it as `this.events.addTodo(event)`, so `this` is the events object and `this.setData(...)` throws at event time.

```js
import { PuzzleView } from '@magic-spells/puzzle';

export default class TodoHome extends PuzzleView {
  created() {
    this.setData({ newTodoText: '', currentFilter: 'all' });
  }

  data(params, props) {
    const todos = this.ctx.store.findMany('todo'); // auto-subscribes
    const local = this.getData();
    return {
      todos,
      activeTodos: todos.filter((t) => !t.completed),
      newTodoText: local.newTodoText,
      currentFilter: local.currentFilter,
    };
  }

  events = {
    addTodo: (event) => {
      event.preventDefault();
      const text = this.getData().newTodoText.trim();
      if (text) {
        this.ctx.store.createRecord('todo', { text });
        this.setData('newTodoText', '');
      }
    },
    setFilter: (filter) => this.setData('currentFilter', filter),
  };
}
```

### Class contract

| Member | Kind | Notes |
| --- | --- | --- |
| `data(params, props)` | method (may be `async`) | Returns the component model. Re-runs on mount, prop change, route-param change and subscribed store changes; `setData()` does **not** re-run it. **Two-layer state:** each successful result **replaces** the model layer, so a key the new run omits disappears from `getData()` unless `setData` wrote it. A successful **non-object** result (`undefined`, `null`, a primitive) keeps the previous model layer but still counts as a load. `setData` writes a persistent local layer: a `data()` commit wins over an *earlier* `setData` for the same key, a *later* `setData` wins until the next commit, and local keys the model never returns survive every re-run. |
| `events` | class field (object of arrows) | Template-facing handlers (§5). |
| `created` / `mounted` / `beforeUpdate` / `afterUpdate(prev)` / `destroyed` | methods | Lifecycle hooks, in that order. `prev` is a frozen, shallow `{ props, params, route, data }` of what the previous render drew; a record in `prev.data` is the same live object, so compare a field returned from `data()` ([[DECISION-D178-AFTERUPDATE-PREV]]). |
| `animations` | class field | Declarative enter/leave animations (§12). |
| `renderTick()` | method | `await this.renderTick()` resolves once no store flush or view render is scheduled anywhere in the runtime, including the renders those schedule: the point to read `this.refs` or measure after `setData()` or a store write ([[DECISION-D188-TICK]]). It forces nothing, has no timeout, and does not wait for async `data()`, fetches, navigation, locale loading, animations or timers; that is `app.idle()` (§2). |
| anything else | methods/fields | Plain JS helpers. A template cannot call them; it has no `this` (§6). |

**Reserved names.** `PuzzleView` owns these member names; a subclass member with the same name silently overrides framework behavior:

- **Override points:** `data`, `render` (compiler-attached), `events`, `animations`, `transitionMode` (§33), `renderSkeleton`/`skeletonMinDuration` (§16, compiler-attached), and the hooks `created`, `mounted`, `beforeUpdate`, `afterUpdate`, `destroyed`, `viewWillShow`/`viewDidShow`/`viewWillHide`/`viewDidHide` (§12).
- **Read-only API:** `getData`, `setData`, `memo` (§32), `renderTick`, `ctx`, and the getters `element`, `loaded`, `isDestroyed`, `params`, `props`, `route` (§19). `refs` is the framework-owned element-ref map (§38): read it, never assign it.
- **Framework internals:** `mount`, `preload`, `refresh`, `prepareRefresh`, `applyParentUpdate`, `onStoreChange`, `flushUpdates`, `destroy`, `destroyAnimated`, `playIn`, `playOut`, `skipEnter`, `elementEnd`, and **every member whose name starts with `_` or `__`** (the compiler's `__h` §31, `__ref` §38, `__bind` §6, `__lists` §28, `__c`, `__dirty`, `__rgen`, `__walk`, `__propRevs`, and the dev/adapter `_`-members).
- **On the class:** `__roots`, the top-level `data()` keys some loop body reads (§28).
- **At module scope:** `__L0`, `__L1`, … (one list-block meta const per item-form `{#for}` site) and `__l` (the local bound to `listRows`), reserved only in a file that emits them. These are the only names a `<script>` can actually collide with, so binding one at module scope is a **positioned compile error**, as binding `ViewNode` or `SLOT_TAG` is. The instance and class names above are reserved by convention only.

### Runtime/compiler implementation rules

- Generated `render()` is attached by **prototype assignment after the class** (`TodoHome.prototype.render = ...`); generated code never rewrites the user's class body.
- Class fields initialize **after** `super()` returns, so the `PuzzleView` constructor never reads `this.events`; the runtime reads it lazily at mount.
- **Development builds warn about a non-arrow handler that uses `this`.** At a view's first mount, once per class, each own function value of `events` whose source is not an arrow and mentions `this` (comments and quoted strings aside) warns once, naming the view, the handler and the arrow fix. The check is textual, not a parse: a method literally named `async` reads as an arrow, and a nested `function` using its own `this` warns spuriously. Production removes the check entirely.

## 10. Component context

`this.ctx` holds `store`, `router`, `formatters` (the function registry), and `idle(options?)`, the app's `idle()` bound to the app (§2, [[DECISION-D189-AGENT-HOOKS]]), so a view can await it without holding the app. `i18n` is present only when `puzzle.config.js` configures translations (§66, [[DECISION-D175-TRANSLATIONS]]). With the adapter capability, `ctx.store` is a per-view handle on the app's store, the only channel through which a tracked read may fetch (§61). `this.$app`, `this.$events`, `ctx.utils` and a global event bus are rejected ([[DOC-SPEC]] cut list).

## 11. Project layout & build

- Source directory: **`app/`**. The entry is **`app/app.ts`** when it exists, otherwise **`app/app.js`**; both is a build error naming both files (D54, one resolver for every consumer; [[DOC-SPEC-BUILD]] §13). `puzzle.config.js` stays JavaScript. Output goes to **`dist/`**: `dist/app.js`, or `dist/app-[hash].js` with production name hashing (§59).
- **`app/public/`** is copied verbatim into `dist/`. **`app/assets/`** is compile-time-only input for `{#svg}` (§18), never copied.
- Translations (§66): **`app/locales/<tag>.json`**, one per locale, read only when `puzzle.config.js` declares `i18n: { locales: [...], defaultLocale: '…' }`. `locales` is a non-empty list of distinct BCP 47 tags (`-`, never `_`; compared case-insensitively) that must include `defaultLocale`. Every listed locale needs a file; an unlisted file is skipped with a warning, and `app/locales/` without `i18n` is a warning. Build details: [[DOC-SPEC-BUILD]] §13.
- `.pzl` compilation is an **esbuild plugin**: Go parses templates and generates render functions; esbuild owns module resolution, bundling, sourcemaps and minification.
- CLI: `puzzle build` (production by default) and `puzzle dev` (watch + static server with history fallback + reload); the rest of the CLI is §13.
- Styling: Tailwind-first via `styles: { use: ['tailwindcss'] }`. Sass is **not supported and will not be** ([[DECISION-D12-TAILWIND-FIRST]]); native CSS nesting plus Tailwind cover it.

## 25. TypeScript scripts: `<script lang="ts">`

Opt a component's logic into TypeScript ([[DECISION-D54-TYPESCRIPT-SCRIPTS]]). Codegen and the runtime are untouched; a `<script>` without `lang` (or `lang="js"`) is JavaScript.

```html
<puzzle-view class="home"><h1>{ title }</h1></puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

interface HomeModel { title: string; }

export default class Home extends PuzzleView {
  data(): HomeModel {
    return { title: 'Hello' };
  }
}
</script>
```

- **Attribute:** `lang` is the only attribute `<script>` accepts: `"ts"` or `"js"`. An unknown or empty value, a dynamic `lang={…}`, or a second attribute is a **positioned compile error** (did-you-mean for near-misses like `"typescript"`).
- **Transpile-only:** esbuild strips types; the build never type-checks. Checking is `puzzle check` ([[DECISION-D165-PUZZLE-CHECK]], [[DOC-SPEC-BUILD]] §63), which runs the app's own `tsc` over `.pzl` scripts, template expressions and the app's `.ts` modules. The generated render tail is plain JS (valid TS), so the plugin loads the whole module with esbuild's TS loader.
- **`.pzl` is the only extension**; a separate TypeScript extension was rejected (D54).
- **Typings:** the package ships `types/index.d.ts` (via `exports.types`) and a `puzzle-env.d.ts` shim (`declare module '*.pzl'` → `typeof PuzzleView`). `examples/typed-todos` is the worked example.
- **Scaffold:** `puzzle init --typescript` (or the TypeScript prompt, §42) writes every component as `<script lang="ts">` with typed `data()`, props, events and hooks; `app/app.ts`, `app/routes.ts` and (todos) `.ts` models; a strict/noEmit `tsconfig.json`; and a `package.json` with `typescript` `^7` and `"check": "puzzle check"`. The default stays JavaScript.
- **Generate:** with a `tsconfig.json` at the project root, `puzzle generate` writes TypeScript stubs ([[DOC-SPEC-BUILD]] §13).
- **Authoring note:** under `strict`/`noImplicitAny`, annotate `data(params, props)` and handler params; TypeScript does not contextually type a subclass override from the base declaration.

## 29. Scoped styles: `<style scoped>`

Per-component scoping via native CSS `@scope` ([[DECISION-D59-SCOPED-STYLES]]). A `<style>` without the attribute is global CSS.

- **Grammar:** `scoped` is a **bare, static** attribute and the only one `<style>` accepts. A valued or dynamic `scoped`, or any other attribute, is a positioned compile error (did-you-mean when close).
- **Semantics:** the rules match only inside this component's own rendered subtree. Scoping is **outward containment, not inward**: rules still cascade into nested child components; a child's own scoped rule at equal specificity wins by `@scope` proximity.
- **Mechanism (the compiler never parses CSS):** a scope id per file (`pzl-` + 8-hex FNV-1a of the compiler-relative, slash-normalized path); the template root vnode gains one static `data-<scopeId>` attribute (root only; view-mode skeletons reuse the root's attrs); the block is emitted verbatim inside `@scope ([data-<scopeId>]) { … }`.
- **Browser floor:** Baseline `@scope` engines (Chrome/Edge 118+, Safari 17.4+, current Firefox). An engine without `@scope` treats the block as global, never breakage.
- Renaming a `.pzl` changes its scope id; the attribute and the CSS move together in the same build.

## 40. Module resolution — the `@` app alias

Every bundled import specifier beginning `@/` resolves to the app's `app/` directory ([[DECISION-D75-IMPORT-ALIAS]]): `import Icon from '@/components/Icon.pzl'` means `<project root>/app/components/Icon.pzl` from any depth.

- **Always on, not configurable**; there is no general `resolve.alias` block.
- **Bundle-wide:** `.pzl` `<script>` blocks, the app entry, routes, models, `.ts` files, JSON imports, in `puzzle dev`, `puzzle build`, and the prerender bundle (§36).
- **Relative paths and scoped packages are untouched.** esbuild matches alias keys on segment boundaries, so `@` catches only `@` and `@/…`; `@magic-spells/puzzle` resolves normally.
- **Module resolution only:** not `{#svg}` paths (§18), `<style>` blocks, or `@import` in `styles.css`.
- **Implementation:** one entry in the esbuild `Alias` map, set in `configureRuntime` (`compiler/internal/build/options.go`).
- **Editor support:** `puzzle init` writes `"@/*": ["./app/*"]` into `tsconfig.json` (`--typescript`) or an editor-only `jsconfig.json`, never both, since editors ignore a `jsconfig.json` beside a `tsconfig.json`. The build reads neither.
