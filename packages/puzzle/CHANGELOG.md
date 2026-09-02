# Changelog

All notable changes to `@magic-spells/puzzle`. Dates are npm publish dates (UTC).

This project is pre-1.0. Per semver, **0.x minor bumps may contain breaking
changes** — and several have. Caret ranges do not cross 0.x minors, so
`^0.4.0` will not install `0.5.0`; upgrade the range explicitly.

Rationale for individual decisions lives in `constellation/decision/` as
numbered `Dnn` cards, referenced below.

## Upgrading across versions

Eight breaking changes are easy to miss on a multi-version jump. Most fail
loudly — a compile error, a constructor throw, an unresolvable import. Four are
quiet: `output: 'static'` (renamed, 0.2.0) and `errorContent()` (removed, 0.6.0)
are greppable; the stricter write-response guard (0.6.0) is not — it depends on
what your server returns, so it surfaces at runtime on the first save — and
neither is the behavior change under auto-fetching finds (0.7.0), which turns
some reads that used to be local into requests.

**Tracked `findOne`/`findMany` fetch what is missing (0.7.0, D161).** The
rename half is loud: `store.loadAll` and the `loadAll` adapter verb are
`loadMany` now, and every old spelling throws (see the 0.7.0 entry). The
behavior half is quiet, and only affects apps that pass the `/adapter`
capability:

- **A mount-time seed keeps working but is now redundant.** An eager
  `loadMany` in `beforeMount` still loads and still marks the type complete, so
  the views that follow read a warm store and issue nothing. Delete the seed
  and its "never load inside `data()`" comment when convenient; keep it only if
  something at boot (a persisted-state restore, say) needs the records present
  before the first navigation.
- **A find that used to return `null` forever may now issue a request.** If a
  view called `findOne('post', id)` on an adapter-backed model for an id the
  store did not hold and treated the `null` as an answer, that read now fetches
  and the view waits for it. The result is the same `null` only when the server
  404s. Reads outside `data()` — event handlers, model methods — are unchanged
  and still never fetch.
- **`data()` runs more than once per navigation.** It always could, under store
  notifications; the settle loop guarantees it. A `data()` with a side effect
  or a one-shot gate in it was already wrong and now fails visibly.
- **A prerendered app fetches at BUILD time, so its endpoints must be
  reachable from the build machine.** `output: 'hybrid'` and `output: 'static'`
  run the same settle loop in Node, where there is no page to resolve an
  app-relative URL against — so a prerender read has exactly two answerable
  shapes. Have an API: give the app an absolute `apiURL`
  (`https://api.example.com`) the build machine can reach, and the build fetches
  it for real. Have no API: declare no `endpoint` and no read verb on the model
  — such a model never fetches — and seed the store in `beforeMount({ store })`.
  An app-relative read is neither, and fails the build with a diagnostic naming
  the route, the URL, and both fixes instead of
  `TypeError: Failed to parse URL`. A build-time read also means a private API
  needs its credentials available to the build — `beforeRequest` still runs, and
  a 404 settles as absence exactly as it does at runtime.

**Capitalized tag names are validated (0.7.0, D167).** A capitalized tag is a
component, and its name must now be `Ident('.'Ident)*` — `<Card>` or the new
dotted family form `<Frame.Wrapper>`. A capitalized name carrying a `-`, a `:`,
or an empty segment (`<Frame-x>`, `<Frame:Wrapper>`, `<Frame.>`) is a positioned
compile error, as is a dotted name rooted at a composition marker
(`<Slot.Foo>`). This fails loudly, and a build it fails was already broken:
the tag text is emitted verbatim as the ViewNode tag expression, so those names
compiled silently into syntactically invalid JavaScript. Lowercase tags are
untouched — custom elements with dashes and namespaced SVG keep working, so the
fix for a capitalized `<My-Widget>` is usually to lowercase it.

**`routerMode` takes a factory, not a string (0.6.0, D159).** Path routing is
the zero-config default — omit `routerMode` entirely. Hash and memory routing
are imports:

```js
import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';

routerMode: hashRouter(),
routerMode: memoryRouter({ initialPath: '/x' }),  // replaces routerInitialPath
```

A leftover `'hash'` or `'memory'` string throws at `new PuzzleApp(...)` naming
the import — a runtime throw, not a compile error: the build succeeds but the
app does not boot.

**Per-view `errorContent()` is removed (0.6.0, D145 amended).** Register one
app-level view instead — `new PuzzleApp({ errorView: AppErrorView })` — which
receives `{ error, info, retry }` when a view or component fails to render. A
leftover `errorContent()` is silently ignored (nothing reads or reports it), so
grep for the name before upgrading.

**Server sync is opt-in (0.6.0, D157).** The adapter runtime lives at
`@magic-spells/puzzle/adapter` and is enabled once, by value:

```js
import { adapter } from '@magic-spells/puzzle/adapter';

const app = new PuzzleApp({ target: '#app', routes, models, adapter });
```

Model `static adapter = { endpoint }` declarations are unchanged.
`PuzzleAdapterError` moved to the subpath. Without the capability,
`record.save()` is a plain `TypeError` at call time.

**Write responses are shape-checked (0.6.0, D158).** `create`/`update` must
resolve to an object carrying the primary key, or to nothing. A 2xx body that
is neither — `"OK"`, `true`, `[]`, `{}`, or an object with no primary key —
now throws where 0.5.0 marked the record synced, and the un-synced record means
a retried `save()` re-POSTs. If your server acknowledges writes without echoing
the record, write a `create`/`update` function that returns nothing (or unwraps
the envelope); see the 0.6.0 entry for both shapes.

**Composition markers are capitalized (0.4.0, D134).** Lowercase `<children/>`
and `<slot>` are no longer valid in any position:

| Before | After |
|---|---|
| `<children/>` | `<Children/>` |
| `<slot/>` in a component | `<Children/>` |
| `<slot/>` in a routed view or layout | `<Slot/>` |
| `<slot name="x"/>` | `<Slot name="x"/>` |

The call-site `slot="x"` **attribute** is unchanged — only the tags moved. Two
of the three errors name their replacement outright:

```
the default marker is spelled <Children/> since v1.64 (D134)
named slots are spelled <Slot name="…"/> since v1.64 (D134)
```

A bare `<slot>` is the one case the compiler cannot decide for you, because the
old spelling meant two different things depending on where it sat, so the error
offers both:

```
bare <slot> is not a marker — use <Children/> for call-site content
or <Slot/> for the router outlet (D134)
```

Pick `<Children/>` if that position received content from the call site, or
`<Slot/>` if it received a child route.

**`output: 'static'` changed meaning (0.2.0, D81).** If you set it before
0.2.0, rename it to `output: 'hybrid'` to keep the behavior you had. The name
`'static'` now produces a genuinely static site — no router, no `app.js`. This
one is *not* a compile error; it silently builds a different product.

## 0.7.0 — Unreleased

### Added

- **Component families: dotted component tags and a barrel convention (D167).**
  Related components import as one unit and invoke with dot notation:

  ```html
  <script>import Frame from '@/components/Frame';</script>

  <Frame><Frame.Wrapper><Frame.Content>…</Frame.Content></Frame.Wrapper></Frame>
  ```

  A capitalized tag is now validated as `Ident('.'Ident)*` with each segment
  `[A-Za-z_][A-Za-z0-9_]*`. That is a bug fix as much as a feature: the tag text
  has always been emitted verbatim as the ViewNode tag expression, so
  `<Frame.Wrapper>` already compiled to `new ViewNode(Frame.Wrapper, …)` — but
  nothing validated the name, and a capitalized `<Frame-x>` or `<Frame.>`
  compiled cleanly into syntactically broken JavaScript. Those are positioned
  compile errors now, as is a dotted name rooted at a reserved composition
  marker (`<Slot.Foo>`). Lowercase tags are untouched: custom elements with
  dashes and namespaced SVG keep working, and `{#raw}` bodies still take any
  tag literally. Codegen is unchanged — a dotted tag resolves lexically against
  module scope at runtime, with no registry and no import inspection.

  The family itself is a convention, not a mechanism: a directory of `.pzl`
  files (still strictly one class per file) beside a plain JS `index.js` that
  re-exports the members and hangs them off the root with
  `export default Object.assign(Frame, { Wrapper, Content })`, so both
  `import Frame` and `import { Frame, Wrapper }` work.
  `puzzle generate component Frame --family Wrapper,Content` scaffolds the
  directory, one component stub per member, and the barrel. Member names are
  validated (PascalCase, no duplicates, no collision with the root, no marker
  names), `--family` on a non-component type is an error, and the scaffold is
  all-or-nothing — a collision without `--force` writes nothing, while
  `--force` rewrites the family's own files and leaves everything else in the
  directory alone. Without `--family`, `generate component` is unchanged.

- **`puzzle check` type-checks `.pzl` files with the app's own TypeScript
  installation (D165).** The command emits virtual files under
  `.puzzle/check/src/`, runs the app's own
  `node node_modules/typescript/bin/tsc --noEmit` — the same invocation on every
  OS, with no platform shell in the way — and maps
  diagnostics back to authored `.pzl` bytes. TypeScript scripts are checked
  byte-for-byte; JavaScript components use an unchecked script mirror plus a
  checked template wrapper so ordinary JS is not silently promoted to
  `checkJs`. The generated tsconfig defends against hostile app settings and
  switches shape for TypeScript 7 after probing `tsc --version`; the feature
  uses the stable CLI protocol, not TypeScript 6 APIs or Volar. Every
  expression the compiler emits is checked, including marker arguments
  (`<Slot name="row" user={ user }>`) and `<Snippet>` bodies, whose declared
  parameters shadow the caller's data exactly as codegen scopes them.

