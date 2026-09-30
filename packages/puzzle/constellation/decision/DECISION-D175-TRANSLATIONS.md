---
name: >-
  D175 — Translations: t(key, vars), one build-filled hashed locale file per language, loaded before
  first render
status: built
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - COMPONENT-FORMATTERS
  - DOC-SPEC-TEMPLATE
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-ANATOMY
  - DOC-SPEC-BUILD
  - DOC-SPEC-ROUTER
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - FLOW-NAVIGATION
  - COMPONENT-SSG
  - COMPONENT-TESTING
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - FLOW-BUILD
  - FILE-CONFIG
  - FILE-STATIC-MOUNT
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - DECISION-D79-LINK-FUNCTION
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D160-SPA-CODE-SPLITTING
---

# D175 — Translations: `t(key, vars)`, one locale file per language

`t` is a standard function ([[DECISION-D174-STANDARD-FORMATTERS]]) with one
meaning in both hosts ([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]). PuzzleKit
side is built: locale files, build output, loading, runtime API. Sites
already has a flat-file `t` (lookup, `en` fallback, key-on-miss, single-pass
substitution) and must adopt the rest (see *Sites, pending*).

## Forces

- **Bytes.** No `i18n` config → zero bytes, bundles byte-identical. With it,
  ~1.3 KB gzip (measured on `examples/i18n`), not a 10+ KB library.
- **No flash.** First render is in the right language, or (prerendered
  output only) the default language with one swap after load.
- **The compiler never parses `<script>`**, so only template literals are
  visible to key analysis.
- **Splitting is off by default and forced off in static mode**
  ([[DECISION-D160-SPA-CODE-SPLITTING]]), so locale data cannot be `import()`
  chunks.

## `t` semantics (both hosts)

- **Lookup**: active locale, then default locale, then the key itself
  (visible, never blank). PuzzleKit fills the default at build time, so the
  runtime table is already complete; a miss warns once per key and locale in
  dev with a did-you-mean.
- **Key**: missing (`null`/`undefined`) prints nothing; a string is looked up
  as written; a number or boolean converts to string (runtime keys work:
  `t('status.' + order.status)`). An object, list or function is no key —
  prints nothing, dev warning "t() takes the key first, as a string".
- **Variables**: `{name}` placeholders fill in one left-to-right pass
  (inserted text is never re-substituted). The name is the exact text between
  braces (no trimming). A name absent from vars stays visible (`{name}`); a
  present name with a missing value prints nothing; values print by D173 V6;
  an unclosed `{` is literal. Vars are any object (inline literal, data
  field, store record); names are read from the object or its class chain
  (computed getters, relationships), never `Object.prototype`, so
  `{constructor}` stays literal. Non-object vars are ignored with a dev
  warning. `t` works in every expression position.
- **Plurals (Shopify model).** With `count` in vars, an entry may be an object
  of CLDR categories (`zero one two few many other`):
  `{ "item_count": { "one": "{count} item", "other": "{count} items" } }`.
  PuzzleKit selects with `Intl.PluralRules(locale)` (cached per locale);
  Sites with `golang.org/x/text/feature/plural`. A missing category falls
  back to `other`. **An exact `count` of 0 uses `zero` when the entry has
  one, in every locale** (Rails/Shopify rule; never contradicts CLDR). A
  plural entry without `count` renders `other` with a dev warning; a string
  entry with `count` just substitutes.
- **`{count}` is locale-formatted** when a finite number (same helper as
  `pluralize` and `number_with_delimiter`); other vars print by V6.
- **Output is text**; a translation never injects markup.
- `pluralize` stays D174's simple helper; translated apps use `t` + `count`.
- Conformance rows in `functions.json` pin lookup, fallback, missing key,
  single-pass substitution, unknown placeholder, en `one`/`other`, `pl`
  `few`, missing-category fallback, `zero` at 0, and `{count}` in `en`.

## Locale files

`app/locales/<locale>.json`, file name a BCP 47 tag (`en`, `pt-BR`); a `_`
name is a build error suggesting `-`. Tags (config and file names) are
validated by one function, `config.ValidLocaleTag`: 2–3 letter language,
optional 4-letter script, optional 2-letter or 3-digit region, then
non-repeated variants (5–8 alphanumerics, or digit + 3) — a subset of what
`Intl` accepts, because the runtime hands tags straight to `Intl`
(`zh-Hant-TW`, `es-419`, `de-DE-1996` pass; `en-12`, `en-US-US`, `fr-x`
fail, naming the subtag).

