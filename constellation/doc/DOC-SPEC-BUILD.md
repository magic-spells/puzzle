---
name: SPEC — build, output modes, dev loop, and tooling
kind: reference
status: built
connections:
  - DOC-SPEC
  - COMPONENT-COMPILER-CLI
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - COMPONENT-DEVSTATE
verified_at: '2026-07-25T05:53:23.935Z'
verified_sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
notes:
  - kind: verified
    text: >-
      Sections moved byte-for-byte from DOC-SPEC (scripted split, verified by SHA-identical section
      census); §N numbers unchanged
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
---

The frozen v1 contract for the toolchain: the CLI surface, dev HMR and build-error reporting, the `hybrid`/`static` output modes, update notification and `puzzle upgrade`, interactive `puzzle init`, the `/testing` utilities, the `--fixtures` switch, and the DevTools bridge. See [[DOC-SPEC]] for the section index and the rest of the contract.

## 13. CLI tooling (v1.4)

The scaffolding and diagnostics commands SPEC §11 left for later. Shipped in v1.4 (D32); the CLI is no longer just `dev` + `build`. Additive — no change to `dev`/`build`, the compiler, or the runtime.

- **`puzzle init <app-name> [--template default|todos] [--dir <parent>]`** — scaffolds a complete Tailwind-first app (`app/` source with `app/app.js` entry, `puzzle.config.js`, `index.html`) from an embedded template tree. `default` is a minimal starter; `todos` is the todos example app. **Non-interactive by design** — flags and defaults only, so it stays scriptable (CI, `npx`); the one exception (D32 amendment) is a bare `puzzle init` on a TTY, which prompts for the missing app name (zero args on a non-TTY still errors, so pipes/CI never hang). *(v1.44/D77 widens the TTY exception: template and TypeScript prompts when those flags are absent — see §42; non-TTY behavior is unchanged.)* App names are validated npm-safe; a non-empty target directory is refused.
- **`puzzle generate <component|view|layout|model> <Name> [--path <dir>] [--force]`** (alias `g`) — writes a stub into `app/components|views|layouts|models`, finding the project root by walking up for `package.json`/`puzzle.config.js`. `.pzl` type names are PascalCase, model names lowercase.
- **`puzzle add tailwind`** — writes the canonical `puzzle.config.js` + `app/styles/styles.css` when absent.
- **`puzzle add piece <name…> [--registry <path|url>] [--overwrite] [--dir]`** (D32 amendment, 2026-07-17) — copies copy-in UI pieces from the puzzle-pieces registry into the app: resolves `registry.json`, pulls `registryDependencies` transitively (piece names and `lib/*.js` utils), copies files VERBATIM to each manifest's `targetDir` (default `app/components/ui/`; libs to `app/lib/`), refuses existing files unless `--overwrite` (all-or-nothing pre-flight), records sha256 content hashes in `pieces.lock` (the version story — enables a future `diff`/`update`), auto-copies the registry theme to `app/styles/pieces.css` when the app lacks it (locked like a piece), and PRINTS the accumulated `npm install` line + the one-line `@import './pieces.css';` advisory rather than running/rewriting anything (styles.css is user-owned — D3). Registry source: `--registry` flag → `PUZZLE_PIECES_REGISTRY` env → the published GitHub raw URL.
- **`puzzle add skills [--overwrite]`** (alias `skill`; D78, 2026-07-22) — installs the CLI's embedded Puzzle agent skill (`skills/puzzle/` in-repo, `go:embed` at build time so the payload always matches the CLI version) into every detected agent config dir: a target is offered iff `~/.claude` / `~/.codex` / `~/.cursor` exists, destination `<root>/skills/puzzle/` (created as needed). On a TTY: huh checkbox multi-select, all targets pre-selected; non-TTY installs to all detected targets silently (never prompts, never hangs). No detected targets is a friendly no-op, exit 0. `--skill-root <dir>` (repeatable; D97, 2026-07-24) pins the config dirs instead of detecting them and skips the target prompt even on a TTY — the root must already exist (a missing one is an error, never created). `puzzle upgrade` uses it to hand the freshly installed binary the exact roots the user confirmed (§41).

  **Existing destinations (D99, 2026-07-24)** — re-running the command after a CLI upgrade IS the refresh mechanism (the payload is embedded), so an existing install asks rather than aborting. Every install writes `<dest>/.puzzle-skill-version` holding the CLI version; missing or blank reads as *unknown*, never an error. Selected targets classify four ways: **missing** → installed; **stamp matches this CLI** → skipped as up to date; **real but stale/unstamped** → a huh yes/no confirm (default yes) whose lines name the version delta; **symlink** → one `!` line, never offered and never written through (a dev-checkout link, per §41). Declining skips only the conflicts — targets with no skill are still installed, since the pre-flight was all-or-nothing only because it produced an *error*. On a **non-TTY a stale destination still refuses** with the `--overwrite` message and writes nothing; an up-to-date one is no longer a conflict, so `puzzle add skills` is idempotent in CI. `--overwrite` bypasses the whole classification and writes every selected target, symlinks included. Reinstalling **replaces** the destination tree (removed, then copied) so a file the newer payload dropped cannot linger and contradict the current release — except through a symlink, which is written through in place because `os.RemoveAll` on a link deletes the link itself.