- **Snippets pass a template that a component can stamp repeatedly with data
  (D166).** The caller declares parameters as bare attributes and optionally
  routes by `fits`; the component supplies each stamp's values by name:

  ```html
  <UserList><Snippet fits="row" user>{ user.name }</Snippet></UserList>
  {#for user in users}<Slot name="row" user={ user } />{/for}
  ```

  Each stamp gets fresh vnodes, while the snippet function travels through the
  children channel so it does not defeat component-prop shallow comparison.
  Development warns about argument-shape mismatches; `<Children>`, `<Slot>`,
  `<Snippet>`, and `ref=` inside a Snippet body are compile errors — a snippet
  body is a composition **leaf**, so that includes a `<Snippet>` on a component
  invocation nested inside the body. Nest by extracting: move that invocation
  and its snippet into their own component, whose template declares the marker
  at top level. (`<Portal>` relocates DOM rather than declaring a composition
  position, so it stays legal there.) `__PUZZLE_HAS_SNIPPETS__` leaves non-users
  at zero bytes and costs users about 48–60 B gzip (roughly 50 B).

- **The playground has a parser-and-codegen WebAssembly compiler core (D164).**
  The tooling-only `js/wasm` command exposes the real template diagnostics,
  generated JavaScript, scoped CSS, warnings, and errors through a bounded
  worker protocol. It deliberately omits bundling, asset resolution, and
  TypeScript transformation, and adds no app/runtime surface.

- **Route views and layouts can load on demand with `lazy()`.** Wrap a dynamic
  import such as `view: lazy(() => import('./views/Admin.pzl'))` to defer that
  class until its route passes guards. A matched route's lazy views and layout
  resolve in parallel before construction and `data()`; successful loads are
  shared and cached, and the current view remains mounted while they load — no
  separate loading UI or skeleton path is introduced. Failures leave the
  current URL and DOM intact and can be retried through the existing navigation
  error path. With
  `build.splitting: true` each import can become a chunk; splitting-off and
  static builds inline the same lazy modules and keep their runtime/prerender
  behavior. `examples/blog` splits its whole `/settings` section this way.
  An app that never calls `lazy()` does not pay for the feature: the build's
  usage scan (D89) sets `__PUZZLE_HAS_LAZY__` false and the resolver
  tree-shakes out, worth ~0.6 KB gzip off every lazy-free SPA. Detection now
  reads the app's `.js`/`.ts` modules as well as its templates, since `lazy()`
  is called from `routes.js` — as always the scan skips `node_modules` and
  build output, and a marker that reaches the route table anyway fails loudly
  at route-compile time rather than mounting as if it were a view class.

### Changed

- **A route's `view`/`layout` is validated when the route table compiles.** It
  must be a `PuzzleView` subclass or a `lazy()` marker; anything else now throws
  a named error from the `Router` constructor instead of failing later at
  construction time. A bare loader function gets its own message pointing at
  `lazy()`, because Puzzle deliberately does not guess whether a function is a
  view class or a loader. If your app passed something that is not a
  `PuzzleView` subclass in a view position, it fails at boot now rather than at
  first navigation.

### Fixed

- **A throwing view or layout constructor no longer poisons the route it was
  on.** The routed instances are built ~60 lines above the guarded load region,
  so a throw from a class field initializer or a constructor body escaped the
  navigation without running the failure recovery — the pending-navigation latch
  stayed paired with the rejected promise, and every later `push()` to that same
  path handed back that same rejection instead of retrying. Construction is now
  guarded on its own and treated as the pre-commit failure it is (D61): reported
  through `onError` with `phase: 'navigation'`, URL, history and the mounted tree
  untouched, and the path retryable.

- **A second `mount()` during boot no longer resolves early.** `_mounted` is
  claimed before the awaited `router.start()`, so a `mount()` call made while
  the initial navigation was still running took the already-mounted early-out
  and resolved immediately — against the documented contract that the promise
  resolves once the initial route has rendered, and hiding the first call's
  rejection. Every call made while a mount is in flight now shares that mount's
  promise and settles with it; after the mount completes, the already-mounted
  early-out behaves exactly as before.

- **A slow load response no longer rolls back a newer one that already
  landed.** `loadOne`/`loadMany` captured only the local-mutation revision
  (D138), and nothing advanced it for a server response — so two overlapping
  reads of the same identity were decided by arrival order and the loser of the
  race won whenever it finished last. This covered an explicit `loadOne` racing
  an automatic fault too, since faulting routes through the same method. Reads
  now carry a per-store dispatch generation and each record remembers the
  highest one that landed on it, so a stale response is dropped for that record
  (D138). Save responses and the public `upsert()` deliberately do not
  participate, and local-edit protection is unchanged.

- **A read made while another view is waiting on data can no longer fetch, or
  fail that view.** Auto-fetching finds (D161, new in this release) decided
  whether a query was allowed to fault from a slot on the Store itself, which
  stayed installed for the whole lifetime of an `async data()` — across every
  `await`. Any other read in the meantime — an event handler, a timer, a model
  method, another component — therefore issued a request the contract says it
  never should, and dropped that promise into the waiting view's settle batch,
  where an unrelated 500 could reject a view that never queried that type.

  Faulting is now attributed by identity: every view on an adapter app reads
  through its own store handle, which is exactly what `this.ctx.store` has
  always been, and only reads made through that handle, by that view, during
  that view's own `data()` run may fetch. Everything else — the app's raw
  `store`, another view's handle, a record's relationship getters — is the pure
  local snapshot the SPEC always described. Two consequences worth knowing:

  - **Read the store as `this.ctx.store`.** A view that captured the app store
    in a module variable and called `findOne` on it inside `data()` gets a local
    read that never fetches. Every example, the scaffold and the docs already
    use `this.ctx.store`; this is now the difference between fetching and not.
  - **A destroyed view's suspended `data()` can no longer fetch**, in the nested
    cases where it previously could.

  Subscription tracking is unchanged — `belongsTo`/`hasMany` traversal inside
  `data()` still auto-subscribes and still never fetches.

- **The CLI installs and runs on Windows ARM64.** The bin shim resolved an
  exact `<platform>-<arch>` key and declared no `win32-arm64` row, and the
  Windows package restricted itself to `cpu: ["x64"]` — so on a native ARM64
  build of Node (`process.arch === 'arm64'`) npm skipped the platform package
  and `puzzle` exited with "no prebuilt CLI binary available". Emulation only
  covers a process already running the x64 binary; it does not change what Node
  reports. A `win32-arm64` host now folds onto `@magic-spells/puzzle-win32-x64`
  in the shim, in `puzzle upgrade`, and in that package's `cpu` field. Still
  five platform packages — the fold is in the lookup, not the matrix.

- **A namespace import no longer compiles `lazy()` support out of an app that
  uses it.** The usage scan recognized a `lazy(`-shaped call and a `lazy`
  specifier in an import clause, but not
  `import * as puzzle from '@magic-spells/puzzle'` followed by
  `const { lazy: page } = puzzle` — neither rule can see that shape, so
  `__PUZZLE_HAS_LAZY__` came out false and every lazy route threw "lazy support
  was compiled out" at route-table validation. Any whole-namespace import or
  star re-export of the package now counts as lazy usage, at a cost of ~0.6 KB
  gzip for a namespace importer that never calls it.

- **Multi-line `{#raw}` blocks pass the single-root gates they actually
  satisfy.** Formatting whitespace around the raw markers no longer counts as
  stray content in a `{#for}` row, component root, or component skeleton.
  Genuine multi-root raw bodies still fail.

- **Inlined `{#svg}` root attributes stay authored literals.** Attributes such
  as `bind:value` and brace-looking values no longer enter template data or
  directive paths. Framework-reserved `ref`, `island`, `key`, and `flip` asset
  attributes are discarded; in particular, an asset `key` cannot suppress the
  synthetic key required by a surrounding `{#for}`.

- **The TypeScript import-clause scanner cannot hang a build or watcher.** It
  now models type-only imports as erased value bindings and guarantees forward
  progress even on an unclassified byte in a malformed `<script>`, leaving
  esbuild to report the script error instead of spinning a CPU core forever.

- **Path-mode fragment pops stay native in-page navigation (D41).** A browser
  pop between `/docs` and `/docs#faq` now updates the route snapshot without
  re-running route loads or `data()`, remounting views, moving focus, announcing
  a route, or applying router scroll behavior.

- **App-wide adapter defaults no longer make local models fault (D161).** A
  model with neither an endpoint nor an authored read verb remains a pure local
  snapshot even when the app installs `adapter.defaults(...)`; write-only
  models do too. Explicit `store.loadMany` remains an intentional dispatch.

- **`puzzle init --template todos` renders again.** The scaffolded app's `Todo`
  model declared `endpoint: '/api/todos'` while the template shipped no backend
  and no file behind it, so under auto-fetching finds (D161) `Home.pzl`'s
  `store.findMany('todo')` faulted, fetched, and got the dev server's SPA
  fallback — `200 text/html` — which failed `loadMany`'s JSON-array check,
  rejected the settle loop, and left navigation zero with nothing to commit: a
  blank page on the very first `npm run dev`. The starter declares no server: it
  seeds its store in `beforeMount({ store })`, its `Todo` model carries no
  `static adapter` block, and the app config carries no `apiURL` — so every
  read, write, and delete is local and a fresh app renders a working list the
  moment it starts. `app.js` documents the upgrade to a real API. The `default`
  template was never affected — it declares no models.