- **Nesting flattens to dotted keys**; flat dotted keys are valid too.
- **An object whose keys are all CLDR category names is a plural entry** and
  must have `other` (build error otherwise); any other object is a namespace.
- Values must be strings, namespaces or plural entries; anything else is a
  build error positioned by key path, as is a flatten collision (`"a.b"`
  beside `"a": { "b": … }`). An empty object is a warning.

## Config

`puzzle.config.js`: `i18n: { locales: ['en', 'es'], defaultLocale: 'en' }`
(`defaultLocale`, not the reserved word `default`; Next.js shape).
`locales` must include `defaultLocale`; every listed locale needs a file; an
unlisted file is not emitted (warning). `__PUZZLE_HAS_I18N__` is a config
fact, not a usage-scan fact (script code can call `t` invisibly). The runtime
reads everything from the manifest; `PuzzleApp` config does not repeat it.

## Build output (`compiler/internal/locales`)

The compiler owns locale files end to end; the runtime never parses nested
files or merges locales.

1. Load, validate, flatten (plural entries stay objects).
2. **Fill fallback at build time**: default-locale keys missing elsewhere are
   copied in with one warning per locale (`es: 3 keys missing, filled from en
   (…)`); keys only in a non-default locale warn too.
3. **Keep every key** (no pruning).
4. Emit `dist/locales/<locale>.<hash>.json`, minified with sorted keys; hash =
   sha256 → base32, first 8 chars (D160 chunk shape). `locales/` is a
   reserved output name while `i18n` is on (`ValidatePublic`).
5. **Manifest virtual module** `@magic-spells/puzzle/i18n/manifest`
   (`compiler/internal/plugin/manifest.go`, fresh every rebuild), like D31's
   function manifest: `{ defaultLocale, locales: { en: 'locales/en.<hash>.json' }, base }`,
   locales in config order. The package `exports` default resolves to
   `null` for vitest and other bundlers. Reuses an existing exclusion, so
   D89's ceiling of three holds.
6. The usage scan checks every literal `t('…')` key (cooked) against the
   default table — warning when missing. Runtime-built keys are unchecked.