- **`puzzle upgrade skills`** (D99, 2026-07-24) — refreshes the agent skill from THIS binary's embedded payload: no registry check, no re-exec, since nothing was upgraded and the running CLI already holds the matching bytes (the mirror image of §41's post-upgrade path, which must re-exec precisely because its process holds the OLD skill). Refreshes only config dirs that already carry a skill — first installs belong to `add skills` — reports and skips symlinked ones, and prints the `--overwrite` hint when everything is already current. Unlike `add skills`, a **non-TTY installs without prompting**: the command names the clobber, so it is the request rather than a side effect.
- **`puzzle doctor [dir]`** — ✓/✘/! checks (node on PATH, `app/app.js`, `index.html`, config loads, Tailwind CLI resolves, runtime package present); exits 1 on any failure. **`puzzle info [dir]`** — prints puzzle version, platform, node version, project root, source/output dirs, and the declared styles pipeline. `puzzle --version` reports the CLI version.

**No-JS-rewriting rule (D3).** `add` and `generate` never parse or rewrite the user's JavaScript: `generate model` does not edit `app/models/index.js`, and `add tailwind` never rewrites an existing `puzzle.config.js`. When wiring is needed they **print the exact snippet** (registration line / config block + install command) for the author to paste. Generated `.pzl` stubs are compile-checked against the compiler in tests, so they cannot drift from the grammar.

## 27. Dev HMR: state-preserving reload (v1.25)

`puzzle dev`'s live reload preserves app state across rebuilds. Shipped in v1.25 (D57); dev server client + runtime dev hooks, **zero production cost** (the `__PUZZLE_DEV__` build define is `false` in production builds and every guarded branch is minified away). Editing a `.pzl` mid-flow — modal open, form half-filled, deep in a nested route — no longer resets the app.