- **Prerender fails an app-relative endpoint with a diagnostic, not a raw URL
  parse error.** Because D161 moved the read path to build time, a prerendered
  app using an app-relative endpoint shape (`apiURL: '/api'`) hit Node's
  `fetch`, which has no page origin to resolve against, and the build died with
  the raw `TypeError: Failed to parse URL from /api/posts.json` — no route, no
  endpoint, no fix. Such a read now fails with a diagnostic naming the route,
  the URL, and both fixes: an absolute `apiURL` the build machine can reach, or
  a model with no `endpoint` and no read verb plus a store seeded in
  `beforeMount({ store })`. The check sits on the global `fetch`, not on
  `apiURL`, so an authored verb that hardcodes a path (the D158 escape hatch
  `examples/blog` uses) is diagnosed too.
- **`types/ssg.d.ts` knows about the read-state envelope.** `PrerenderedPage`
  and `injectStaticShell` were never taught the `readState` field D161 added,
  so a TypeScript consumer driving a custom prerender pipeline could not read
  `page.readState` or pass it through — a compile error on correct code. Both
  now carry it, typed as the exported `PrerenderReadState`
  (`{ v, complete, absent }`).
- **A payload key naming a model method no longer shadows it.** An ordinary
  permission flag (`{ id, name, update: true, delete: false }`) used to land as
  an own data property over `PuzzleModel.prototype.update`, so the next
  `record.update({...})` threw `TypeError: not a function` inside app code — and
  a payload key named `toJSON` silently broke persistence, the DevTools
  snapshot, and pre-save validation. Every write path (construction, `update()`,
  and the server/storage merges) now drops a key that resolves to a **method**
  on the prototype chain, warning once per model+key in development — the same
  posture already used for computed getters (D149) and relationships (D49).
  Relationship accessors are unaffected: they are getters *with* setters and
  keep their setter behavior. Schemas are also checked when the Store registers
  a model: a schema entry named after a model method (framework verb or one of
  your own) throws at app construction in development, naming the model and the
  field.
- **`date()` fields hydrated from JSON are revived as `Date`s.** JSON has no
  Date type, so a `Puzzle.date()` field arriving from `loadMany`/`loadOne`/
  `upsert`, a save response, or a `storage:` round trip was a string — and
  `min`/`max` on a date field reject a non-`Date` value (`"startsAt" must be a
  date`). Since `save()` validates the whole record before dispatching, one
  server-supplied date string made **every** later save reject with no request
  ever sent, while `update()` (which validates only patched keys) hid the
  problem until then. Declared date fields are now converted where JSON enters:
  ISO datetimes and epoch millis via `new Date(v)`, a bare `YYYY-MM-DD` as local
  midnight (the D114 calendar-date rule the date formatters use). Validation
  stays strict — an unparseable value is left exactly as it arrived so §20 still
  reports it. Instant dates still serialize as ISO timestamps, while a bare
  date revives to `CalendarDate`, whose `toJSON()` preserves the original
  `YYYY-MM-DD` in every time zone instead of shifting it to a UTC instant.
- **`update()` with a reserved key applies the rest of the patch.** `_type` is
  defined non-writable, so `record.update({ title, _type, done })` threw
  `TypeError: Cannot assign to read only property '_type'` **mid-loop** under
  strict mode: `title` landed, `done` was lost, and `recordChanged()` never ran,
  leaving a half-applied record with no re-render. `update({ _store: null })`
  meanwhile succeeded and detached a record the store still indexed. The patch
  path now skips the same reserved set the server merge does
  (`_store`/`_type`/`_synced`/`_deleted` plus the prototype-pollution family),
  dropping those keys with a development warning instead of throwing, and stamps
  D125 mutation revisions on only the keys that actually landed.
- **`puzzle upgrade` resolves and proves the install it is upgrading from the
  running executable (D76).** Documented since 0.5.0, but resolution still
  walked up from the current directory, so a global CLI invoked inside an app
  could upgrade the app and leave itself stale. Detection now follows
  `os.Executable()` through symlinks and finds the owning installed package.
  Project dependencies update in place; a global install is accepted only when
  `npm root -g`/`pnpm root -g` names its `node_modules` or the validated pnpm
  global-root shape matches. Workspace-hoisted, nested, ephemeral, and unknown
  installs explain and stop — there is no "does not look local, so it must be
  global" fallthrough. Global-upgrade tests now assert the surrounding
  `node_modules` directory itself, closing the vacuous check that previously
  could not detect an accidental project install. The success line names the
  scope: `upgraded the global CLI …` or
  `upgraded @magic-spells/puzzle … in <dir>`.

- **Tracked `findOne` honors collection completeness (D161).** After a
  successful no-options collection load, a tracked `findOne` for an id the
  collection did not contain is a local `null` — no detail GET. Previously it
  still queued one, so a stale link's 500 could turn a locally known absence
  into a failed navigation. `findMany` already behaved this way; explicit
  `store.loadOne` remains the force-refresh escape hatch.

- **Fixture mock responses normalize like real ones (D158/D95).** Under
  `installFixtures()`, a custom verb that returns the enhanced fetch's result —
  the documented `loadMany: (fetch) => fetch('/v2/posts')` idiom — now parses
  exactly as it does against a live server, and a mocked non-OK response
  **rejects** a custom `delete` instead of being silently treated as success
  (a test could previously pass against a failing delete). The mock's
  Response-shaped stand-in carries an internal brand the adapter recognizes
  alongside real `Response` instances. Also new, dev-only: declaring a model
  field named `__synced` throws at Store construction — persistence writes its
  provenance marker under that key, so such a field silently vanished on every
  reload.

- **A first render that throws mid-mount releases everything it built.** The
  first-mount branch now gets the same bracketing a failed patch has had since
  D145: components the mount had already instantiated lose their store
  subscriptions, document-level `@event:outside` listeners, element refs, and
  `<Portal>` outlet content, instead of leaking them forever with no DOM to
  reach them through. `vnode.el` is also published before attrs, refs, and
  child mounts, so the cleanup walk can reach listeners an element installed
  before a later sibling threw.

- **`date(null)` and `timeago(null)` render empty.** `new Date(null)` coerces
  to the epoch, so they rendered "12/31/1969" and "56 years ago". null,
  undefined, `''`, and booleans all take the absent path now; numeric `0`
  stays a legitimate epoch timestamp.

- **The darwin CLI binaries carry an `LC_UUID` load command.** dyld on the
  newest macOS aborts binaries without one (`missing LC_UUID load command`,
  Abort trap 6) — Go's linker only started emitting it by default in 1.24,
  so binaries built with older toolchains, including the published 0.6.0
  darwin ones, can be killed on sight there. The build floor is now Go
  1.24 (`go.mod`), which stamps every future binary.

- **Path routing populates `route.hash` (D83).** Path-mode navigation dropped
  `location.hash` from the route snapshot on the initial navigation and every
  popstate, and a same-path navigation to a byte-identical URL pushed a
  duplicate history entry. Both now match hash routing's behavior.

- **A component retry can no longer blank its position (D145).** Pressing the
  error view's `retry` when the owner's own `data()` also fails — the ordinary
  outcome of retrying while the server is still down — used to leave the child
  position empty. The position is now refilled with a face carrying the new
  error and a fresh callback, the same swap a routed load failure performs.

- **`viewWillHide()`/`viewDidHide()` fire on animation-less component removal
  (D28).** The hooks are lifecycle, not animation callbacks — declared without
  an `animations.out`, they now fire in order with zero-duration semantics when
  a parent unmounts the component, as the router teardown always did.
  Components declaring neither hooks nor animations keep the synchronous,
  instant destroy.

- **Changing `island` across conditional branches replaces the element (D44).**
  Two branches sharing a tag and key but disagreeing about `island` describe
  different ownership, not one subtree to patch: flipping used to diff stale
  seed vnodes against DOM the island's owner had rewritten, permanently
  corrupting the tree. Ownership is now part of node identity, so the flip
  unmounts and remounts cleanly in both directions.

- **The public error-phase union matches the runtime (D145).** `PuzzleErrorInfo`
  gains the emitted `'unmount'` phase (a throwing `destroyed()` hook), and the
  full twelve-phase list is now pinned in the type tests so a new runtime phase
  cannot ship without its union member.

- **A `.then`-style `data()` can no longer contaminate a concurrent
  evaluation (D161).** A plain (non-`async`) `data()` returning a Promise runs
  once inline before the store can know it is async; overlapping an in-flight
  async evaluation, its abandoned first invocation could record store reads
  into the *other* view's request batch, and a prepared route refresh it
  overlapped could commit — or, after a discarded navigation, leak — the wrong
  `params`. The view now latches the shape on first sight and every later
  evaluation serializes like a declared-`async` one; prepared refreshes guard
  their scope by identity; and development warns once per class: declare
  `data()` as `async`. The residual window is one evaluation per view per
  session, and only for `.then`-style `data()`.

