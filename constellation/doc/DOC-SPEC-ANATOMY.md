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
notes:
  - kind: verified
    text: >-
      Sections moved byte-for-byte from DOC-SPEC (scripted split, verified by SHA-identical section
      census); §N numbers unchanged
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
---

The frozen v1 contract for app shape: exports and entry points, the app config surface, `.pzl` file anatomy, the real-JavaScript `<script>` rule, component context, project layout, TypeScript scripts, scoped styles, and the `@` module alias. See [[DOC-SPEC]] for the section index and the rest of the contract.

## 1. Naming & entry points

The runtime ships as the npm package `@magic-spells/puzzle` with four exports:

```js
import { PuzzleApp, PuzzleView, PuzzleModel, Puzzle } from '@magic-spells/puzzle';
```

| Export        | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `PuzzleApp`   | Application class. Instantiate once, call `.mount()`. |
| `PuzzleView`  | Base class for all `.pzl` components/views/layouts.  |
| `PuzzleModel` | Base class for models in `/models`.                  |
| `Puzzle`      | Schema field builders (`Puzzle.string()`, …).        |

Decisions this locks in:

- The app class is **`PuzzleApp`** (the runtime's internal `Puzzle` class is renamed; the `Puzzle` name now belongs to the schema-builder namespace).
- Apps start with **`app.mount()`**. `app.run()` is removed.
- Components are **class-based** (`extends PuzzleView`). The `Puzzle.createView` functional path and the duplicate view class generated inside `client-runtime/main.js` are removed.
- `PuzzleView` is a **plain JavaScript class** — not a custom element, no shadow DOM; the ViewManager owns all DOM mounting and patching (D15/D17, see [[DOC-VIEW-LIFECYCLE]]). `<puzzle-view>` survives as the template root element name only.

## 2. App configuration (v1 surface)

```js
// app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',       // CSS selector for the mount element
  routes,               // array of route definitions
  models,               // model registry from /models/index.js
  adapter,              // optional: installs server sync for model adapter configs
  formatters: {         // optional: app-level template formatters
    pluralize: (count, singular, plural) =>
      count === 1 ? singular : plural || singular + 's',
  },
  apiURL: '/api',       // optional: base URL for future remote adapters
});

app.mount();
```

That is the **entire** v1 config surface: `target`, `routes`, `models`, `formatters`, `apiURL`. (v1.5 adds an optional `scrollBehavior` — see §14; v1.6 adds an optional `routerMode`, an imported mode object since D159 — see §15; v1.19 adds an optional `routerBase` — see §23; v1.24 adds an optional `transitionMode` — see §26; v1.31 adds optional `beforeMount`/`mounted`/`beforeUnmount` app lifecycle hooks — see §34; v1.67/v1.71 add the optional `onError` hook and `errorView` view — see §60; v1.72 adds the optional `adapter` capability — see §58.) App-level `settings`, `computed`, global `events` (including keyboard-shortcut strings), and `methods` remain deferred — see the cut list.

## 3. `.pzl` file anatomy

```html
<puzzle-view class="my-component">
  <!-- markup + template directives -->
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class MyComponent extends PuzzleView { ... }
</script>

<style>
/* optional global CSS */
</style>
```

- `<puzzle-view>` is required; `<script>` and `<style>` are optional. (v1.8 adds a fourth optional section, `<puzzle-skeleton>` — see §16.) The section tags are **singular** — `<script>`, `<style>`, plus the attribute forms `<script lang="ts">` (§25) and `<style scoped>` (§29). Sections are recognized only at the top level, so a `<script>`/`<style>` **element inside a template body** is ordinary markup, not a section.
- Component imports (other `.pzl` files) live inside `<script>`, which is where esbuild resolves them.
- At most one `<style>` block per file. Blocks are emitted as global CSS — v1 styling is Tailwind-first via utility classes; since v1.27 a bare `scoped` attribute opts a block into per-component scoping (§29, D59).
- **Two emission modes (D20).** Files under `app/views/**` and `app/layouts/**` compile to a real `<puzzle-view>` DOM element carrying the tag's attributes — the view boundary that navigation swaps and animations target (§12); the base stylesheet ships `puzzle-view { display: block }`. **Reusable components render inline**: the template's contents are emitted with no wrapper element, so `<CustomButton/>` renders as its `<button>` and nested components never stack wrapper elements (a list of items with buttons stays flat). For components, `<puzzle-view>` is only the template delimiter: it must carry **no attributes** (compile error — put them on your root element) and the template needs a **single root element** in v1 (fragments deferred).

## 4. `<script>` blocks are real JavaScript

This is the most consequential rule in the spec. The contents of `<script>` must parse as standard JavaScript — no custom dialect. The compiler extracts the block and hands it to esbuild **untouched**; the Go compiler never parses JS. Editors, ESLint, Prettier, and TypeScript work with zero special tooling. (TypeScript shipped in v1.22 via `<script lang="ts">`, transpile-only — the Go compiler still treats the body as an opaque string; see §25.)

Concretely, compared to older examples:

- `events` and `animations` are **class fields** (`events = { ... };`), not `name: { ... }` object-literal members.
- **No commas between class members.**
- Handlers inside `events` **must be arrow functions.** A class field initializer evaluates during construction with `this` bound to the instance, so arrows in the field permanently capture the component as `this` — detaching the handler (as event delegation does) cannot break it. Method shorthand (`addTodo(event) { ... }`) parses but binds `this` to the events object or `undefined`; the compiler rejects it with a build error.

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
      activeTodos: todos.filter(t => !t.completed),
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
    setFilter: (filter) => {
      this.setData('currentFilter', filter);
    },
  };

  mounted() {}
  beforeUpdate() {}
  afterUpdate() {}
  destroyed() {}
}
```

### Class contract

| Member       | Kind                      | Notes |
| ------------ | ------------------------- | ----- |
| `data(params, props)` | method (may be `async`) | Returns the component model. Re-runs on mount, prop change, route-param change, and subscribed store changes. `setData()` does **not** re-trigger it. **Two-layer state (§35):** each successful `data()` result **replaces** the model layer wholesale — a key an earlier run returned but the new run omits disappears from `getData()` (unless `setData` wrote it). `setData` writes a separate persistent local layer: a `data()` commit wins over an *earlier* `setData` for the same key; a *later* `setData` wins until the next commit; local keys the model never returns survive every re-run. |
| `events`     | class field (object of arrows) | Template-facing handlers. Arrows only. |
| `created` / `mounted` / `beforeUpdate` / `afterUpdate` / `destroyed` | methods | Lifecycle hooks, in that order. |
| `animations` | class field | Declarative enter/leave animations (v1.1) — see §12. |
| anything else | methods/fields | Plain JS helpers, called internally. |

**Reserved names (§35).** `PuzzleView` owns these member names; a subclass member with the same name overrides framework behavior silently, so treat the list as off-limits for helpers:

- **Override points** (the contract — implement these): `data`, `render` (compiler-attached), `events`, `animations`, `transitionMode` (§33), `renderSkeleton`/`skeletonMinDuration` (§16, compiler-attached), and the hooks `created`, `mounted`, `beforeUpdate`, `afterUpdate`, `destroyed`, `viewWillShow`/`viewDidShow`/`viewWillHide`/`viewDidHide` (§12).
- **Read-only API** (call, never redefine): `getData`, `setData`, `memo` (§32), `ctx`, and the getters `element`, `loaded`, `isDestroyed`, `params`, `props`, `route` (§19).
- **Framework-called internals** (never touch): `mount`, `preload`, `refresh`, `applyParentUpdate`, `onStoreChange`, `flushUpdates`, `destroy`, `playIn`, `playOut`, `skipEnter`, `destroyAnimated`, `_localState`, and the compiler-reserved `__h` (§31), `__ref` (§38), and `__bind` (§6). `refs` is the framework-owned element-ref map (§38) — read it, never assign it.

### Runtime/compiler implementation rules

- Generated `render()` is attached via **prototype assignment after the class definition** (`TodoHome.prototype.render = ...`). Generated code never rewrites the user's class body — sourcemaps and debugging stay honest.
- Class fields initialize **after** `super()` returns, so the `PuzzleView` base constructor must never read `this.events`. The runtime reads `this.events` **lazily at mount time**, when wiring template handlers.

## 10. Component context

`this.ctx` exposes exactly three services: `store`, `router`, `formatters`. The extended surface in older docs (`this.$app`, `this.$events`, `ctx.utils`, global event bus) is deferred.

## 11. Project layout & build

- Source directory: **`app/`** (`app/app.js` is the entry). Output: **`dist/`**.
- Static files: **`app/public/`** is copied verbatim into `dist/` at build. **`app/assets/`** (v1.14, D46) is the inverse — compile-time-only inputs for `{#svg}` inlining (§18), never copied to `dist/`.
- `.pzl` compilation is implemented as an **esbuild plugin** (esbuild is Go-native): the Go side parses templates and generates render functions; esbuild owns module resolution, bundling, sourcemaps, and minification.
- CLI v1: `puzzle build` (production by default) and `puzzle dev` (watch + static server with history-API fallback + live reload via SSE full-page reload; no HMR). (v1.4 adds the scaffolding/tooling commands — see §13.)
- Styling: Tailwind-first. `puzzle.config.js` with `styles: { use: ['tailwindcss'] }`. A Sass pipeline is **not supported and will not be** (D35) — native CSS nesting plus Tailwind cover the ground a preprocessor used to.

## 25. TypeScript scripts: `<script lang="ts">` (v1.22)

Opt a component's logic into TypeScript. Shipped in v1.22 (D54); parser + esbuild plugin + CLI — **codegen and the runtime kernel are untouched**, and a `<script>` with no `lang` (or `lang="js"`) compiles byte-for-byte as before.

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

- **Attribute:** the only attribute `<script>` accepts is `lang`. `lang="ts"` → TypeScript; **absent or `lang="js"` → JavaScript** (identical to pre-v1.22). An unknown value, empty value, dynamic `lang={…}`, or a second attribute is a **positioned compile error** (with a did-you-mean for near-misses like `"typescript"`). The Go compiler still treats the `<script>` body as an **opaque string** — it never parses TS (D3).
- **Transpile-only (like Vite):** esbuild strips types during the build. Neither the Puzzle build, a scaffolded `tsc --noEmit`, nor an editor type-checks a `.pzl` `<script>` body; `tsc` and editor checking cover the standalone `.ts`/`.js` files and declarations included by `tsconfig.json`. The generated render tail + injected import are plain JS (valid TS), so one loader covers the mixed module: the plugin sets `Loader: LoaderTS`; standalone `pzlc` runs esbuild's Transform API to strip types.
- **`.pzl` stays the only extension** — a `.pzt` alias was considered and deferred (D54).
- **Typings:** the package ships `types/index.d.ts` (all four exports + config/store/router/formatters, wired via `exports.types`) and a `puzzle-env.d.ts` shim (`declare module '*.pzl'` → `typeof PuzzleView`) so `import X from './X.pzl'` resolves. `puzzle init --typescript` scaffolds a strict/noEmit `tsconfig.json`; the default stays JS. `examples/typed-todos` is the worked example.
- **Authoring note:** under `strict`/`noImplicitAny`, annotate `data(params, props)` and event-handler params explicitly — TypeScript does not apply contextual typing from a base-class declaration to a subclass class-body override.

## 29. Scoped styles: `<style scoped>` (v1.27)

Opt-in per-component style scoping via native CSS `@scope`. Shipped in v1.27 (D59); parser + codegen root-stamp + plugin CSS collector. **A `<style>` block without the attribute emits byte-identically to v1** — global CSS, as always.

- **Grammar:** `scoped` is a **bare, static** attribute and the only one `<style>` accepts — same posture as `island` (§17) and `min-duration` (§16). A valued or dynamic `scoped`, or any other attribute, is a positioned compile error (did-you-mean when close). One `<style>` per file, as before.
- **Semantics:** the block's rules match only inside this component's own rendered subtree — two components with colliding selectors in scoped blocks do not affect each other. Scoping is **outward containment, not inward**: rules still cascade into nested child components like ordinary CSS (no hard boundary in this cut); a child's own scoped rule at equal specificity beats the parent's via `@scope` proximity.
- **Mechanism (the compiler never parses CSS):** a stable scope id is derived per file (`pzl-` + 8-hex FNV-1a of the compiler-relative, slash-normalized path); the template root vnode gains one static `data-<scopeId>` attribute (root-only — the cascade covers descendants; view-mode skeletons reuse the root's attrs and are covered); the collected block is emitted wrapped as `@scope ([data-<scopeId>]) { … }`, verbatim inside. The styles pipeline (§13, Tailwind) is untouched.
- **Browser floor:** `@scope` ships verbatim in the bundle — Baseline engines (Chrome/Edge 118+, Safari 17.4+, current Firefox). An engine without `@scope` treats the block as global (v1 behavior), never breakage.
- **Renaming a `.pzl` changes its scope id** (path-derived) — harmless; the stamped attr and the CSS move together in the same build.

## 40. Module resolution — the `@` app alias (v1.42)

Every bundled import specifier beginning `@/` resolves to the app's `app/` directory (D75). `import Icon from '@/components/Icon.pzl'` means `<project root>/app/components/Icon.pzl` from any file at any depth — the fix for `../../components/…` climbing once views live in subfolders.

**Contract:**
- **Always on, not configurable.** No opt-in, no `puzzle.config.js` key. `app/` is already the framework-fixed source root (both build paths hardcode the entry as `app/app.js`), so the anchor needs no configuration. A general `resolve.alias` block stays deferred.
- **Bundle-wide.** It applies wherever esbuild resolves a specifier: `.pzl` `<script>` blocks, `app.js`, `routes.js`, models, `.ts` files under `<script lang="ts">` (§25), JSON imports. All three build paths get it — `puzzle dev`, `puzzle build`, and the separate prerender bundle of `puzzle build --static` / `--hybrid` (§36).
- **Relative paths are untouched.** `./` and `../` imports keep working exactly as before; `@/` is additive.
- **Scoped packages are untouched.** esbuild matches alias keys on segment boundaries, so a bare `@` key catches `@` and `@/…` only: `@magic-spells/puzzle`, `@magic-spells/morph-engine`, and every other scoped package resolve normally. npm cannot publish a package named exactly `@`, so no collision exists.
- **Module resolution only.** It does NOT apply to `{#svg 'icons/x.svg'}` asset paths (already resolved against `app/assets`, §18), to `<style>` blocks, or to `@import`s inside `styles.css` — different resolvers.

**Implementation:** one entry in the esbuild `Alias` map, set in `configureRuntime` (`compiler/internal/build/options.go`) alongside the existing `@magic-spells/puzzle` runtime entries. Parser, codegen, and the runtime kernel are untouched — this is purely a bundler-resolution concern.

**Editor support:** `puzzle init` writes the matching `paths` mapping — `"@/*": ["./app/*"]` — into `tsconfig.json` (`--typescript`) or an editor-only `jsconfig.json` (plain JS). Exactly one of the two is written, since editors ignore a `jsconfig.json` sitting next to a `tsconfig.json`. Existing apps add the same three lines by hand; the build never reads either file.