- **Mechanism: reload + transplant, not module swap.** Every rebuild still runs the fresh full bundle via `location.reload()` (no stale closures, no partial module graphs). Immediately before reloading, the injected SSE client calls the dev-published `window.__PUZZLE_APP__.__devSnapshot()`, which writes a one-shot `sessionStorage` blob (`__puzzleHMR`); the freshly booted app restores it **in two phases (§35)**: the store transplants after `beforeMount` but **before navigation #0** (so the initial route's `data()` queries see the restored records on first paint — restoring after `start()`, as v1.25 did, left store-derived views empty until the next mutation), then view-local state restores once the chain has mounted.
- **What survives:** store contents (serialized in the `_persist()` wire shape, hydrated validation-exempt and — since §35 — in identity-preserving **replace mode**, so the snapshot wins over user-configured `storage` on pk conflicts while subscribers' record references stay valid), every mounted view's **local layer only** (`setData` + `created()`-seeded state, filtered through a conservative JSON-safe walk — functions and DOM nodes are dropped; since the §35 two-layer split, `data()`-derived model values are deliberately *not* snapshotted and are recomputed against the transplanted store), the route (the URL itself), and scroll (§14/v1.10 already persists it).
- **View-state identity:** `${class name}:${per-class mount index}` — deterministic across the reload because the same URL mounts the same chain in the same order. A mismatch simply cold-starts that view (fail-soft).
- **The edited component's state survives too** (restore-all — keeping a form's state while editing that form's template is the point); a shape mismatch self-heals on the next edit.
- **Bounds:** the blob is one-shot (deleted on read) and expires after ~10s, so a manual F5 cold-starts; memory mode is exempt; focus/text-selection are lost across the reload; DOM islands (§17) re-seed. Every restore step is fail-soft — corrupt blob, missing view, storage error → cold start, never a crash.

## 36. Static output — `output: 'hybrid' | 'static'` (v1.33; amended v1.47/D81)

An additive build OUTPUT mode that prerenders every static route to its own HTML file. It amends D1's scope, not its architecture: there is still no SSR server and no hydration protocol, and the Go parser/codegen are untouched (compiled `.pzl` output was already environment-agnostic ViewNode-tree data). **D81 splits this into two output modes** that share one serializer, one prerender orchestrator, and one chain assembler (`client-runtime/ssg/assemble.js`):

- **`hybrid`** (D67, formerly spelled `static` — behavior byte-identical): prerendered pages **plus** the shared `/app.js` SPA bundle; the browser runtime replaces the prerendered DOM at navigation #0 and the site is the same SPA thereafter (morph, transitions, routing unchanged after takeover).
- **`static`** (D81): a **true static site** — prerendered pages with **no router, no SPA takeover, and no history API** in the output. Navigation is plain `<a>` page loads and `dist/` contains no `app.js`; each page ships a small per-page module that mounts only its own components.

**Activation:** `puzzle build --static` / `--hybrid`, or `output: 'static'` / `'hybrid'` in `puzzle.config.js` (those are the only two legal values; anything else is a config error). The two flags are mutually exclusive, and a flag disagreeing with the config value is an error. Either flag or config key is sufficient. `puzzle dev` and a plain `puzzle build` (no `output`) are unchanged (SPA).

**Shared prerender pipeline:** after the normal bundle + Tailwind + `public/` copy into the staging dir, the CLI bundles a second node-platform entry (same `.pzl` plugin, `__PUZZLE_DEV__=false`) that imports the app's **default-exported PuzzleApp** from `app/app.js` (required convention: `export default app`) plus `@magic-spells/puzzle/ssg`, and runs it under `node` once (with the mode passed through). A prerender failure fails the build; the staging swap guarantees the last good `dist/` is untouched. The summary (pages written, skipped routes, warnings) rides a stdout JSON sentinel (`__PUZZLE_SSG_JSON__`), same pattern as the config loader.

**Per-route output** is directory-style in both modes: `/` → `dist/index.html`, `/components/badge` → `dist/components/badge/index.html`. Each page is the `public/index.html` shell with the rendered markup injected into the (required, empty, `#id`-form `config.target`) element and the first `<title>` replaced by the route's `meta.title` (nearest-defined leaf → root; shell title kept when absent). Pages link absolute paths, so they work at any depth.

**Render semantics** (`client-runtime/ssg/`, both modes): each route's layout + view chain is instantiated and loaded via `preload()` — `created()` + awaited `data()`, with `this.route` populated — so **no `mounted()`, no animations, no DOM runs at build time**; `data()` executes once per page under Node (global `fetch` serves adapters; browser globals in module scope must be guarded). `render()` always, never `renderSkeleton()`. The serializer mirrors the ViewManager byte-for-byte where it matters: slot expansion is the SAME `expandSlots`, `@event`/`key`/`island` attrs are dropped, boolean props emit bare attrs, `{#svg}` island seeds emit verbatim, scoped-style `data-<scopeId>` stamps pass through. Principled difference: `value` serializes as an attribute (pre-JS display) where the browser assigns a property. Second principled difference (D113): `<script>`/`<style>` are RAWTEXT — their text is **not** entity-escaped, because the HTML parser never entity-decodes it. JSON-typed scripts (`type` of `application/json` or any `+json` suffix) emit with `<` escaped to `\u003c` — the same JSON-transparent, breakout-proof rule as the static data island; all other script/style content emits raw, and the build **fails** if it contains `</script`/`</style` (case-insensitive) or the `<!--` + `<script` double-escaped pair, since the parser would end (or refuse to end) the element mid-content. `config.beforeMount` is awaited once with a `{ store, config }` facade — **build-time only in both modes** (the Astro-frontmatter policy).

**Hybrid takeover contract (router):** the target is stamped `data-puzzle-ssg` and pages link the shared `/app.js` + `/styles.css`. On navigation #0, a mount container carrying `data-puzzle-ssg` is cleared (`replaceChildren`), the marker removed, and the incoming top view's enter animation suppressed (`skipEnter()`) — the swap happens inside the commit window after the data gate, with identical markup, so there is no flash and no duplication. Containers without the marker behave byte-identically to v1.32.

**Static contract (per-page modules, D81):** the target is stamped `data-puzzle-static` (never taken over by a router). Codegen stamps every compiled class with `Class.__pzlModule` (its app-root-relative source path); the build (`compiler/internal/build/prerender_pages.go`) generates one per-page ES module `dist/_puzzle/<slug>.js` (slug: `/`→`index`, `*`→`404`, else path `/`→`--`, collisions suffixed `-2`,`-3`…) importing `mountStatic` from `@magic-spells/puzzle/static` plus exactly that page's view/layout/component classes; esbuild code-splitting factors shared components + the router-free view-layer runtime into `dist/_puzzle/chunks/`. Each page's context store is serialized (`store._serializeAll()`) into an inline `<script type="application/json" data-puzzle-static-data>` island; the shell's `/app.js` tag is swapped for the page's module and `staging/app.js` is dropped. `mountStatic` wires the same build-time ctx (Store + FormatterRegistry; `ctx.router` is the D79 link stub — `url()`/`current` work so `{ path | link }` resolves, navigation methods throw), rehydrates the data island (replace mode), assembles + preloads the chain via the shared `assembleChain`, `skipEnter()`s every instance, then `replaceChildren()` + mounts over the prerendered markup — flash-free because it re-renders identically. *(Amended, D117: the stub's mode is forced to `'history'` on BOTH sides — prerender and kernel — regardless of `routerMode`, which static output ignores with a build warning: static pages are path-shaped files with no click interception, so a hash-shaped href is a dead link. `routerBase` still applies.)* `models` load from `app/models/index.js` and `formatters` from `app/formatters.js` when those files exist; formatters registered only in the app.js config warn (available at build time, missing client-side).

**Route matching amendment (all modes):** a single trailing `/` is no longer significant — `/docs/` matches the `/docs` route and a `:param` capture never swallows the slash. Static hosts serve directory URLs (`/components/badge/`), so the prerendered pages' own load paths must match their routes.

**404 (v1.34):** the top-level catch-all route (`path: '*'`, D19) renders to `dist/404.html` — the file static hosts (GitHub Pages, Netlify, Render, Cloudflare) serve for unknown paths — with the same preload/serialize/title/marker treatment as any page (`prerender: false` on its chain writes the plain shell there instead). A build with NO catch-all emits an advisory warning that unknown URLs will get the host's default 404. In `hybrid` mode the live router additionally serves this view for unmatched client paths; in `static` mode there is no client router, so the file is what serves unknown URLs. The `puzzle init` templates (default and todos) ship a `NotFound.pzl` view wired as the catch-all.

**Boundaries:** dynamic routes (`:param`, and any non-catch-all `*` pattern) are skipped with a build warning in both modes (a static build has no way to run them client-side either — dynamic content in static mode awaits `staticPaths()` or a `prerender: false` runtime-fetch island). `prerender: false` anywhere in a route chain writes the plain shell at that path — an SPA island in hybrid mode, a client-rendered island (data island + entry module, no marker) in static mode. Deferred on top: a `staticPaths()` enumeration hook, ~~a head-management API (per-route meta/og)~~ (shipping in v1.50, §45/D84), DOM-adoption hydration, a true zero-JS per-route opt-out for static mode, lazy route views + code splitting, `puzzle preview`, and flat `name.html` output as a config knob.

## 41. CLI update notification + `puzzle upgrade` (v1.43)

The CLI reports newer published releases and can upgrade itself through the user's own package manager (D76). Two surfaces: a passive one-line notice on `build`/`dev`, and an explicit `puzzle upgrade` command. npm remains the owner of installation — the binary never replaces its own files.

**Passive notice (`puzzle build`, `puzzle dev`):**
- Prints one dim line — `✨ puzzle <latest> available (current <v>) — run puzzle upgrade` — after the build summary (`build`) or the ready banner (`dev`).
- **Entirely skipped** when `CI` or `PUZZLE_NO_UPDATE_CHECK` is non-empty, or stdout is not a terminal. Piped/scripted invocations never touch the network.
- The notice is printed **from cache only**: `<os.UserCacheDir()>/puzzle/update-check.json` (`checked_at` RFC3339 + `latest`). A missing or ≥24h-old cache triggers a background fire-and-forget refresh (3s timeout) — a short-lived `build` may exit before it lands, so the notice appears on a later run. The passive path never blocks a command, never delays exit, and never surfaces network errors.
- Registry endpoint: `GET <registry>/@magic-spells/puzzle/latest` with an `application/json` Accept header — never the abbreviated `application/vnd.npm.install-v1+json` format, which npm serves for packuments only and answers with 406 on version endpoints (D80). `<registry>` defaults to `https://registry.npmjs.org`; `PUZZLE_REGISTRY` overrides it (mirrors, tests).

**`puzzle upgrade [--check]`:**
- Fetches the latest version synchronously (5s timeout; a failure here IS an error, unlike the passive path). Current ≥ latest short-circuits with `✓ … is up to date`. `--check` reports current vs latest and changes nothing.
- **Install-context detection**, in order: **project** — walk up from cwd to the first `package.json` listing `@magic-spells/puzzle` in `dependencies`/`devDependencies`; the package manager comes from that directory's lockfile (`pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `bun.lock`/`bun.lockb`→bun, else npm) and the dependency field is preserved (devDependencies → `--save-dev`/`-D`/`-d`). **Global** — no project found but the (symlink-resolved) executable lives under a `node_modules` segment: `npm install -g` (or `pnpm add -g` when the path shows a pnpm segment). **Manual/`go install`** — neither: print the `go install …@latest` instruction and exit 0.
- The exact fetched version is installed (`@magic-spells/puzzle@<latest>`, not the `latest` tag), child output streams through, and a non-zero exit propagates with the failed command named. The platform binaries follow automatically — they are exact-pinned `optionalDependencies` of the root package (§35).
- Success is **confirmed**, not assumed: the installed `node_modules/@magic-spells/puzzle/package.json` version must equal the target, then `✓ upgraded <old> → <new>` prints and the update cache is written so the passive notice does not re-fire.

**Agent-skill refresh (D97, 2026-07-24)** — reached only on that success path, never from `--check`, the up-to-date short-circuit, or the manual/`go install` branch:
- **Refresh, not first install**: a target qualifies iff `<root>/skills/puzzle/` already exists as a real directory under a detected config dir (§13). Config dirs without a skill are left to `puzzle add skills`. No qualifying target is a silent no-op.
- A **symlinked** `<root>/skills/puzzle` is a dev-checkout link: one `!` line names it and nothing is written through it.
- On a TTY: a huh yes/no confirm (default yes) listing the exact destinations. On a non-TTY: one `!` hint line naming them plus `puzzle upgrade skills` (D99; was `puzzle add skills --overwrite`), and no writes — the never-prompt/never-hang rule from §13.
- The install is performed by **re-executing the binary npm just installed**, not by this process: the skill payload is `go:embed`-ed, so the running binary holds only the OLD skill. Candidates are tried per install shape (project: `node_modules/@magic-spells/puzzle-<platform>/bin/puzzle`, then `node_modules/.bin/puzzle`; global: `PATH` lookup, then the running executable) and each must answer `--version` with **exactly** the target version before it is used. If none verifies, the manual command is printed instead — a stale skill is never installed.
- The child is invoked as `add skills --overwrite --skill-root <root>…` with the confirmed roots, so what runs matches what was asked. Nothing in this step can fail the upgrade: the package is already installed, so every error prints and exits 0.

Semver comparison is a minimal in-repo `x.y.z[-pre]` implementation (prerelease sorts before its release, dot-separated identifiers per SemVer §11) — no new Go dependencies.

## 42. Interactive `puzzle init` prompts (v1.44)

`puzzle init` prompts for the choices that were not given as flags, on a TTY only (D77). Amends §13's "non-interactive by design" clause; every other command is untouched.

- **Gate:** the same TTY check the D32 app-name prompt already uses. On a non-TTY (pipes, CI, scripts) behavior is byte-identical to v1.4: no prompts, silent defaults, and a missing app-name argument is still an error — nothing can hang.
- **Prompt order:** app name (existing, only when the argument is absent) → template → TypeScript.
- **Template prompt** — asked only when `--template` was not explicitly passed: offers the embedded template names in menu order (`default`, `todos`); empty input selects `default`; invalid input re-prompts.
- **TypeScript prompt** — asked only when `--typescript` was not explicitly passed: y/N, empty input means No; accepts y/yes/n/no case-insensitively; invalid input re-prompts.
- **Flags win:** an explicitly-passed flag is never re-asked, so `puzzle init my-app --template todos --typescript` stays fully scripted even on a TTY.
- The scaffolded output for a given (name, template, typescript) triple is unchanged — prompts only gather inputs; scaffolding semantics stay §13's.

## 50. Dev build-error reporting (v1.55)

A failed `puzzle dev` build is reported **in the browser**, not only on the terminal (D92). Dev-server only — `puzzle build` and both prerender paths are untouched, matching how `dev.proxy` is scoped.

- **Typed reload events.** The SSE channel that already drives §27's state-preserving reload now carries `reload`, `builderror`, and `clear`. Client buffers stay size-1 and non-blocking (a slow client never blocks a rebuild) but are **last-write-wins**: a newer message replaces a stale pending one, because an error arriving behind a queued reload must supersede it. Payloads are **JSON-encoded** — SSE `data:` fields cannot carry raw newlines and every real diagnostic is multi-line.
- **`builderror` is never coalesced.** The D27 reload debounce (one `.pzl` edit → esbuild rebuild + Tailwind rescan → one reload) does not apply to errors; they broadcast immediately.
- **Retained state.** The server holds the current build error and replays it to each client on connect, so refreshing or opening a new tab while the build is broken still shows the error. The SSE handler registers with the hub **before** reading the retained error, so a build transition racing a new connection can duplicate a frame but never drop one.
- **First-run shell.** When the index path would 404 **and** an error is retained (no `dist/index.html` has ever been written), the server answers **503** with a self-contained shell: the diagnostic HTML-escaped and rendered server-side, the reload client injected so the page self-heals on the next successful build, and the overlay node adopted by id by the client script so the SSE replay does not stack a second overlay. With no retained error the 404 path is byte-identical.
- **Diagnostics pass through verbatim.** Positioned `.pzl` compiler errors and esbuild messages are already the high-quality artifact; the transport does not reformat them.

## 53. App-author test utilities: `@magic-spells/puzzle/testing` (v1.58)

A fifth export subpath (D94, amended by D121) — `mountView`, `createTestApp`, `settled`, `measureRenders`, `installFakeAnimate`, `installFakeObserver`.

- **`mountView(ViewClass, opts)`** mounts one view against a detached container with the three-service ctx; the handle exposes `element`/`find`/`findAll`/`click`/`setProps`/`destroy`. **`createTestApp(config)`** runs a real app in `routerMode: 'memory'` (§15's stated purpose) so `visit(path)` drives the real load-then-commit pipeline, guards, and lifecycle.
- **`settled()`** drains to a fixed point: stores through the public idempotent `flush()`, rAF-scheduled `setData` renders, and the current last-wins `data()`/navigation promises — repeating until two microtask-stable passes add no work (two, so work created by a promise continuation is caught without depending on rAF or §31's fallback timer).
- **It is bounded** (`settled({ maxPasses })`, default 100) and **throws** on exhaustion, naming the churn sources. Unbounded, a `data()` → store-write → `data()` cycle hangs until the runner's global timeout and reports nothing.
- **`measureRenders(handle, callback)`** installs a temporary §56 performance sink, runs and awaits the callback, then awaits `settled()` before detaching in `finally`. Its deeply frozen report is `{ renders, wastedRenders, domMutations, rendersByView, causes, maxRecursiveDepth, storeNotifications }`. A render means an entry into `ViewManager.render`, not a `refresh()` call; a render is wasted only when its DOM-mutation delta is zero. The helper is assertion-library-neutral and does not mutate the supplied handle.
- **Its boundaries are contract, not omission.** `settled()` does not advance arbitrary user timers or `min-duration` holds, resolve promises `data()`/navigation never awaited, fire IntersectionObserver callbacks, or finish CSS/fire-and-forget enter animations. An outgoing animation *is* part of an awaited navigation, so that navigation stays unsettled until the test finishes or cancels it.
- The shipped module **must not import `vitest`** — a published package cannot depend on a test runner.
- `/testing` also re-exports `installFixtures` from the §52 module (v1.61, D98), so a test file needs one import for helpers *and* fixtures; the canonical pairing is `const uninstall = installFixtures({ seed })` in setup, `uninstall()` in teardown.

## 54. The `--fixtures` build switch (v1.61)

`puzzle dev --fixtures` and `puzzle build --fixtures` (D98) wire §52's module into the bundle; without the flag **nothing references it**, so exclusion holds by construction with any compiler version. (This replaces v1.59's `__PUZZLE_HAS_FIXTURES__`/`__PUZZLE_HAS_MOCK__` usage-scan defines — D96, superseded. The D89 scan mechanism itself is unchanged, but `__PUZZLE_HAS_FLIP__` is now its only define: D111 retired the managed-head half, so the scan reads only `.pzl` files.)

- The flag requires `app/fixtures.js` (or `.ts`); missing is a clear error. Its default export is §52's install config: `{ seed, mock, setup }`.
- The compiler generates a **two-module wrapper entry** under `<root>/.puzzle/` and swaps the esbuild entry point: a wiring module (`installFixtures(config)` in its body) imported **before** the real `app/app.js`. Two modules because static imports hoist — only a dependency module's body is guaranteed to run before the app entry constructs and mounts. The wrapper keeps the `dist/app.js` output name.
- `.puzzle/` is a generated dot-directory (the usage scan already prunes dot-dirs); it is removed after one-shot builds and kept for the life of a `puzzle dev` process.
- The flag is constant per process, so watch rebuilds never re-decide it — none of the define-staleness machinery applies.
- `--fixtures` with `--static`/`--hybrid` (or a config `output`) is **rejected**; prerender + fixtures interplay is deferred. A `puzzle.config.js` equivalent of the flag is also deferred — the explicit CLI switch *is* the dev-vs-real-API toggle.
- Use cases: `puzzle dev` against the real API, `puzzle dev --fixtures` against fakes, `puzzle build --fixtures` for a shareable preview with baked-in data.

## 55. The DevTools bridge and wire protocol (v1.63)

The Puzzle DevTools Chrome extension lives in its own repo
(`magic-spells/puzzle-devtools`); the framework ships only a **dev-only runtime
bridge** (D100), and this section is the contract between the two. This is NOT
the D60-rejected app-config devtools hook: there is zero config surface and
zero production bytes — the extension injects `window.__PUZZLE_DEVTOOLS_HOOK__`
at `document_start`, and the bridge registers into it when present. No hook →
every touchpoint is a no-op. Production build → the bridge does not exist
(`__PUZZLE_DEV__` DCE, pinned by the same build test as `__PUZZLE_APP__`).

**Envelope.** Every message is `{ puzzle: 1, v: <protocolVersion>, type,
payload }`. Protocol version 1. Versions are exchanged in `hello`; the
extension supports a range and must show a clear mismatch state rather than
misrender.

**Events (runtime → extension, via `hook.emit`):** `hello { protocolVersion,
frameworkVersion }` · `app-mounted` / `app-unmounted` · `view-mounted { id,
name, module }` / `view-destroyed { id }` · `flush { keys, notified }` (one
per store flush batch — rides D63's scheduling, no extra throttling) ·
`route-commit { pathname, query, params, chain, title }` (emitted in the same
post-mount pre-paint window as scroll/focus) · `perf-warning { kind, viewId,
name, detail, count }` (D122 — fired only when a §56 loop guard trips, never
per render).

There is deliberately **no per-render event**. The page hook buffers 500
messages pre-attach and the panel ring holds 200, so a render firehose would
evict the events every other panel depends on; render data is PULLED via
`snapshot:profile` while recording and not at all otherwise.

**Requests (extension → runtime, via `hook.onRequest` handler):**
`snapshot:views` (recursive `{ id, name, module, children }` tree; roots
derived by walking live views' vnode trees — never the router's private
state) · `inspect:view { id }` → `{ name, module, params, props, model,
local }` with the **model layer and `setData()` local layer reported
separately**, JSON-safe filtered · `snapshot:records { type? }` ·
`snapshot:subscriptions` (both directions, view ids; function subscribers
labeled `'fn'` — one merged bucket, no per-function identity) ·
`snapshot:route` → a JSON-safe projection `{ path, pathname, query, hash,
params, route, routes, chain, title }` — `route`/`routes` are path PATTERNS and
`chain` is the committed view NAMES, never the live entry objects ·
`edit:record { type, id, patch }` —
applied through the real `record.update()`, so §20 validation applies and a
throw returns `{ error }` · `highlight:view { id, on }` (page overlay) ·
`log:view` / `log:record` (logs the live object and binds `window.$p`) ·
`perf:start` / `perf:stop` → `{ ok: true }` · `snapshot:profile` → `{ recording,
durationMs, totals, views[], flushes[], warnings[] }` (D122).

**Additive growth.** The message set grows WITHOUT a `PROTOCOL_VERSION` bump:
unknown events fall through the extension's `receive()` default into the ring
and unknown requests fail per-call with `{ error }`, so both ends already
tolerate names they do not know. A bump forces every published app into the hard
`MISMATCH` state and blanks every panel.

**Profile aggregation lives in the bridge, not in the §56 collector**, so rows
carry the bridge's own view ids (the panel cross-links into `snapshot:views` by
them) and a recording retains no view references — otherwise a long recording
would pin every view destroyed during it.

**Identity.** View ids are session-scoped integers (WeakMap-assigned); `name`
is the compiled class name (dev builds are unminified), `module` is the
codegen `__pzlModule` stamp (app-relative `.pzl` path).

## 56. Dev-only runtime performance profiling + render assertions

Development builds instrument the render/data/Store pipeline through one
collector module (D121). Production builds contain **zero bytes** from that
module: every class-method call site uses the inline positive
`typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__` probe, module-scope
functions may use the equivalent module constant, and esbuild syntax folding
must remove every importer before tree-shaking. Undefined means enabled for
unbundled tests. No profiler state is stored on PuzzleView, ViewManager, Store,
or Router; per-view identity, counters, causes, and rolling windows live in
WeakMaps in the collector.
The canonical production artifact is also a regression oracle: both its raw
bytes and gzip byte count must remain identical to the pre-D121 build, not only
free of profiler sentinel strings.

- A render record is one entry into `ViewManager.render`. It times the owning
  view's tree build separately from diff/patch, and its mutation delta counts
  actual text/property/attribute writes plus node insert/remove/move operations.
  Delta zero means a **wasted render**. Refresh requests are not renders because
  they may coalesce.
- `data()` records wall time and sync/async shape. Component reuse records
  shallow-props bailouts versus data reruns; slot-only updates and
  `memo(key, ...)` hits/misses are attributed per view/key. Store flush records
  whole-flush time, pending-key count, and unique notified subscribers.
  Serialized async tracking records every head-of-line deferral and its wait
  time so concurrent async `data()` serialization is visible rather than folded
  into generic data latency.
- A causal token follows Store write/flush → view refresh → render → writes and
  framework work scheduled by those steps. Per-view execution depth resets only
  when that chain is quiescent. At 100 executions the view is reported and
  further work in that chain is stopped. Independently, a rolling one-second
  window reports and stops a view after at least 60 renders when at least 90%
  made zero DOM mutations and no recorded cause is animation or morph work.
  Both guards must stop framework churn rather than hang the tab.
- The development collector exposes temporary event sinks for §53's
  `measureRenders`; no test framework is imported. Production DCE is proved by a
  dev-only sentinel scan and an esbuild metafile assertion that attributes zero
  production `bytesInOutput` to `client-runtime/devperf.js`.