- **A view restored from a failed navigation fires its show bracket.** The
  leave sequence fires `viewWillHide()` before its out animation, so when the
  router's failed-navigation recovery puts the still-committed view back on
  screen — live, re-subscribed, visible — the view had been told it was hiding
  and never told it was showing again. A view that pairs `viewDidShow()` start
  with `viewWillHide()` stop (a ticking clock, a poll, a carousel) stayed frozen
  in plain sight. The restore now fires `viewWillShow()` → `viewDidShow()`
  back-to-back at zero duration, the same treatment the leave path already gives
  its hide bracket: hooks are lifecycle, not animation callbacks (D28). The
  eventual real departure still fires the full hide bracket, and a throwing hook
  is reported without disturbing the navigation being recovered.

- **`this.params`/`this.route` after an `await` report the destination again.**
  Every patch-managed DOM listener runs inside its owner's committed-scope fence
  (D146), and an unguarded route reaches `prepareRefresh` synchronously from
  `router.push()` — so a handler that pushed a params-only navigation reusing
  its own view started the prepared evaluation *inside* the fence. On the way
  out the fence restored the scope it had captured on the way in, overwriting
  the live evaluation's, and every `this.params`/`this.route` read after the
  first `await` in that `data()` reported the committed route instead of the
  destination. The fence now restores the invariant — the newest evaluation
  still in flight, or none — exactly as `prepareRefresh` derives its own unwind
  target, and nested fences restore it only when the outermost one exits.

- **The playground's nesting guard counts `{:else if}` clauses (D164).** Each
  clause desugars into a nested `If`, so codegen recurses once per clause while
  the token scan saw a single level — a flat 2,000-clause chain passed the guard
  and then produced 96 MB of JavaScript in a WASM instance that cannot survive
  running out of memory. The scan now keeps a per-block clause count, so a chain
  is measured at its true codegen depth and the single `{/if}` still pops the
  whole synthetic chain.

- **`puzzle check` remaps diagnostics against the bytes it emitted (D165).**
  Positions were resolved by re-reading the `.segments.json` sidecars, the
  generated files, and the authored `.pzl` from disk *after* TypeScript exited —
  so saving a file while the check ran silently shifted every remapped position,
  and deleting one replaced the type errors with `open …: no such file`. The run
  now indexes its own in-memory segment tables, which is what the byte-exact
  promise always meant. The sidecars are still written, as the inspectable
  artifact they were always documented to be.

- **A symlinked `.puzzle` no longer sends the scratch sweep out of the app root
  (D153).** `SweepWorkDirs` skipped a swept *entry* that was a symlink, but
  nothing looked at the `.puzzle` ancestor itself — so with `.puzzle` pointing
  elsewhere, the sweep read and removed stale `staging-*`/`dist-old-*`
  directories at the link target, and `puzzle check` cleared `check/` there.
  The sweep now leaves a symlinked scratch root alone (the legacy app-root
  sweep still runs), while `puzzle build` and `puzzle check` refuse it with a
  diagnostic naming the path.

- **Split-mode `puzzle dev` writes its chunks atomically (D160).** The rebuild
  wrote each output straight into the live `dist/` with `os.WriteFile`, whose
  truncate-then-write window a lazy `import()` landing mid-rebuild can observe —
  and split mode is the one path that makes such fetches routine. Outputs now go
  through the same write-and-rename every other live-`dist/` writer uses.

- **A live handle in `created()` no longer hangs a prerendered build.** Both
  generated prerender entries wrote their summary and let Node exit on its own,
  so a `setInterval` (or any other handle) started in a view's `created()` kept
  the subprocess alive until the 120-second timeout killed it and failed the
  build blaming `data()`. SSG runs `created()` but never `destroyed()` (SPEC
  §36), so a handle started there has no partner to close it; the entry now
  exits as soon as the summary is flushed to the pipe. The timeout message says
  "a `data()` that never resolves", which is now the only thing that can cause
  it.

### Changed

- **BREAKING: tracked `findOne`/`findMany` fetch what the store is missing
  (D161).** Reading server data no longer needs any loading code. Inside a
  view's `data()`, a find that misses returns its local value and queues a
  fetch; the view does **not** commit that pass. Puzzle re-runs `data()` behind
  the batch and commits the first pass whose reads all came up warm, so `data()`
  keeps reading like plain synchronous code:

  ```js
  data(params) {
    const store = this.ctx.store;
    const post = store.findOne('post', params.id);
    const author = post ? store.findOne('user', post.authorId) : null;
    return { post, author };
  }
  ```

  Deep-linked into an empty store that settles in three rounds — miss the post,
  get the post and miss the author, get both — and renders once, fully
  populated. Dependent reads resolve on their own; nothing declares an order.

  The contract that makes this usable is that **a committed `null` means the
  record does not exist**, never "still loading", so `{#if post} … {:else} Not
  found` needs no companion `loaded` flag. Everything else follows from
  protecting it:

  | Read | Behavior |
  |---|---|
  | Tracked hit | synchronous return, no request |
  | Tracked miss, resolvable read verb | local value + queued fetch, deduped by identity |
  | Tracked miss, identity known absent | `null`, no request |
  | `findMany` on a collection-complete type | pure local; `{ filter }` is always local |
  | No `/adapter` capability, or no resolvable verb | pure local — exactly the 0.6.0 behavior |
  | Outside `data()` (handlers, model methods) | pure local snapshot, never fetches |
  | `belongsTo`/`hasMany` getters | local lookup, never fetches |

  A miss faults only when D158 dispatch resolves a read verb — model function,
  app default, or endpoint-generated REST — so `findOne` needs a `loadOne` and
  `findMany` needs a `loadMany`. Local-first apps are untouched: no capability,
  no endpoint, no verb, no request. Fixture-driven apps fault exactly like
  production — the mock intercepts at the `_network` seam, so a tracked miss is
  served from the mock collection and a mock 404 exercises the negative cache
  for real. Relationships
  deliberately never fault (a 50-row list must not become 50 GETs); when a view
  needs a related record that may be missing, it adds one more tracked find on
  the foreign key, and `post.author` then resolves off the warm store.

  Only a framework-normalized 404 becomes a committed `null`. Network failures,
  5xx, 401/403, and malformed bodies reject the run through the normal
  navigation-failure / `errorView` path and poison no cache. Ten settle rounds
  without converging **throws**, naming the view and the last round's request
  keys — never a partial commit, which would make `null` ambiguous again.

  Caching a migrating app should know about: a type is collection-complete only
  after a **successful no-options** collection load (an empty array counts), so
  `loadMany(type, options)` — including `{}` — stays partial and accumulating;
  absent identities go in a never-persisted 1000-entry LRU and clear the moment
  the identity arrives by any path (create, upsert, load, hydration, save
  reconcile, primary-key adoption); removing a record by any path — a confirmed
  `record.delete()` or a local `record.destroy()` — records that identity absent,
  so an optimistic delete cannot fault the row straight back in; and explicit
  `store.loadOne` bypasses
  the negative cache, which makes it the force-refresh escape hatch. Only the
  automatic fault path requires the response to carry the requested primary key
  (a mismatch there would re-request the id every settle round); an explicit
  `store.loadOne` is one-shot and upserts whatever record the server returns, so
  `store.loadOne('post', 'my-slug')` against a slug-resolving endpoint works.
  `data()`
  now runs however many times the waterfall needs, so keep it a pure derivation.

  The eager-seed idiom is retired. The 0.6.0 advice — seed whole collections
  after `mount()`, and *never* load inside `data()`, or the upsert's own
  notification loops the view — is what this replaces; the loop discards each
  intermediate pass's subscriptions, so the cycle it warned about cannot form.
  A leftover seed still works (it marks the types complete, and the views that
  follow read a warm store), so migration is deletion at your convenience, not a
  breaking edit. Calling `store.loadOne`/`store.loadMany` from inside a tracked
  `data()` run warns once in dev and points at `findOne`/`findMany`.

  Prerendering fetches at build time through the same loop: a request failure
  fails the build naming the route, `beforeRequest` runs in the build context,
  and `prerender: false` is still the opt-out. Skeletons are unchanged — every
  settle round counts as one load, held by the existing `min-duration`.
  Deliberately deferred: server-side query/pagination pass-through on
  `findMany`, TTL/`reload(type)` invalidation, and request cancellation.

- **BREAKING: the collection verb is `loadMany`, and `loadAll` throws (D161).**
  One/Many is the framework's naming pair, and the old spelling is not aliased:
  a silent fallback to generated REST would quietly hit different URLs than the
  adapter you wrote. Every site that could have accepted it rejects it by name
  instead, so an unmigrated app fails at boot rather than rendering empty lists.

  | Before | After |
  |---|---|
  | `store.loadAll(type, options)` | `store.loadMany(type, options)` |
  | `static adapter = { loadAll }` | `static adapter = { loadMany }` |
  | `adapter.defaults({ loadAll })` | `adapter.defaults({ loadMany })` |
  | `store.adapter(type).loadAll` | `store.adapter(type).loadMany` |

  The four guards, all carrying the same message:

  - `store.loadAll()` is kept as a throwing trap, not removed — an app that
    still calls it would otherwise look migrated while its models never renamed
    their verb.
  - A registered model whose `static adapter` carries an own `loadAll` key
    throws at **Store construction**, before any navigation.
  - `adapter.defaults({ loadAll })` throws immediately, in production too: an
    app-wide default silently covers every model.
  - The verb-binding loop rejects `loadAll` **before** its custom-function
    branch, so it cannot bind as a harmless custom verb nothing ever calls.

  TypeScript follows: `AdapterLoadAllOptions` is `AdapterLoadManyOptions`.

