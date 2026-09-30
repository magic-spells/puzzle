---
name: SPEC — app anatomy, config, and script blocks
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-VIEW-LIFECYCLE
verified_at: '2026-08-14T05:01:28.843Z'
verified_sha: d74916a0e021b6bb86394551171838fbab161347
---

The contract for app shape: exports and entry points, the app config surface, `.pzl` file anatomy, the real-JavaScript `<script>` rule, component context, project layout, TypeScript scripts, scoped styles, and the `@` module alias. See [[DOC-SPEC]] for the section index.

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

The root also exports `PuzzleValidationError` (§20) and, for compiled modules only, `FormatterRegistry`, `ViewNode`, the marker tags, `displayValue`, `listRows`, `loopItems` and `loopRange` — not user surface. Subpaths: `./adapter` (§58), `./router-modes` (§15), `./morph`, `./ssg`, `./static`, `./testing` (§53), `./fixtures` (§52), `./puzzle-env`.

- Apps start with **`app.mount()`**.
- Components are **class-based** (`extends PuzzleView`). `PuzzleView` is a **plain JavaScript class** — not a custom element, no shadow DOM; the ViewManager owns all DOM mounting and patching ([[DOC-VIEW-LIFECYCLE]]). `<puzzle-view>` is only the template root element name.

## 2. App configuration