7. `t` without `i18n`, or `app/locales/` without config, warns ("unless the
   app registers its own t formatter" — the compiler can't read `app.js`).

**Dev watch.** SPA: a locale class in `build/watch.go` re-emits files,
refreshes the manifest, rebuilds, reloads; superseded hashed files are pruned
by diffing its own outputs. Static: a locale file is render-wide in
`watch_static.go`/`route_deps.go` (read from disk, never imported — the same
one-off edge as `{#svg}` in [[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]),
riding [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]].

**Gotcha — manifest `base`.** Hash/memory apps resolve locale URLs next to
the entry module: `locales.Manifest.JS()` emits an expression reading the
module's own `import.meta.url`, stepping up one folder when it was bundled
into `chunks/<name>-<8 base32>.js`. That depends on the chunk naming every
splitting pass uses (`build/options.go` ChunkNames, the static-pages pass);
change it and `chunkFilePattern` in `locales.go` must follow.
`TestManifestBaseIsTheEntryFolder` pins it.

## Runtime API (`client-runtime/i18n.js`)

- **One service, `i18n`**, on `this.ctx.i18n` and `app.i18n` (only when
  configured; the per-view derived ctx inherits via `Object.create`). It has
  `t(key, vars?)`, `locale`, `locales`, `defaultLocale`, and
  `setLocale(tag)` → promise.
- **Template `t` is service-bound**: `installTranslate(registry, i18n)`
  registers it right after `makeFormatterRegistry` (so `formatters.js` never
  imports i18n) unless the app registered its own `t`, which wins with D174's
  shadow warning.
- **No `this.t()` on views**: it would add a method to every view class,
  collide with user methods, and duplicate `ctx`; templates never reach the
  instance anyway (D176).
- **`<html lang>`** tracks the active locale on load and every switch —
  except memory routing (no document side effects; also `/testing`'s
  `createTestApp`).
- Static kernel and `/testing` ctx carry the service; `/testing` takes
  `i18n: { locale, strings }` (one table, both active and default).
  `PuzzleApp`/`mountStatic` accept an internal `__i18n`
  (`{ manifest, tables, locale }`) seam — not public config.
- **Typing**: `puzzle check` types `t(key: unknown, vars?: object | null):
  string` (any object, including interfaces and class instances);
  `types/index.d.ts` declares `PuzzleI18n` and optional `ctx.i18n`/`app.i18n`.

## Locale selection

At startup: (1) `localStorage['__puzzleLocale']` (try/catch) if still
configured; (2) each `navigator.languages` tag in order — exact
(case-insensitive), then base language (`es-CO` → `es`), then the first
configured tag with that base (`pt` → `pt-BR`); (3) `defaultLocale`.
Prerender always uses `defaultLocale`.

`setLocale(tag)`:

- Unconfigured tag → `RangeError` naming the configured locales (every build).
- Fetch first; only then do table, `locale`, format locale and `<html lang>`
  switch together, the choice is stored, and the app rebuilds once. A failed
  fetch rejects and changes nothing.
- **Last-wins via a token.** An overtaken call settles with the later call's
  outcome (never reports a switch that didn't happen); an overtaken call
  whose own fetch failed rejects with its own error.
- Before the first commit (e.g. in `beforeMount`) it replaces the pending
  startup load and refreshes nothing.
- The active locale again is a no-op (still overtakes an in-flight switch),
  except after a failed rebuild into it, when it retries. The no-op test is
  `match === locale && table && !stale`; `stale` is keyed on the locale
  (set when a refresh rejects while its locale is active), not the token.

## Loading and switching

- **The first render has its strings.** `mount()` picks the locale and starts
  loading while services wire (overlapping `beforeMount`), and awaits it
  after `beforeMount`, before HMR restore and `router.start()`. Navigation
  zero never runs without the table; a `t` before that prints the key with a
  dev warning.
- **Island first**: a prerendered page's table is used when it matches the
  active locale; otherwise fetch `manifest.locales[active]`. A failed load
  falls back once to the default locale; if that fails, `mount()` rejects
  through the `beforeMount` teardown.
- **A switch is a same-location rebuild** (`router.__failedView(null, true)`
  with a module-private `REBUILD` marker as `retryView` — no new class
  method, since esbuild never drops class members): re-run the committed
  path with keep = 0 in replace mode — every routed view and layout fresh,
  `data()` re-run, one-swap commit; no history entry, no enter/exit
  animations (nested components mount fresh and may animate), scroll and
  focus untouched. Same path as the errorView retry
  ([[DECISION-D145-ERROR-BOUNDARIES]]). Store records survive; `setData`
  state does not (state that must survive belongs in the store).
- **A navigation in flight wins.** If a push, `replace()`, pop, `go()` or an
  earlier rebuild is loading (`#pendingNavPromise`, filled via `#trackNav`),
  the rebuild schedules `pending.then(again, again)` and `setLocale` resolves
  once the strings are active — it must not wait, because the switch may come
  from inside that navigation (a layout `data()` or guard awaiting
  `setLocale(user.locale)`) and would wait on itself. The rebuild re-runs that
  `data()`, whose repeat `setLocale` is a no-op, so it rebuilds once. A
  rebuild is itself a navigation in flight.
- **A failed rebuild** (`data()` throws → `onError`) keeps the old page with
  the new locale active and rejects `setLocale`; calling again retries. A
  rebuild queued behind a navigation reports only via `onError`.
- **Static kernel remount** (`static/index.js` `armRemount`): re-assembles
  the chain and runs `preloadTakeoverComponents`, so nested components are
  constructed, preloaded and `skipEnter()`ed before the swap; the old root
  stays until the new `mount(…, { preloaded: true })` resolves. A throwing
  mount restores the old DOM and rejects with the new locale active. An
  overtaken remount destroys its routed and nested instances.
  (`tests/static-locale-remount.test.js`)
- **URLs.** Manifest paths are relative to the dist root. Path mode resolves
  against normalized `routerBase`; hash/memory modes against the manifest's
  `base` (so a script-embedded widget served from elsewhere finds its files);
  no `base` (tests, other bundlers) → document URL; the static kernel uses
  its stub's base.

## Function locale (`client-runtime/formatters/locale.js`)

With `i18n`, the active locale replaces the browser default in `date`,
`time`, `datetime`, `number_with_delimiter`, `compact_number`, the
`pluralize` count and `timeago`. An explicit `locale` argument still wins.
`setFormatLocale(tag)` (called only by the service) clears `localeNumber`'s
per-digit cache; `compact_number`/`timeago` rebuild their single-slot
formatter when the slot moves. Every read sits behind the inline
`__PUZZLE_HAS_I18N__` probe. A tag `Intl` rejects never throws mid-render:
`setFormatLocale` checks it with `Intl.getCanonicalLocales` and stores
`undefined` on failure; plural selection falls back to the viewer's rules.
The slot is per page (two apps on one page share it; last switch wins —
accepted). Prerender sets it to the default locale. **`currency` is not
locale-aware** (D174 identical-output).

## Static and hybrid output

- Pages prerender in `defaultLocale` from the staged default table (no
  fetch); the build rewrites the shell's `<html lang>`.
- **Every prerendered page carries the table** as
  `<script type="application/json" data-puzzle-locale="en">` via
  `escapeScriptJson` ([[DECISION-D113-SSG-RAWTEXT-RULE]]) at the last
  `</body>` with the data island ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]).
  Static `prerender: false` pages carry it; a hybrid `prerender: false` page
  is the verbatim shell and fetches.