- **BREAKING: generated read failures are `PuzzleAdapterError` (D161).** A
  non-OK response to a generated `loadMany`/`loadOne` now normalizes exactly
  like a write does, and like an author function returning a non-OK `Response`.
  Reads previously rejected with a plain `Error` carrying only a message:

  ```
  before:  [puzzle] load 'post' failed: 404 Not Found
  after:   [puzzle] adapter request failed: 404 Not Found   (PuzzleAdapterError, .status === 404)
  ```

  The auto-fetch path needs the status to tell "absent" from "broken", and a
  plain `Error` carries none. Code that matched on the old message string must
  match on `err instanceof PuzzleAdapterError` and `err.status` instead; import
  `PuzzleAdapterError` from `@magic-spells/puzzle/adapter`. A custom `loadOne`
  reports "no such record" the same way — `return new Response(null, { status:
  404 })`. Returning `null` remains a response-shape error, not an alternate
  not-found convention.

- **The framework develops in a monorepo (D162).** `@magic-spells/puzzle`,
  `@magic-spells/puzzle-pieces`, the DevTools extension, and the `.pzl`
  lint/format plugins now live in one repository — `magic-spells/puzzle`,
  under `packages/` — and version as one release train. Nothing about the
  published package changes: same name, same exports, same tarball layout.
  The npm `repository` metadata now points into `packages/puzzle`, and a
  pieces release can no longer lag the CLI it is version-locked to — the
  release pipeline asserts the whole train.

### Added

- **Windows x64 CLI binaries.** `npm install @magic-spells/puzzle` on Windows
  now resolves a real `puzzle.exe` instead of failing with "no prebuilt CLI
  binary available for this platform". A fifth platform package,
  `@magic-spells/puzzle-win32-x64`, joins the four existing ones as a pinned
  `optionalDependency` of the root package, and the bin shim resolves
  `bin/puzzle.exe` through it. Windows-on-ARM runs the x64 binary under
  emulation, so there is deliberately no `win32-arm64` package. `puzzle upgrade`
  learned the same spelling — the platform package is keyed the way Node spells
  the platform (`win32`), not the way Go does (`windows`), which is what it had
  been deriving the name from.

  CI gained a `windows-latest` job that runs the compiler's Go suite and then
  scaffolds and builds a real app with the Windows binary, so the target is
  verified on every push rather than at release time.

  One deliberate gap: the interactive keyboard controls in `puzzle dev` (the
  single-key restart/quit shortcuts) are Unix-only and are silently absent on
  Windows. The dev server, watcher, rebuilds, and live reload all work; only the
  keystroke shortcuts do not. Use Ctrl-C to stop the server.

- **`output: 'static'` pages carry the build's read state (D161).** Each
  prerendered page already ships its records in a `data-puzzle-static-data`
  island; it now ships what the build *learned* beside them, so `mountStatic`
  does not refetch every collection and re-404 every id the build already
  settled. A second inline island follows the record island immediately:

  ```html
  <script type="application/json" data-puzzle-static-read>
  {"v":1,"complete":["post","user"],"absent":["post 999"]}
  </script>
  ```

  `complete` is the collection-complete type names; `absent` is the identities
  the build confirmed missing, spelled `"<type> <recordKey>"`. The kernel
  hydrates records **first**, then the read state, and drops any absence whose
  record turned out to be present — a build that 404'd an id another page later
  supplied cannot suppress a live read. The envelope is versioned so an older
  kernel rejects a newer one rather than misreading it, and it is **omitted
  entirely** when the page settled nothing, so an adapter-less build emits the
  same bytes it did before the envelope existed. `output: 'hybrid'` transfers
  nothing new by design: its SPA takeover re-runs `data()` as a fresh session.

- **HMR preserves read state across a dev reload (D161).** The dev-state
  snapshot carries the collection-complete set and the negative cache along with
  the records, so editing a template does not re-issue every collection load the
  session had already settled. In-flight promises are never carried — an
  unresolved miss simply refetches after the reload — and app persistence stays
  records-only.

## 0.6.0 — 2026-08-15

### Fixed

- **A static build ships the adapter the app actually configured (D157/D158).**
  `output: 'static'` generates each page's entry, and that entry re-imported the
  bare `adapter` capability whenever `app/adapter.js` did not exist — so an app
  that passed `adapter.defaults({ ... })` straight into its config prerendered
  with its own verbs and then shipped pages that installed different ones, with
  no build warning. Depending on the model that meant every page throwing
  `no adapter loadAll() declared`, or quietly falling back to generated REST. The
  entry now binds the capability by identity: the bare export is re-imported, a
  configured one that IS `app/adapter.js`'s default export is imported from
  there, and an inline-configured one makes the page read `app.config.adapter`
  off the app entry (an advisory line reports the page weight that costs, and
  suggests `app/adapter.js`). An `app/adapter.js` holding something the config
  did not pass is now bypassed instead of trusted.
- **A skipped route no longer forces whole-site re-renders in static dev.** Route
  classification (D155) cuts its render-wide walk at chain roots, but a route the
  prerender skips — a dynamic `:id` with no `staticPaths`, a shadowed route —
  reported none, so the walk descended through it and marked every component it
  shared with a rendered page render-wide. A `/blog` index beside `/blog/:id`
  sharing one card component re-rendered the entire site on every save. Output
  was always correct; only rebuild time was wrong.
- **Links inside a web component's shadow root are now intercepted.** The router
  found the clicked anchor with `closest('a')`, which walks the light tree — but
  shadow DOM retargets the event to the host, so an `<a>` inside a component's
  shadow root was missed and the click fell through to a full page load. The
  lookup now reads `composedPath()` (closest() stays as the fallback for
  synthetic events). Related: an explicit `target="_self"` is now intercepted
  like a bare anchor — it names THIS frame, so it is the default spelled out,
  not an opt-out. `_blank`/`_parent`/`_top`/named targets still fall through to
  the browser.

- **SVG `<a>` links now route.** An SVG anchor is a different element type from
  the HTML one: its node name is lowercase and its `.href` is an
  `SVGAnimatedString` rather than a string. Clicking one in the light DOM was
  intercepted and then navigated to a garbage path built from that object
  (`/[object%20SVGAnimatedString]`), which also defeated the external-link
  guard — an SVG link to another origin was captured as an in-app route. Inside
  a shadow root it was missed entirely and fell through to a full page load. The
  interceptor now matches both element types and reads the href attribute when
  `.href` is not a string, resolving it against the element's base URL so
  `<base href>` still applies.

### Changed

- **BREAKING: hash and memory routing are imported factories (D159).**
  `routerMode` no longer takes a string. Path routing stays the zero-config
  default (omit `routerMode`); hash and memory routing are opt-in imports from
  the new `@magic-spells/puzzle/router-modes` subpath, so a path-mode app
  no longer ships either mode's code — the fragment parsing, the entry stack,
  and their commit/click/scroll branches all tree-shake away.

  | Before | After |
  |---|---|
  | `routerMode: 'history'` | omit it |
  | `routerMode: 'hash'` | `routerMode: hashRouter()` |
  | `routerMode: 'memory'`, `routerInitialPath: '/x'` | `routerMode: memoryRouter({ initialPath: '/x' })` |

  ```js
  import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';
  ```

  A mode string is a constructor throw naming the import, so nothing fails
  silently. The `routerInitialPath` app-config field is removed —
  `memoryRouter({ initialPath })` replaces it (`createTestApp` still accepts
  `routerInitialPath` as its own option). `output: 'static'` no longer carries
  `routerMode` into a generated page at all; it was already ignored there.