```js
// app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',       // CSS selector for the mount element
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

The whole config surface: `target`, `routes`, `models`, `formatters`, `apiURL`, plus the optional `adapter` (§58), `beforeRequest` (§49), `storage` (a Storage-like object for persistence, §8), `scrollBehavior` (§14), `focusBehavior` (§51), `routerMode` (an imported mode object, §15), `routerBase` (§23), `transitionMode` (§26), `beforeMount`/`mounted`/`beforeUnmount` (§34), and `onError`/`errorView` (§60). Translations are configured in `puzzle.config.js`, not here (§66). The `formatters` key registers the app's template **functions** (§6); a function named like a standard one (`pluralize`, `currency`, …) replaces it, with a development warning (D174). App-level `settings`, `computed`, global `events` and `methods` are rejected ([[DOC-SPEC]] cut list).

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

- `<puzzle-view>` is required; `<puzzle-skeleton>` (§16), `<script>` (`lang="ts"`, §25) and `<style>` (`scoped`, §29) are optional. Sections are recognized only at the top level, so a `<script>`/`<style>` **element inside a template body** is ordinary markup.
- Component imports (other `.pzl` files) live in `<script>`, where esbuild resolves them.
- At most one `<style>` block per file, emitted as global CSS unless `scoped`. Styling is Tailwind-first.
- **Two emission modes (D20).** Files under `app/views/**` and `app/layouts/**` compile to a real `<puzzle-view>` element carrying the tag's attributes — the boundary navigation swaps and animations target (§12); the base stylesheet ships `puzzle-view { display: block }`. **Components render inline** with no wrapper element, so nested components never stack wrappers. For a component, `<puzzle-view>` is only the template delimiter: it must carry **no attributes** (compile error) and the template needs a **single root element**.

## 4. `<script>` blocks are real JavaScript

The contents of `<script>` are standard JavaScript (or TypeScript, §25) — no dialect. The compiler hands the block to esbuild **untouched**; the Go compiler never parses the script body. Editors, ESLint, Prettier and TypeScript work with no special tooling.

- `events` and `animations` are **class fields** (`events = { ... };`), with **no commas between class members**.
- Handlers in `events` **must be arrow functions.** The field initializer runs during construction with `this` bound to the instance, so each arrow captures the component permanently. Method shorthand (`addTodo(event) { ... }`) parses, but the runtime calls it as `this.events.addTodo(event)`, so `this` is the events object and `this.setData(...)` throws at event time. Nothing checks this at compile time.

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
| `data(params, props)` | method (may be `async`) | Returns the component model. Re-runs on mount, prop change, route-param change and subscribed store changes; `setData()` does **not** re-run it. **Two-layer state (§35):** each successful result **replaces** the model layer wholesale — a key the new run omits disappears from `getData()` unless `setData` wrote it. A successful **non-object** result (`undefined`, `null`, a primitive) keeps the previous model layer while still counting as a load (`loaded` flips, the view re-renders). `setData` writes a persistent local layer: a `data()` commit wins over an *earlier* `setData` for the same key, a *later* `setData` wins until the next commit, and local keys the model never returns survive every re-run. |
| `events` | class field (object of arrows) | Template-facing handlers (§5). |
| `created` / `mounted` / `beforeUpdate` / `afterUpdate` / `destroyed` | methods | Lifecycle hooks, in that order. |
| `animations` | class field | Declarative enter/leave animations (§12). |
| anything else | methods/fields | Plain JS helpers. A template cannot call them — it has no `this` (§6). |

**Reserved names.** `PuzzleView` owns these member names; a subclass member with the same name silently overrides framework behavior:

- **Override points:** `data`, `render` (compiler-attached), `events`, `animations`, `transitionMode` (§33), `renderSkeleton`/`skeletonMinDuration` (§16, compiler-attached), and the hooks `created`, `mounted`, `beforeUpdate`, `afterUpdate`, `destroyed`, `viewWillShow`/`viewDidShow`/`viewWillHide`/`viewDidHide` (§12).
- **Read-only API:** `getData`, `setData`, `memo` (§32), `ctx`, and the getters `element`, `loaded`, `isDestroyed`, `params`, `props`, `route` (§19). `refs` is the framework-owned element-ref map (§38) — read it, never assign it.
- **Framework internals:** `mount`, `preload`, `refresh`, `applyParentUpdate`, `onStoreChange`, `flushUpdates`, `destroy`, `playIn`, `playOut`, `skipEnter`, `destroyAnimated`, `_localState`, and the compiler-reserved `__h` (§31), `__ref` (§38), `__bind` (§6), `__lists` (the per-owner `{#for}` block registry, §28), `__c` (static-subtree cache), `__dirty` (per-render root mask), `__rgen` (render-pass counter a list block compares to detect a render it missed), `__walk` (one-shot "walk every vnode" flag after a child mount failure) and `__propRevs` (record render-revision snapshot).
- **On the class:** `__roots` — the top-level `data()` keys some loop body reads (§28).
- **At module scope:** `__L0`, `__L1`, … (one list-block meta const per item-form `{#for}` site) and `__l` (the local bound to `listRows` when the file lowers such a site), reserved only in a file that emits them. These are the only names a `<script>` can actually collide with, so binding one at module scope is a **positioned compile error**, as binding `ViewNode` or `SLOT_TAG` is. The instance and class names above are reserved by convention only; shadowing one silently breaks rendering.

### Runtime/compiler implementation rules

- Generated `render()` is attached by **prototype assignment after the class** (`TodoHome.prototype.render = ...`); generated code never rewrites the user's class body.
- Class fields initialize **after** `super()` returns, so the `PuzzleView` constructor never reads `this.events`; the runtime reads it lazily at mount, when wiring handlers.
- **Development builds warn about a non-arrow handler that uses `this`.** Nothing checks the arrow rule at compile time, but at a view's first mount, behind the inline `__PUZZLE_DEV__` probe, `PuzzleView` reads each own function value of `events` once per view class: when its source (`Function.prototype.toString`) is not an arrow and — comments and quoted strings aside — mentions `this`, it warns once naming the view, the handler and the fix (`name: (…) => { … }`, `async` kept). The check is textual, not a parse: a method literally named `async` reads as an arrow (a miss), and a nested `function` that uses its own `this` reads as a use (a spurious warning). Shorthand that never touches `this` stays quiet. esbuild keeps method shorthand and arrows as written for both JavaScript and `<script lang="ts">`, and dev builds are not minified, so the source text is the author's. Production DCEs the call and the function — `TestBuildDevDefineDCE` asserts the message is absent.

## 10. Component context

`this.ctx` holds three services: `store`, `router`, `formatters` (the function registry). A fourth, `i18n`, is present only when `puzzle.config.js` configures translations (§66, [[DECISION-D175-TRANSLATIONS]]). `this.$app`, `this.$events`, `ctx.utils` and a global event bus are rejected ([[DOC-SPEC]] cut list).

## 11. Project layout & build

- Source directory: **`app/`**. The entry is **`app/app.ts`** when it exists, otherwise **`app/app.js`**; both is a build error naming both files (D54 — one resolver, `build.ResolveEntry`, serves every consumer; [[DOC-SPEC-BUILD]] §13). `puzzle.config.js` stays JavaScript. Output: **`dist/`** (`dist/app.js` either way).
- **`app/public/`** is copied verbatim into `dist/`. **`app/assets/`** is compile-time-only input for `{#svg}` (§18), never copied.
- Translations (§66): **`app/locales/<tag>.json`**, one per locale, read only when `puzzle.config.js` declares `i18n: { locales: [...], defaultLocale: '…' }`. `locales` is a non-empty list of distinct BCP 47 tags (`-`, never `_`; compared case-insensitively) that must include `defaultLocale` (not the reserved word `default`). Every listed locale needs a file; an unlisted file is skipped with a warning, and `app/locales/` without `i18n` is a warning. Emitted as `dist/locales/<tag>.<hash>.json` ([[DOC-SPEC-BUILD]]).
- `.pzl` compilation is an **esbuild plugin**: Go parses templates and generates render functions; esbuild owns module resolution, bundling, sourcemaps and minification.
- CLI: `puzzle build` (production by default) and `puzzle dev` (watch + static server with history-API fallback + reload); the rest of the CLI is §13.
- Styling: Tailwind-first via `puzzle.config.js` `styles: { use: ['tailwindcss'] }`. Sass is **not supported and will not be** ([[DECISION-D12-TAILWIND-FIRST]]) — native CSS nesting plus Tailwind cover it.

## 25. TypeScript scripts: `<script lang="ts">`

Opt a component's logic into TypeScript (D54). Codegen and the runtime are untouched; a `<script>` without `lang` (or `lang="js"`) is JavaScript.

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

- **Attribute:** `lang` is the only attribute `<script>` accepts: `"ts"` or `"js"`. An unknown or empty value, a dynamic `lang={…}`, or a second attribute is a **positioned compile error** (did-you-mean for near-misses like `"typescript"`). The body stays an opaque string to Go (D3).
- **Transpile-only:** esbuild strips types; the build never type-checks. Checking is `puzzle check` (D165, [[DOC-SPEC-BUILD]] §63), which runs the app's own `tsc` over `.pzl` scripts, template expressions and the app's `.ts` modules; a plain `tsc` or an editor covers standalone `.ts`/`.js` files, not a `.pzl` `<script>` body. The generated render tail is plain JS (valid TS), so the plugin uses `Loader: LoaderTS` for the whole module; standalone `pzlc` strips types with esbuild's Transform API.
- **`.pzl` is the only extension** (a `.pzt` alias was rejected, D54).
- **Typings:** the package ships `types/index.d.ts` (wired via `exports.types`) and a `puzzle-env.d.ts` shim (`declare module '*.pzl'` → `typeof PuzzleView`). `examples/typed-todos` is the worked example.
- **Entry:** a TypeScript app's entry is `app/app.ts` (§11).
- **Scaffold:** `puzzle init --typescript` (or the TypeScript prompt, §42) writes every component as `<script lang="ts">` with typed `data()`, props, events and hooks; `app/app.ts`, `app/routes.ts` and (todos) `.ts` models; a strict/noEmit `tsconfig.json`; and a `package.json` with `typescript` `^7` and `"check": "puzzle check"`. The default stays JavaScript.
- **Generate:** with a `tsconfig.json` at the project root, `puzzle generate` writes TypeScript stubs, `app/models/<name>.ts` and an `index.ts` family barrel ([[DOC-SPEC-BUILD]] §13).
- **Authoring note:** under `strict`/`noImplicitAny`, annotate `data(params, props)` and handler params — TypeScript does not contextually type a subclass override from the base declaration.

## 29. Scoped styles: `<style scoped>`

Per-component scoping via native CSS `@scope` (D59). A `<style>` without the attribute is global CSS.

- **Grammar:** `scoped` is a **bare, static** attribute and the only one `<style>` accepts. A valued or dynamic `scoped`, or any other attribute, is a positioned compile error (did-you-mean when close). One `<style>` per file.
- **Semantics:** the rules match only inside this component's own rendered subtree. Scoping is **outward containment, not inward**: rules still cascade into nested child components (no hard boundary); a child's own scoped rule at equal specificity wins by `@scope` proximity.
- **Mechanism (the compiler never parses CSS):** a scope id per file (`pzl-` + 8-hex FNV-1a of the compiler-relative, slash-normalized path); the template root vnode gains one static `data-<scopeId>` attribute (root only; view-mode skeletons reuse the root's attrs); the block is emitted verbatim inside `@scope ([data-<scopeId>]) { … }`. The Tailwind pipeline is untouched.
- **Browser floor:** Baseline `@scope` engines (Chrome/Edge 118+, Safari 17.4+, current Firefox). An engine without `@scope` treats the block as global — never breakage.
- Renaming a `.pzl` changes its scope id; the stamped attr and the CSS move together in the same build.

## 40. Module resolution — the `@` app alias

Every bundled import specifier beginning `@/` resolves to the app's `app/` directory (D75): `import Icon from '@/components/Icon.pzl'` means `<project root>/app/components/Icon.pzl` from any depth.

- **Always on, not configurable.** `app/` is the fixed source root, so the anchor needs no config. A general `resolve.alias` block is deferred.
- **Bundle-wide:** `.pzl` `<script>` blocks, the app entry, routes, models, `.ts` files, JSON imports — in `puzzle dev`, `puzzle build`, and the prerender bundle of `--static` / `--hybrid` (§36).
- **Relative paths and scoped packages are untouched.** esbuild matches alias keys on segment boundaries, so `@` catches only `@` and `@/…`; `@magic-spells/puzzle` resolves normally (npm cannot publish a package named `@`).
- **Module resolution only** — not `{#svg}` paths (§18), `<style>` blocks, or `@import` in `styles.css`.
- **Implementation:** one entry in the esbuild `Alias` map, set in `configureRuntime` (`compiler/internal/build/options.go`).
- **Editor support:** `puzzle init` writes `"@/*": ["./app/*"]` into `tsconfig.json` (`--typescript`) or an editor-only `jsconfig.json` — exactly one, since editors ignore a `jsconfig.json` beside a `tsconfig.json`. The build reads neither.