- A viewer in another locale sees the default language first, then one swap
  (hybrid: before navigation zero; static: before the kernel mount).
- Plain SPA fetches the active file during `mount()`.

## Diagnostics

Build errors: configured locale without file; `defaultLocale` not in
`locales`; invalid JSON; wrong value type; plural entry without `other`;
flatten collision; `_` in a file name; invalid tag. Build warnings: filled
keys; non-default-only keys; empty objects; missing literal key; `t` without
`i18n`; `app/locales/` without `i18n`; unlisted file. Dev warnings (warn-once,
`__PUZZLE_DEV__`): missing key; `t` before strings loaded; non-string key;
plural without `count`; non-object vars; the D43 hint "t() needs
translations".

## Future work (not built)

- **Locale URL prefixes** — recorded design: `i18n: { routing: 'prefix' }`,
  default locale unprefixed, each page prerendered per locale into
  `dist/<locale>/…`, URL locale beats storage/navigator, `link` prefixes,
  `setLocale` navigates, head gains `hreflang` alternates (build-time, D84).
- Translated route `meta.title` (needs a [[DECISION-D84-HEAD-MANAGEMENT]]
  amendment, e.g. `meta: { title: { t: 'products.title' } }`).
- Rich-text translations (a link inside a sentence); key-union types for
  `puzzle check`; `dir="rtl"`; per-route string splitting; SPA preload hint.

## Sites, pending

Call spelling `t(key, vars)` with the same key rule; plural entries via
`x/text/feature/plural` with the `zero` rule and `other` fallbacks; `{count}`
in the site locale's number format; nested files flattened with the same
errors (`readLocales` in `engine/theme/compile.go` stops requiring a flat
map); non-map vars warn instead of erroring; inherited-field names, never the
prototype; the shared `t` conformance rows.

## Alternatives rejected

- **Runtime fallback** (fetch/merge default at lookup) — two downloads or a
  merge per miss; build-time fill does it once with an actionable warning.
- **Pruning unused keys** — script-side and runtime-built keys would vanish
  silently; costs locale-file bytes only, never `app.js`. Revisit only with
  an explicit keep-list.
- **Locales as `import()` chunks / inlined in `app.js`** — splitting is off by
  default and in static mode, and every viewer would download every language.
- **i18next / FormatJS / ICU MessageFormat** — 10+ KB, a message syntax Sites
  can't share, a runtime parser; `Intl.PluralRules`/`NumberFormat` do the
  hard part. Apps needing ICU `select` can register their own `t`.
- **Locale config in `PuzzleApp`** — the compiler must know locales and can't
  read `app.js`.
- **Refresh in place instead of rebuild** — needs a production live-view
  registry, misses D170-skipped components and `data()`-computed strings.
- **Flat files only** — plural entries force object parsing in Sites anyway.
- **Strict CLDR `zero`** — forces an `{#if count === 0}` around every English
  empty-state message.
- **Locale URL prefixes now** — touches routing, prerender, `link`, redirects
  and head; a release of its own.