- **BREAKING: error fallback UI is one app-level view (D145 amended).**
  `PuzzleView.errorContent(error)` — the per-view member returning hand-built
  `ViewNode` trees — is removed. Register one ordinary compiled view instead:
  `new PuzzleApp({ errorView: AppErrorView })`. On a framework-contained
  mount/refresh failure the failed view or component is replaced in place by a
  fresh error-view instance (parent, siblings, and layout survive) receiving
  `{ error, info, retry }` props; `retry()` re-runs the failed work through
  the normal pipeline (a same-location navigation for routed views, the
  owner's refresh for components), is single-flight, and never fires
  automatically. A routed retry keeps the error view on screen for the whole
  rebuild — a rebuild that commits replaces it, one that fails again refreshes
  it with the new error, and one that never commits at all (a guard verdict, a
  superseding navigation) leaves it standing and pressable — so Retry can never
  blank the position. The error view's own failure reports once as
  `phase: 'error-view'` (replacing the old `boundary` phase) and never
  recurses. `onError` and the no-fallback default behavior are unchanged.
  Migration: move `errorContent()` markup into an `AppError.pzl` template and
  pass its class as `errorView`.

- **BREAKING: server sync is the opt-in `/adapter` subpath (D157).** The
  adapter — `loadAll`/`loadOne`, `record.save()`/`delete()`,
  `store.request()`/`upsert()`, and `PuzzleAdapterError` — moved out of the
  core store into `@magic-spells/puzzle/adapter`. Model declarations are
  unchanged from 0.5.0; keep the bare config object and enable the runtime once
  in the app config:

  ```js
  import { adapter } from '@magic-spells/puzzle/adapter';

  const app = new PuzzleApp({ target: '#app', routes, models, adapter });

  // models/todo.js — unchanged
  static adapter = { endpoint: '/api/todos' };
  ```

  The breaking migration is only for server-backed apps: add the imported
  `adapter` value to `new PuzzleApp(...)`, and import `PuzzleAdapterError` from
  `@magic-spells/puzzle/adapter` instead of the package root. Apps that never
  pass the capability ship none of the adapter (about −1.6 KB gzip on the
  reference apps); `record.save()` without it remains a plain `TypeError`.
  The `beforeRequest` hook and `/fixtures` mocking otherwise behave as before.

- **Adapters are fetch functions; REST is the shorthand (D158).** A model's
  `static adapter` may define any of the five transport functions directly.
  An `endpoint` now only generates defaults for missing verbs, so author
  functions win per verb and a fully custom adapter needs no endpoint. The
  framing is simple: define your fetch function; Puzzle keeps ownership of
  identity-preserving merge, revision guards, write ordering, persistence,
  and notifications.

  ```js
  // Standard REST: generates loadAll/loadOne/create/update/delete.
  static adapter = { endpoint: '/api/posts' };

  // Nonstandard URL, standard payload: return the Response.
  static adapter = {
    loadAll: (fetch) => fetch('/v2/posts?include=all'),
  };

  // Envelope API plus a custom method.
  static adapter = {
    endpoint: '/api/posts',
    async loadAll(fetch, options) {
      const query = new URLSearchParams(options);
      return (await (await fetch(`/api/posts?${query}`)).json()).data;
    },
    publish: (fetch, id) => fetch(`/api/posts/${id}/publish`, { method: 'PATCH' }),
  };
  ```

  The supplied `fetch` has the standard fetch signature and returns a normal
  `Response`; it additionally runs `beforeRequest` and uses the fixtures mock
  seam. Returning that `Response` from a framework verb asks Puzzle to check
  status, parse JSON, and apply the response guards described in the write-body
  note below. Returning parsed data is equally valid. `store.loadAll(type, options)` forwards pagination
  options to an author transport; the endpoint-generated default serializes
  them as a query string, and separate pages accumulate in the normalized
  store. `store.adapter(type)` exposes the same functions with enhanced fetch
  already bound, including custom methods. Using global `fetch` explicitly
  bypasses `beforeRequest` and fixture interception.

  App-wide dialects live on a configured capability, conventionally exported
  from `app/adapter.js`. Dispatch is model function → app default → generated
  endpoint transport, so a model remains the most-specific override. Defaults
  receive `{ type, endpoint }` after the normal verb arguments (`endpoint` is
  undefined when the model has none). `endpoint` is the raw value declared on
  the model — it is **not** `apiURL`-prefixed, because only the generated
  transport prepends `apiURL`. An app that sets `apiURL` must prefix it in the
  dialect itself:

  ```js
  // app/adapter.js
  import { adapter } from '@magic-spells/puzzle/adapter';

  export default adapter.defaults({
    async loadAll(fetch, options, { endpoint }) {
      const response = await fetch(endpoint);
      return (await response.json()).data;
    },
  });
  ```

  Each `defaults()` call returns a new frozen capability scoped to its app, so
  multiple apps on one page can use different dialects. `beforeRequest` and the
  fixtures seam apply to defaults exactly as they do to per-model functions, and
  their returns pass through the same Response handling and shape guards.

- **BREAKING: a write response must be a pk-bearing object or nothing (D158).**
  `create` and `update` return "the server's record, primary key included" or
  nullish for "no echo" — that contract is now enforced. A 2xx body that is
  neither (a primitive such as `"OK"` or `true`, an array, `{}`, or an object
  missing the primary key) throws instead of being accepted. 0.5.0 accepted
  those bodies and marked the record synced.

  This matters most on `create`: because the throw leaves the record un-synced,
  the write is reported as failed and a retried `save()` dispatches **`POST`
  again**, duplicating the server row. A server that answers writes with a bare
  `"OK"`, a `{ "data": … }` envelope, or an id-less acknowledgement needs one of:

  ```js
  // Return nothing — "no echo", keep local state and mark synced.
  static adapter = {
    endpoint: '/api/todos',
    async create(fetch, record) {
      await fetch('/api/todos', { method: 'POST', body: JSON.stringify(record.toJSON()) });
    },
  };

  // Or unwrap the envelope so the record (with its pk) is what you return.
  async create(fetch, record) {
    const res = await fetch('/api/todos', { method: 'POST', body: JSON.stringify(record.toJSON()) });
    return (await res.json()).data;
  }
  ```

  Returning nothing is the right answer whenever the server's body is not the
  record; a server-assigned id must arrive in a returned object, since that is
  how the store adopts it. `loadAll`/`loadOne` shape guards are unchanged.

- **Faster builds and dev rebuilds (D151–D156).** Emitted bytes and failure
  contracts are unchanged — builds still stage and atomically swap `dist/`,
  and a failure keeps the last good output serving.

  - **Build-scoped compile cache (D152).** One usage scan and one transform per
    source (keyed on path + content hash) now feed all three static-build
    esbuild passes; each `{#svg}` asset is read once.
  - **Shell-head plan (D151).** Head injection compiles the shell once per
    build and splices per page instead of running 13–17 full-document scans
    (~342ms off a 148-route build). Also a correctness fix: a `<title>` or
    `data-puzzle-head` in **view** output is no longer rewritten.
  - **`.puzzle/` scratch dir (D153).** Staging and previous-output holding
    dirs moved from the app root into the self-gitignored `.puzzle/tmp/`.
    Killed-build leftovers — which could take Tailwind's source scan from
    112ms to 14s — are swept at build/dev startup, legacy names included.
  - **Warm static dev rebuilds (D154).** Static-mode `puzzle dev` reuses
    persistent esbuild contexts, a session compile memo, and the warm Tailwind
    child instead of a cold `puzzle build --static` per save; a styles-only
    save writes one file and renders no routes.
  - **Route-level invalidation (D155).** A warm rebuild renders only the
    routes a save can reach (attributed via the build's esbuild metafiles) and
    hardlinks the rest into staging; anything the classifier cannot place
    falls back to a full render. Output stays byte-for-byte what
    `puzzle build --static` produces. With D154, a leaf edit on a 148-route
    site went from ~2.3s save-to-served to ~250ms.
  - **Change-aware SPA rebuilds (D156).** The usage scan reruns only when a
    `.pzl` changed, unimported public-only batches skip esbuild, CSS
    recomposes only when the collected blocks moved, and independent one-shot
    phases run concurrently.
  - **`--profile-build`** on `build` and `dev` (or `PUZZLE_PROFILE_BUILD=1`)
    prints deterministic per-phase timing tables to stderr; disabled, it is
    allocation-free.

- **`puzzle add piece` fetches from npm, version-locked.** The default source
  is the published `@magic-spells/puzzle-pieces` package, resolved to the
  newest release matching the CLI's major.minor (pieces `0.6.x` for puzzle
  `0.6.x`; prereleases never auto-selected). A CLI whose minor has no pieces
  release yet falls back to the newest **older** major.minor with a printed
  note — never a newer one, whose grammar this binary may not know — and
  hard-errors only when nothing older exists. `--pieces-version` pins an exact
  release; `--registry` (or `$PUZZLE_PIECES_REGISTRY`) takes
  `npm:<package>[@version]`, a local directory, or an http(s) URL.
  `pieces.lock` gains a `puzzle` field recording the adding compiler version.
  Pieces are still copied in verbatim; nothing imports the package at runtime.

### Added

- **`PUZZLE_RUNTIME` selects the JS runtime to build against.** Point it at a
  Puzzle checkout (the directory holding `client-runtime/`) and the bare
  specifier plus every subpath export — `/adapter`, `/morph`, `/router-modes`,
  `/ssg`, `/static`, `/fixtures` — resolve there, overriding both the in-repo
  walk and `node_modules`:

  ```sh
  PUZZLE_RUNTIME=~/Code/@magic-spells/puzzle puzzle dev
  ```

  This closes a gap for anyone testing a working-tree build in an app outside
  the repo. The CLI is a Go binary, so running one from source swapped only the
  COMPILER — the runtime still came from the target app's `node_modules`,
  silently pairing a new compiler with a published runtime. The alternative was
  `npm install /path/to/puzzle`, which writes a `file:` dependency into the app
  and is easy to commit by accident; the env var touches nothing.

  A set-but-invalid value exits rather than falling through to `node_modules` —
  silently building the runtime you were trying to avoid is the failure this
  prevents. `puzzle doctor` reports the override by name under "runtime
  package", since a build against a forgotten checkout is otherwise
  indistinguishable from a normal one.

- **Opt-in SPA code splitting.** `build: { splitting: true }` makes every
  dynamic `import()` in the SPA bundle a lazy chunk under `dist/chunks/`
  instead of inlining it into `app.js`, so a heavy on-demand dependency is
  fetched only when its code path runs. Measured on a starter app with
  `chart.js` behind an `await import()`: `app.js` 263.4 KB → 63.6 KB
  (89.8 KB → 20.9 KB gzip), with the 199.3 KB remainder in one chunk; total
  shipped bytes are unchanged, because esbuild's ESM splitting has no
  chunk-loader runtime. The entry keeps its stable `app.js` name, so the shell
  HTML is untouched, and static imports behave exactly as before.

  Default OFF this release — with the key absent (or `null`, which means unset)
  every build emits the same single file it does today. While the flag is on,
  `chunks/` is a reserved output name and a root-level `public/chunks` asset
  fails the build, the same guard `app.js` has. `output: 'static'` ignores the
  flag: its per-page bundles already split, and its `app.js` never ships.
  `puzzle dev` splits too, pruning a re-hashed chunk's predecessor on every
  rebuild so a warm `dist/` never accumulates orphans.
- **Bundle composition in the build banner.** `puzzle build` now prints a
  largest-dependencies breakdown from esbuild's metafile and, in production,
  warns when a single dependency contributes more than 200 KB, pointing at
  `import()` + `build.splitting`. Your own code and the framework runtime are
  listed but never flagged — neither can move behind a dynamic import.
- **Embedded esbuild 0.19.11 → 0.28.2.** Nine minor versions of bundler fixes,
  including the ESM cross-chunk ordering work that makes splitting dependable.
  Output bytes shift slightly (the todos example's gzip figure moved 22.5 KB →
  22.4 KB); no API change.

- **Static raw template blocks (D150).** `{#raw}…{/raw}` disables Puzzle's
  brace lexer for author-written source, so JSON, JavaScript, CSS, and examples
  can contain literal `{ ... }`, `{#if}`, and formatter pipes. HTML inside the
  block still parses normally, blocks do not nest, and the first
  whitespace-tolerant `{/raw}` closes it. The body is static and cannot receive
  runtime values; dynamic raw-HTML injection remains deferred. Client and
  prerendered text round-trip identically, including `<` inside normal text and
  JSON-typed `<script>` elements.

## 0.5.0 — 2026-08-07

### Added

- **`<Portal>` (D144).** `<Portal>…</Portal>` teleports its children's DOM to a
  framework-created outlet at the app root while the subtree stays in the
  owner's component tree — same props, data flow, lifecycle, and teardown. For
  overlays that must escape ancestor CSS: containing blocks from
  `transform`/`filter`/`contain`, `overflow` clipping, and stacking contexts.
  It is empty in prerendered HTML, and `@event:outside` is portal-aware — a
  click inside a portaled panel does not read as "outside" its logical owner.

  **`<Portal>` is a capitalized marker in the D134 family**, recognized before
  component resolution, and it composes with the other markers:

  - `<Children/>` and `<Slot name="x"/>` work inside a `<Portal>` — a portaled
    subtree fills from the call site normally.
  - Lowercase `<portal>` gets the same positioned steering error the other
    lowercase spellings get.
  - Unlike `<Children/>` and `<Slot/>`, **`<Portal>` is paired-only** — a
    self-closing `<Portal/>` is a compile error, since a portal exists to carry
    children.
  - It is rejected inside a marker fallback body (the D141 rule) and inside an
    `island`.
  - Attribute-free: `to`/`name` are positioned compile errors, reserved for
    future named outlets.
  - Portal-in-portal is allowed.

  A `<Portal>` at a **component** template's root is a positioned compile error
  — the inline root is where call-site attributes merge and where the scoped
  style stamp lands, and a portal leaves only a comment placeholder locally, so
  there is no element to do either job. The error names the fix: wrap it in
  `<div style="display: contents">`. Portal-only components (toast stacks,
  slide-overs) hit this on the first try. A portal-only **view** is legal —
  views keep their `<puzzle-view>` root.

- **Error boundaries and app-level `onError` (D145).** Every
  framework-contained app error now reports through one funnel.
  `new PuzzleApp({ onError })` registers the hook; without one, the funnel
  replays the exact `console.error` the catch site used to make, so existing
  output is unchanged. Views may define `errorContent()` to render a fallback
  face instead of leaving a blank hole. The underlying D115/D136/D143 recovery
  and ownership semantics are unchanged — this gives them a reporting seam and
  a rendered fallback.

- **Implicit two-way form binding (D147).** A path-shaped `value=`/`checked=`
  (`ident` or `ident.ident`) on a plain form control synthesizes its own
  write-back handler — the one-line mirror `@input` handler is no longer
  needed:

  ```html
  <input value="{ draft.title }">          <!-- writes back on input -->
  <input type="checkbox" checked="{ todo.done }">
  ```

  Suppressed by an author `@input`/`@change`, static `readonly`/`disabled`, a
  non-path expression, a dynamic or excluded `type`, or a component tag.
  Number, checkbox, date kinds, and `<select>` commit on `change`; numeric `''`
  writes `null` and `NaN` is skipped; IME composition never mid-writes. Records
  write through validated `update()` (rejections report to `onError` with
  `phase: 'bind'`); bare locals write `setData` + refresh. `type()` is added to
  `@magic-spells/puzzle/testing` for driving bound controls in tests.

- **`puzzle preview` (D148).** `puzzle preview [dir] [--port N] [--strict-port]`
  serves an existing `dist/` the way a production host will, per resolved
  output mode: SPA gets history-API fallback; hybrid serves the prerendered page
  first and the shell otherwise; static gets clean URLs and a **real** 404
  (the built `404.html`), never the shell. No watcher, no SSE, no injection, no
  `dev.proxy` — the artifact is checked as it sits on disk. Default port 4000
  so it runs beside `puzzle dev`.

- **`puzzle dev` runs the real static pipeline (D148)** on an
  `output: 'static'` project, instead of serving it as an SPA. Hybrid projects
  continue to develop as the SPA.

- **`examples/overlays`**, a Portal showcase.

### Changed

- **Attribute namespaces are reserved (D147).** `bind:value`, or any other
  `prefix:name` attribute, is now a positioned compile error reserving that
  space for the grammar. `xml`, `xlink`, and `xmlns` are allowlisted.

- **`PORTAL_TAG` is a reserved script binding (D144),** alongside the existing
  `SLOT_TAG`. A module-scope binding or loop variable by that name in a `.pzl`
  `<script>` is a positioned compile error (D133).

### Fixed

- **Reused ancestors join the atomic navigation commit (D146).** A gated
  navigation now either lands completely — URL, history, title, mounted tree,
  scroll save, **and** every reused ancestor's params, route snapshot, data,
  and store subscriptions — or changes nothing at all. This closes the last
  piece of state that sat outside the D61 commit window, and with it the
  D19/D30 soft violation where a failed navigation could leave a surviving
  layout showing destination params.

- **A payload key colliding with a computed getter no longer throws (D149).**
  Record assignment resolves each key along the prototype chain and drops any
  key whose resolved descriptor is a setter-less accessor, warning once per
  (model class, key) in development.

- **A `data()` commit that reverts a bound local key** now warns in development.

## 0.4.0 — 2026-07-28

### Breaking

- **Composition markers are capitalized (D134).** `<Children/>` for component
  default content, `<Slot name="x"/>` for a named slot, `<Slot/>` for the
  router outlet. **Lowercase `<children/>` and `<slot>` are no longer valid**
  in any position — each is a positioned compile error naming its replacement,
  except bare `<slot>`, where the error offers both candidates because the old
  spelling was ambiguous. See [Upgrading across versions](#upgrading-across-versions).

  | Before | After |
  |---|---|
  | `<children/>` | `<Children/>` |
  | `<slot/>` in a component | `<Children/>` |
  | `<slot/>` in a routed view or layout | `<Slot/>` |
  | `<slot name="x"/>` | `<Slot name="x"/>` |

  The call-site `slot="x"` attribute is unchanged. Capitalization now uniformly
  means "the framework resolves this tag": components from your imports,
  markers from the grammar.

- **Nullish interpolations render empty (D127).** `{ maybeNull }` rendered the
  literal text `null` and `{ maybeUndefined }` rendered `undefined`. Both now
  render nothing. If you were relying on the old output, interpolate an
  explicit fallback.

### Added

- **Marker fallback bodies (D141).** Markers accept a paired form whose body is
  fallback content, rendered only when nothing fills that position — supplied
  content replaces it entirely:

  ```html
  <Children>Save</Children>                        <!-- default call-site content -->
  <Slot name="footer"><button>OK</button></Slot>   <!-- named-slot fallback -->
  <Slot>No page selected</Slot>                    <!-- outlet: no child route -->
  ```

  Fallback bodies are ordinary template content — formatters, `{#if}`/`{#for}`,
  components, `{#svg}`. A self-closing marker has no fallback; an empty paired
  body means the same.

- **Dev-only performance profiling (D121/D122)** with zero production bytes.
  Separates render-function cost from diff/patch cost, counts actual DOM
  writes (a zero-mutation render is a wasted render), times `data()` and store
  flushes, and surfaces props bailouts, slot-only renders, and memo hit rates —
  reported over the DevTools protocol. All state lives in module WeakMaps; no
  fields are added to any runtime class, and the module folds away in
  production.

- **`benchmarks/`**, a production benchmark harness, and `examples/stress`
  (D128).

### Fixed

- **Hybrid prerender renders real route state (D142).** `router.current` is the
  page's route snapshot during prerender, so active-nav classes and `current.*`
  reads are correct in shipped HTML — crawlers and no-JS visitors see the same
  state the live app renders.
- **Prerendered pages survive a failed takeover (D140).** If the client mount
  throws, the prerendered content and its marker are restored — never a blank
  page.
- **Router focus no longer draws a focus ring (D139).** The transient focus
  stamp suppresses both channels (`outline` and `box-shadow`) for its lifetime,
  so keyboard navigation stops ringing the whole view.
- **`@event:once` detaches on spend**, including `:outside:once`'s
  document-level listener — zero listener cost after the single fire.
- **Params-only `replace()` no longer yanks focus per keystroke (D135).**
- **Enter animations and `mounted()` ordering converge on the anchor-race
  path (D136).**
- **`loadAll`/`loadOne` guard server records with no primary key (D137)** and
  merge through the per-field revision gate, so a background poll cannot wipe
  an in-flight edit (D138, D125 parity).
- **`mounted()` throw contract (D143).** Component-owned views destroy and
  remount on the next patch; router-owned views stay mounted on their committed
  route. Each console message names its outcome.
- **Reserved module-scope script bindings** are rejected with a positioned
  error instead of colliding silently (D133).
- **`save()` and `delete()` serialize behind one per-record write chain (D132),**
  so interleaved verbs cannot reorder.
- **Date formatters cache their `Intl` objects** (roughly 30x on repeated
  formatting).
- **Route-path shape has one owner (D126).** The router and the SSG classified
  and validated path shape independently with different rules; both now share
  `router/routePath.js`. Prerender output may no longer silently overwrite a
  public asset.
- **Async `data()` is serialized**, persistence batches its writes, and the
  SSG takeover path is kept out of plain SPA bundles (D130).

## 0.3.1 — 2026-07-25

Republish of the 0.3.0 feature set with correct registry metadata. No code
changes.

- **Fixes the broken 0.3.0 publish (D120).** The root package is now published
  as the packed tarball (`npm publish ./magic-spells-puzzle-<version>.tgz`),
  never as a directory publish, and `prepublishOnly` refuses the directory path
  outright. `npm run verify:published` inspects what the registry actually
  resolves against.

## 0.3.0 — 2026-07-25 — **deprecated, do not use**

This version installs the CLI shim with no platform binary: its registry
metadata carries no `optionalDependencies`, so `puzzle` exits 1 on every
machine. **Use 0.3.1**, which is the identical feature set correctly published.
The features below all ship in 0.3.1.

### Breaking

- **Production source maps are opt-in (D88).** Production builds emitted a
  linked `.js.map` unconditionally — roughly 468 KB beside the bundle on the
  todos example, exposing original source structure on any deploy. Set
  `build.sourceMap: true` to restore it.
- **Managed head tags are build-time only (D111).** `syncTags` is gone from the
  browser; `og:*`, `twitter:*`, and `canonical` are produced by the SSG at build
  time and baked per page into prerendered HTML. An SPA-only app that relied on
  these being applied at runtime will no longer see them. The tab title is
  unaffected — `syncTitle` still runs on every navigation in every mode.
- **`dev.proxy` rejects two prefix shapes at config load (D110):** `/` (the root
  proxy) and two keys that name the same route after trailing-slash
  normalization. The first was a documented feature; the second used to crash
  the dev server.
- **A bare `YYYY-MM-DD` is a calendar date (D114).** `date`, `time`, `datetime`,
  and `timeago` parse it as local midnight instead of the ES spec's
  UTC-midnight rule, and `in_timezone` passes it through untouched — a day names
  no instant. `{ post.publishedAt | date }` of `"2026-07-24"` now renders
  `07/24/2026` for every reader; previously anyone west of UTC saw `07/23/2026`.
  Values carrying their own time or zone are untouched.

### Added

- **`@magic-spells/puzzle/testing` (D94)** — `mountView`, `createTestApp`,
  `settled`, `measureRenders`, `installFakeAnimate`, `installFakeObserver`. A
  correct `settled()` is framework-owned knowledge: `data()` is async and
  last-wins, the store flush is rAF-scheduled with a `document.hidden` branch
  and a 220 ms fallback, navigation is load-then-atomic-commit, and jsdom ships
  neither WAAPI nor IntersectionObserver.
- **`@magic-spells/puzzle/fixtures` (D95/D98)** — `store.seed(type, n)`
  generates believable records from the schema alone, and
  `static adapter = { mock: … }` serves the adapter verbs from an in-memory
  collection with configurable latency and failure rate. Self-contained and
  self-attaching; bundled into an app only by the `--fixtures` flag on
  `puzzle dev` / `puzzle build`.
- **`beforeRequest` adapter hook (D91).** Every adapter fetch routes through one
  private `Store._fetch(url, init, context)`, and `beforeRequest` shapes the
  `init` before it goes out — auth headers, `credentials`, an `AbortSignal` —
  across the whole adapter surface at once. Previously the read path was a bare
  `fetch` with no init object, so an app with token auth could not use the D21
  read path at all.
- **Build errors appear in the browser (D92).** The reload channel carries typed
  events, the dev server retains the current error so late-connecting clients
  see it, and a first-ever failed build serves a self-healing error shell
  instead of a bare 404.
- **Router focus management and route announcement (D93).** After every
  committed navigation the router moves focus to the incoming view's root and
  announces the new title in a framework-owned live region. `focusBehavior`
  mirrors `scrollBehavior`: omit for the default, `false` to opt out, a function
  to choose the target.
- **DevTools runtime bridge (D100).** A dev-only bridge speaking a versioned
  wire protocol. The extension lives in its own repo,
  `magic-spells/puzzle-devtools`, and never imports framework internals. With no
  hook installed every touchpoint is a no-op and production DCE removes the
  module.
- **Feature-usage tree-shaking (D89)** driving runtime DCE defines.
- **`puzzle upgrade skills`**, and `puzzle add skills` asks before replacing an
  installed skill (D97/D99).

### Fixed

- **`store.findOne('post', this.params.id)` finds numeric-id records (D112).**
  The record map keys number primary keys by their string form via one helper
  applied at every id-keyed access. Record fields are never touched — a numeric
  server id stays a number on the record.
- **Static output always emits history-style hrefs (D117).** A configured
  `hash`/`memory` `routerMode` is warned as ignored rather than producing
  unusable links.
- **The SSG stops entity-escaping `<script>` and `<style>` contents (D113).**
- **Mount-failure recovery keys off the instance (D115);** preloaded views are
  exempt.
- **Lifecycle hook containment (D118).** Mount cycles carry a generation token
  so stale continuations bail, reveal hooks are guarded so content is never
  stranded, and `render() -> null` clears.
- **Router settlement (D119).** A double-click push returns the in-flight
  promise, and announcement falls back past an unchanged title.
- **CLI:** `generate --path` resolves symlinks, `pieces install` fails before
  writing, dead SPA route metadata warns, and `listenDev` validates the port
  range.

## 0.2.0 — 2026-07-24

### Breaking

- **`.pzl` section tags are singular.** `<scripts>` → `<script>`, `<styles>` →
  `<style>`. This includes `<script lang="ts">` and `<style scoped>`.
- **`output: 'static'` now means true static; the old behavior is
  `output: 'hybrid'` (D81).** The D67 mode — prerendered pages plus the full SPA
  bundle plus router takeover — is renamed `output: 'hybrid'` /
  `puzzle build --hybrid`, byte-identical. **If you were using
  `output: 'static'`, rename it to `'hybrid'` to keep the behavior you had.**

### Added

- **True static-pages output (D81).** `output: 'static'` emits per-route
  content-complete HTML with no router, no SPA takeover, and no history API —
  navigation is plain `<a>` page loads. Each page ships a small ES module that
  mounts only its own components over the prerendered markup.
- **Path-shaped links (D79).** `router.url(path)` encodes a path-shaped route
  into the mode-appropriate href — `/x` in path mode with the base prefix,
  `#/x` in hash mode with an in-fragment base, unchanged in memory mode — and
  the built-in `link` formatter exposes it to templates:
  `href="{ '/collections/' + c.id | link }"`. Closes the last seam where a `#`
  had to appear in app code.
- **Route guards (D87).** Any route node may declare `guard: fn`
  (`({ to, from, ctx }) => verdict`). A navigation runs every guard along the
  matched chain root → leaf, sequentially, first failure wins, before any
  view/layout construction and before the load gate. Guarding a top-level route
  locks its whole layout subtree with one declaration.
- **Route head management (D84)** — the four reserved `meta` fields, with
  `document.title` sync.
- **Router query snapshot and `replace()` (D83).**
- **`flip` attribute (D85)** — FLIP-animates keyed reorders,
  translation-only and reduced-motion aware.
- **`@event:outside` modifier (D86)** — document-capture outside-dismiss.
- **Compiler a11y warnings (D82).** Five template mistakes warn (never error)
  with exact source positions; generated JS is unaffected.
- **Dev port scan (D90).** A busy port is no longer fatal — `puzzle dev` binds
  the first free loopback port at or above `--port` (default 3000, at most 10
  candidates) and reports what it bound. `--strict-port` restores
  bind-or-fail.

## 0.1.2 — 2026-07-22

- **Embedded agent skill and `puzzle add skills` (D78).** The skill is
  self-contained — no external references.
- **`dev.proxy`** — point a same-origin path at a local backend from
  `puzzle.config.js`, so development requests need no CORS setup.
- **Public `store.upsert()`** — merge a server payload for a custom action
  response without going through a declared adapter verb.
- Datastore fixes: `record.delete()` is self-idempotent (a second call
  resolves instead of rejecting), and `createRecord` enforces primary-key
  parity with `Model.validate()` — a blank `.primary().required()` key is
  rejected rather than silently generated.

## 0.1.1 — 2026-07-22

- **`puzzle init` prompts (D77)** — TTY-gated template and TypeScript
  selection.

## 0.1.0 — 2026-07-22

First public release. SPA-first browser runtime with a Go/esbuild compiler for
single-file `.pzl` components: reactive `data()`, a model/store layer with
adapters, relationships, schema validation, persistence, and write sync;
chainable display formatters; nested routing with layouts and outlets; morph
transitions; DOM islands; skeletons; and the `puzzle` CLI (`init`, `dev`,
`build`, `generate`, `add`, `doctor`, `info`).
