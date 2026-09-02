---
name: 0.7.0 — reads take care of themselves
status: building
version: 0.7.0
connections:
  - RELEASE-V0-6-0
  - DOC-RELEASE-SURFACE
  - FEATURE-AUTO-FETCHING-FINDS
  - FEATURE-SPA-CODE-SPLITTING
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D162-MONOREPO-PACKAGES
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D76-CLI-UPGRADE
  - FLOW-RELEASE
notes:
  - kind: state
    text: >-
      D161 auto-fetching-finds round verified post-merge on the release branch: both suites green,
      and the five round cards (D161, D21, D49, D158, the v1.76 feature) re-verified and stamped,
      with staleness corrected in place. Still open for ship: the matching pieces 0.7.x publish,
      release prep, and the prose sweep — note the CHANGELOG's "fixture-driven apps are untouched"
      clause is wrong (installFixtures() installs the capability, so fixture apps fault through the
      mock) and needs the same correction the cards got.
  - kind: state
    text: >-
      Card body brought current for the whole 0.7.0 window (PRs #73-#84), not just D161/D76. The
      earlier note's CHANGELOG fixture-clause complaint is now closed — the section says fixture
      apps fault like production. Open prose gaps found in the same sweep: the CHANGELOG omits the
      {#raw}/single-root, {#svg} attribute, TS import-clause, fragment-pop, local-model-fault, and
      upgrade global-assert fixes, and two of its claims went stale (date-only fields now serialize
      as YYYY-MM-DD via CalendarDate#toJSON; upgrade no longer falls through to "must be global").
  - kind: state
    text: >-
      Close-out checklist carried from the (now deleted) plans/V0-7-0-PLAN.md, 2026-08-30: all
      feature work merged or in PR #90 (snippets). Before publish: (1) CHANGELOG completeness — the
      card's missing-items list plus Windows binaries, lazy routes + __PUZZLE_HAS_LAZY__ gate,
      playground WASM core (D164), puzzle check (D165), snippets (D166); (2) DOC-RELEASE-SURFACE
      rewrite to 0.7.0 surface (five platform packages, lazy(), puzzle check, snippets); (3) D165 +
      D166 decision cards + SPEC sections + SKILL.md marker rewrite; (4) release:prep re-measures
      README size banner LAST (snippets moved figures ~+50 B); (5) pieces 0.7.0 publish at/before
      CLI (now includes data-table cell snippets + new virtual-list piece round); (6) editor
      grammars (vscode/sublime/zed) gain the Snippet marker; (7) site: llms.txt + playground (site
      PR #3) go live at Cory's manual wrangler deploy + domain cutover; re-vendor puzzle-skill.md at
      the site's 0.7.0 bump (drift gate enforces).
  - kind: state
    text: >-
      Windows-on-ARM now actually works, and the release pipeline grew two checks (deep-review
      round, branch fix/build-platform-release).


      The card's "Windows-on-ARM runs the x64 binary under emulation, so there is deliberately no
      win32-arm64 package" was a claim the code did not honor. bin/puzzle.js resolved an exact
      `${process.platform}-${process.arch}` key with no win32-arm64 row, and the x64 package
      declared `cpu: ["x64"]` — so on a NATIVE ARM64 build of Node (arch === 'arm64') npm never
      installed the package and the shim exited 1 with "no prebuilt CLI binary available". Emulation
      only covers a process already running the x64 binary; it does not make an ARM64 Node report
      x64. Fixed in three places that must agree: the shim's PLATFORM_PACKAGES maps win32-arm64 →
      @magic-spells/puzzle-win32-x64, that manifest widens to `cpu: ["x64", "arm64"]`, and
      platformPackageNameFor in compiler/cmd/puzzle/upgrade.go folds windows/arm64 to the same
      package so `puzzle upgrade` names the install that exists. Still five published packages — the
      fold is in the lookup, not the matrix. The shim's unsupported-platform message now prints host
      → package so the two Windows keys do not read as two binaries. Covered by
      tests/bin-shim-resolver.test.js (spawns the real shim against a planted fake node_modules,
      with process.platform/arch redefined per case) and a new row in TestPlatformPackageNames.


      Release-pipeline additions: release:prep now dry-packs all five platform packages and asserts
      each tarball carries the binary its manifest declares at a non-zero size — four of the five
      are never executed on the release host, so `go build` exiting 0 was their only witness.
      verify:published now also asserts @magic-spells/puzzle-pieces exists at the EXACT framework
      version and that the installed CLI scaffolds an app and resolves `add piece` to that version
      with PUZZLE_PIECES_REGISTRY deleted from the child env (it is exported in Cory's shell and
      would otherwise satisfy the check from local files); the compatibility-fallback notice is a
      failure and pieces.lock's resolved `registry` is the authoritative assertion. Both predicates
      live in scripts/release-checks.mjs with tests/release-checks.test.js.
---

# 0.7.0 — reads take care of themselves

Unreleased. In progress on the `release/0.7.0` branch: not published, not
tagged, and nothing in it should be described as shipped. npm `latest` is still
0.6.0. Every package in the train — framework, pieces, devtools, eslint,
prettier — is stamped `0.7.0` locally.

The centerpiece is v1.76 auto-fetching finds
([[FEATURE-AUTO-FETCHING-FINDS]] / [[DECISION-D161-AUTO-FETCHING-FINDS]]).
Reading server data stops needing loading code. Inside a view's `data()`, a
tracked `findOne`/`findMany` that misses returns its local value and queues a
fetch; the view does not commit that pass, and Puzzle re-runs `data()` behind
the batch until every read comes up warm. Dependent reads resolve on their own
— no declared order, no `loaded` flag, no eager seed. The contract that makes
it usable is that **a committed `null` means the record does not exist**, never
"still loading"; only a framework-normalized 404 produces one, and everything
else in the design exists to protect that promise. The eager-seed idiom 0.6.0
taught is retired, though a leftover seed still works.

Alongside it, v1.77 lazy route views ([[DECISION-D163-LAZY-ROUTE-VIEWS]]) close
the phase 2 D160 named when it shipped code splitting: `lazy(loader)` marks a
route `view` or `layout` as on-demand, and the router resolves those markers
after guards pass and before anything constructs. A gated route never
downloads, a failed load is an ordinary failed push, and the previous view
holds until the new one commits — there is no new loading UI, because a lazy
route is just a slow route. The resolver itself sits behind
`__PUZZLE_HAS_LAZY__`, so an app that never calls `lazy()` does not ship it at
all — about 0.6 KB gzip off every lazy-free SPA. Detecting that now means the
D89 usage scan reads the app's `.js`/`.ts` modules as well as its templates,
since `lazy()` is called from `routes.js`.

The second thread is composition. v1.79 snippets
([[DECISION-D166-SNIPPETS]]) close the last item on the SPEC's deferred
composition list: slots render a passed-in template, and a snippet renders it
repeatedly, with data. A caller writes `<Snippet fits="row" user group>…`
inside a component invocation — bare attributes declare the parameters — and
the component stamps it by handing values out through its own markers,
`<Slot name="row" user={ user }>`. The benefit lands mostly on pieces: a
`data-table` can finally let the app decide what a cell looks like, and a
windowed list piece becomes possible. Apps that use neither snippets nor marker
arguments pay nothing for it.

The third is tooling. `puzzle check` ([[DECISION-D165-PUZZLE-CHECK]], v1.78) is
the first thing in Puzzle's history that type-checks a `.pzl` — script bodies
and template expressions both — by emitting virtual files under
`.puzzle/check/` and running the app's own `tsc` over them, then mapping every
diagnostic back to the authored line and column. It is built entirely on the
`tsc` CLI protocol, never a TypeScript compiler API, which is why it works
today on 4.9 and on the 7.0 Go rewrite. Separately,
[[DECISION-D164-PLAYGROUND-WASM-BOUNDARY]] adds a `js/wasm` build of the parser
and codegen for the documentation site's playground: real diagnostics and real
generated code in the browser, behind a bounded worker protocol, with no
bundling, no asset resolution, and no new app surface.

The fourth is repo shape. [[DECISION-D162-MONOREPO-PACKAGES]] pulls the
framework, the pieces registry, the DevTools extension, and the `.pzl`
lint/format plugins into one repository under `packages/`, versioning as one
train. Nothing about the published package changes — same name, exports, and
tarball layout — but a pieces release can no longer lag the CLI it is
version-locked to.

The fifth is reach: the CLI ships a Windows x64 binary, so the release goes out
as six npm packages instead of five and `npm install` on Windows resolves a real
`puzzle.exe` rather than printing the unsupported-platform message. A
`windows-latest` CI job runs the Go suite and scaffolds and builds an app with
that binary on every push, which is the only standing proof the target works —
nothing in the release pipeline can execute a cross-compiled binary for a
platform other than the host ([[FLOW-RELEASE]]).

Everything else is correctness. A pre-release review round and a decisions
round closed a long tail across the model layer, the view lifecycle, the
router, the compiler, and the CLI.

## What's in it


**Breaking (all three from D161, and only for apps passing the `/adapter`
capability):**

- Tracked `findOne`/`findMany` fetch what the store is missing.
- The collection verb is `loadMany`; `loadAll` throws at four sites rather than
  aliasing, so an unmigrated app fails at boot instead of rendering empty lists.
- Generated read failures normalize to `PuzzleAdapterError` with a `.status`,
  where they used to reject with a plain `Error` carrying only a message.

**Added:**

- `lazy()` (D163), a new root export: `view: lazy(() => import('./X.pzl'))` in a
  route or layout position defers that class until the route is navigated to
  and its guards allow it. Markers across the matched chain resolve in
  parallel, fulfillment is memoized for the app's lifetime while a rejection
  never is (so retry re-invokes the loader), and a loader failure reports as
  `phase: 'navigation'` with URL, history, and DOM untouched. `build.splitting`
  (D160) turns each loader into a chunk; both prerender modes await the same
  markers. `examples/blog` splits its `/settings` section as the acceptance
  case. The resolver is gated behind `__PUZZLE_HAS_LAZY__`, so a lazy-free app
  ships none of it; a marker that reaches a compiled-out build fails loudly at
  route-compile time rather than mounting as if it were a view class.
- **Snippets** (D166): `<Snippet fits="row" user group>…</Snippet>` at a
  component call site declares a parameterized body, and data attributes on the
  component's own `<Slot name="row" user={ user }>` / `<Children user={ user }>`
  stamp it once per item with fresh vnodes. Binding is by name, paired marker
  bodies remain D141 fallbacks, and the snippet function travels in the children
  channel rather than as a prop so it cannot defeat the props shallow compare.
  Development warns on argument-shape mismatches, markers filled with plain
  content, and snippet output that contains a composition marker. A snippet body
  is a composition **leaf**: `<Children>`, `<Slot>`, `<Portal>`, `<Snippet>`,
  and `ref=` inside one are positioned compile errors at any depth — including a
  `<Snippet>` on a component invocation inside the body, which the error steers
  to fix by extracting that invocation and its snippet into their own component.
  `SNIPPET_TAG`/`isSnippet` join the
  public type surface, and `__PUZZLE_HAS_SNIPPETS__` keeps non-users at zero
  bytes (users pay roughly 50 B gzip).
- **`puzzle check`** (D165): the new CLI command type-checks `.pzl` files with
  the app's own installed TypeScript. It emits virtual files under
  `.puzzle/check/src/` — a `lang="ts"` script verbatim plus a generated wrapper
  that restates every template expression as typed statements, or, for a
  JavaScript component, an unchecked script mirror alongside that wrapper —
  runs the app's `node_modules/typescript/bin/tsc` under `node`
  (`--noEmit --pretty false`), the same invocation on every OS, and
  remaps diagnostics to exact `.pzl` positions through byte-exact segment
  tables. The generated tsconfig extends the app's, neutralizes the settings
  that would break the workspace, and switches shape for TypeScript 7 after
  probing `tsc --version`; one unparsable file no longer aborts the run.
  Nothing in it touches a TypeScript compiler API.
- **A WebAssembly compiler core for the playground** (D164): the tooling-only
  `js/wasm` command exposes the real parser and codegen — diagnostics,
  generated JavaScript, scoped CSS, warnings — through a bounded worker
  protocol. It ships in no npm package and deliberately omits bundling, asset
  resolution, and TypeScript transformation.
- `output: 'static'` pages carry the build's read state in a second inline
  island (versioned, omitted when the build settled nothing), so `mountStatic`
  does not refetch every collection and re-404 every id the build already
  settled. Hybrid transfers nothing new by design.
- HMR preserves the collection-complete set and the negative cache across a dev
  reload. In-flight promises are never carried.
- A Windows x64 CLI binary, as a fifth platform package
  (`@magic-spells/puzzle-win32-x64`, packing `bin/puzzle.exe`) pinned as an
  `optionalDependency` like the other four. The packages are keyed the way Node
  spells the platform — `win32`, not Go's `windows` — because the bin shim looks
  them up by `process.platform`/`process.arch`; `puzzle upgrade` derived that
  name in Go and had it wrong until now. Windows-on-ARM runs the x64 binary
  under emulation, so there is deliberately no `win32-arm64` package. The
  `puzzle dev` single-key shortcuts stay Unix-only and are simply absent there;
  Ctrl-C still stops the server.

**Changed:**

- A route's `view`/`layout` is validated when the route table compiles (D163):
  it must be a `PuzzleView` subclass or a `lazy()` marker, and a bare loader
  function gets its own message steering to `lazy()`. A value that is neither
  used to fail later, at construction on first navigation; it now fails from
  the `Router` constructor.

**Fixed — data layer:**

- A payload key naming a model **method** no longer shadows it; schema entries
  named after a model method throw at Store registration in development.
- `date()` fields hydrated from JSON are revived as `Date`s, so one
  server-supplied date string stops making every later `save()` reject.
  Date-only fields round-trip as `YYYY-MM-DD` through a `CalendarDate`
  subclass, which is what stops a calendar date saving as the previous day east
  of UTC.
- `update()` with a reserved key applies the rest of the patch instead of
  throwing mid-loop and half-applying the record.
- A tracked `findOne` honors collection completeness — a known-absent id is a
  local `null`, not a detail GET.
- An app-wide `adapter.defaults()` can no longer fault a purely local model;
  the fault path gates on the model's own declared verb or endpoint.
- Fixture mock responses normalize like real ones, and a mocked non-OK response
  rejects a custom `delete` instead of passing silently.

**Fixed — views and router:**

- A first render that throws mid-mount releases everything it built —
  subscriptions, outside-listeners, refs, portal content — the same bracketing
  a failed patch has had since D145.
- A render throw on a reused view's prepared commit reports through the
  `errorView` funnel instead of rejecting `push()` raw with the URL moved and
  the DOM unchanged.
- A component retry no longer blanks its position when the owner's own `data()`
  also fails.
- `viewWillHide()`/`viewDidHide()` fire on animation-less component removal, and
  a view restored from a failed navigation fires its show bracket. Hooks are
  lifecycle, not animation callbacks (D28).
- Changing `island` across conditional branches replaces the element, because
  ownership is part of node identity (D44).
- `this.params`/`this.route` after an `await` report the destination again — the
  committed-scope fence restores the invariant rather than the scope it
  captured.
- A `.then`-style `data()` can no longer contaminate a concurrent evaluation;
  development warns once per class to declare `data()` as `async`.
- Path routing populates `route.hash`, stops pushing duplicate entries for a
  byte-identical URL, and ignores same-document fragment pops — a bare
  `<a href="#faq">` no longer re-runs every ancestor's `data()`.
- `date(null)`, `timeago(null)`, and `in_timezone(null)` render empty instead of
  the epoch.

**Fixed — compiler, prerender, and CLI:**

- Multi-line `{#raw}` no longer trips the single-root gates in `{#for}` bodies,
  component template roots, or skeleton roots, and `{#raw}` body bytes survive
  the template whitespace policy.
- Framework grammar attributes on an inlined `{#svg}` asset root (`key`, `ref`,
  `island`, `flip`, `@…`) are emitted as authored literals rather than wired up.
- The script-collision scan understands TypeScript `import type` clauses, inline
  `type` specifiers, and comments inside import clauses.
- `puzzle init --template todos` renders again: the starter declares no server
  and seeds its store in `beforeMount`, so a fresh app works on the first
  `npm run dev`.
- Prerender fails an app-relative endpoint with a diagnostic naming the route,
  the URL, and both fixes, instead of Node's raw `TypeError: Failed to parse
  URL`.
- `types/ssg.d.ts` carries the `readState` field on `PrerenderedPage` and
  `injectStaticShell`.
- `PuzzleErrorInfo` gains the emitted `'unmount'` phase, with the full
  twelve-phase list pinned in the type tests.
- `puzzle upgrade` resolves the install it is upgrading from the running
  executable (D76), asserts a global install against `npm`/`pnpm root -g` rather
  than falling through to one, refuses a workspace root by name, and matches
  pnpm's global root by shape instead of any path segment named `pnpm`.
- The import scan can no longer spin `puzzle build` forever on a NUL byte.
- The darwin CLI binaries carry an `LC_UUID` load command; the build floor is
  Go 1.24.

Sizes grew with the settle loop, again with `lazy()`, and a little with
snippets: **21.4 KB gzip for hello-world and 24.4 KB for todos**, against
19.6 / 22.7 in 0.6.0. The README banner was regenerated at close-out and now
matches those figures, so `release:prep`'s size check passes.

## Upgrade notes

Three breaks, all in D161, and all confined to apps that pass the `/adapter`
capability. A local-first app — no capability, no endpoint, no read verb — is
untouched.

- **`loadAll` is `loadMany` everywhere.** `store.loadAll`, the model's
  `static adapter` key, `adapter.defaults({ loadAll })`, and
  `store.adapter(type).loadAll` all reject the old spelling by name. Deliberately
  not aliased: a silent fallback to generated REST would hit different URLs than
  the adapter you wrote. `AdapterLoadAllOptions` is `AdapterLoadManyOptions`.
- **Generated read failures are `PuzzleAdapterError`.** Match on
  `err instanceof PuzzleAdapterError` and `err.status`, not on the old message
  string. Import it from `@magic-spells/puzzle/adapter`.
- **Some reads that used to be local now issue requests.** This is the quiet
  one. A `findOne` for an id the store did not hold used to return `null`
  forever; inside `data()` it now fetches, and returns `null` only when the
  server 404s. `data()` runs more than once per navigation, so it must be a pure
  derivation. A mount-time seed still works and is now redundant — delete it at
  your convenience.
- **A prerendered app fetches at BUILD time.** `output: 'hybrid'` and
  `output: 'static'` run the settle loop in Node, where there is no page origin,
  so a read has two answerable shapes: an absolute `apiURL` the build machine
  can reach, or a model with no `endpoint` and no read verb plus a store seeded
  in `beforeMount({ store })`. An app-relative read is neither and fails the
  build with a diagnostic. A private API needs its credentials available to the
  build.
- **A non-`PuzzleView` value in a route `view`/`layout` now throws at boot.**
  Not a break for any working app — such a value would have failed at first
  navigation anyway — but the failure moved earlier, to the `Router`
  constructor, and a bare function is called out by name (D163).

Snippets and `puzzle check` are purely additive: no existing template or
command changes behavior, and an app that adopts neither is byte-identical
except for the shared fixes above.

## Still open before ship

The matching `@magic-spells/puzzle-pieces` 0.7.0 publish (version-locked — it
must land at or before the CLI release), `release:prep`, and the remaining
release-checklist items on this card's close-out note: the editor grammars
(vscode/sublime/zed) gaining the `Snippet` marker, and the site's llms.txt +
playground go-live with a re-vendored skill file. The prose sweep is done —
the CHANGELOG's 0.7.0 section is complete, `DOC-RELEASE-SURFACE` describes the
0.7.0 surface, the SPEC carries §63 (`puzzle check`) and §64 (snippets), and
the README size banner is current by measurement.
