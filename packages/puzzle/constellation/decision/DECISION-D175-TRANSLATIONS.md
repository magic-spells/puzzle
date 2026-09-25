---
name: >-
  D175 — Translations: the `t` formatter joins the standard set; one build-filled, hashed locale
  file per language, loaded before the first render
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
  - DECISION-D79-LINK-FORMATTER
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D160-SPA-CODE-SPLITTING
notes:
  - kind: deviation
    text: >-
      Where the card did not pin a detail, the build took the smallest consistent choice: (1) The
      define is read from the plugin (`pl.I18nEnabled()` in `build/options.go`), set by `SetI18n`
      from the config, not threaded as a separate bundle flag — same effect on every pass. (2) The
      rebuild entry is `router.__failedView(null, true)` with a module-private `REBUILD` marker
      passed as `retryView`, not a new method: esbuild never drops class members, so a new method
      would ship in every app. (3) The `t` formatter is installed by `installTranslate(registry,
      i18n)` from `i18n.js` right after `makeFormatterRegistry`, not inside it, so `formatters.js`
      never imports the i18n module (zero bytes without i18n). (4) The manifest lists locales in
      config order; the hash is sha256 → base32, first 8 characters; locale files are minified with
      sorted keys. (5) `/testing`'s option is `{ locale, strings }` — one table, which is both the
      active and the default locale. (6) `PuzzleApp` and `mountStatic` take an internal `__i18n`
      config seam (`{ manifest, tables, locale }`) used by tests and `/testing`; it is not public
      config. (7) Tests are consolidated into `tests/i18n.test.js`, `tests/i18n-app.test.js` and
      `tests/i18n-ssg.test.js` instead of extending the five per-area files. (8) Nested components
      inside a rebuilt view are ordinary fresh mounts and may play their own enter animations;
      routed views and the layout skip theirs. (9) Formatter-locale caches are not keyed by locale:
      `setFormatLocale` clears `localeNumber`'s per-digit cache and `compact_number`/`timeago`
      rebuild their single-slot formatter when the slot moves — same result, and an app without i18n
      keeps its exact code. (10) The rebuild waits only for a pending PUSH (`#pendingNavPromise`); a
      replace or pop still loading when a switch lands is superseded by the rebuild. (11) The build
      cannot detect an app-registered `t` (the compiler never reads app.js), so the `t`-without-i18n
      warning says "unless the app registers its own t formatter" instead of being skipped. (12)
      Size: hello-world and todos raw bytes are identical to the base; only minified identifier and
      module order shift, moving gzip/brotli by a few bytes. The i18n cost measured on examples/i18n
      is about +1.3 KB gzip.
  - kind: state
    text: >-
      Built on feat/translations (PR #153 into release/0.8.0, rebased onto #150, #151 and #152). All
      twelve build items are in, plus the PR #153 review round: the rebuild waits for a pending
      push; a failed rebuild rejects setLocale; the `zero` form at an exact 0 (open question 4,
      adopted); variable names inherited from a model's class; `<html lang>` = defaultLocale in
      prerendered pages; an empty-object build warning; the last-`</body>` shell anchor; brace-only
      attribute keys in the missing-key scan; template-level `t({ … })` tests (D173 V8). D174
      counts: 35 standard, 24 Sites-only (6 platform-bound), 38 PuzzleKit. The six open questions
      are decided as recorded under Consequences.
---

# D175 — Translations: `'key' | t`, one locale file per language

Decided with Cory on 2026-09-25 and built for 0.8.0 (PR #153). The build list
at the end is the implementation order it followed. Every open question is
decided; the answers are under Consequences.

## Context

Cory is building an app that needs more than one language. PuzzleKit has no
translation support. Sites already has a `t` formatter
(`sites/engine/engine/formatters/sites.go`): it looks a key up in the site
locale, then in `en`, and prints the key itself when both miss. Its
placeholders fill in one pass, and an unknown placeholder stays visible. Sites
reads `locales/<locale>.json` as a **flat** object of key to string
(`engine/theme/compile.go`, `readLocales`); a nested object is a compile error
there today, and Sites has no plurals.

[[DECISION-D174-STANDARD-FORMATTERS]] lists `t` as Sites-only.
[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] says a formatter both hosts share
must mean the same thing in both. This card makes `t` a standard formatter with
one meaning in both hosts, and designs the PuzzleKit side: locale files, build
output, loading, and the runtime API.

The forces:

- **Bytes.** Hello-world is 20.8 KB gzip. An app with no translations must not
  grow at all, and one with translations should pay about 1–1.5 KB, not the
  10+ KB of a general i18n library.
- **No flash.** The first render is in the right language, or it is the
  prerendered default language with one switch after load (prerendered output
  only; see Static and hybrid output).
- **The compiler never parses `<script>`.** Anything that needs to know which
  keys the app uses can only see template literals.
- **Splitting is off by default** ([[DECISION-D160-SPA-CODE-SPLITTING]]) and
  forced off in static mode, so locale data cannot rely on `import()` chunks.

## Decision

### `t` semantics (both hosts)

`t` joins the standard set. D174's lists: standard 35 names, Sites-only 24
(platform-bound 6), PuzzleKit 38 names.

- **Lookup.** `{ 'cart.title' | t }` looks the key up in the active locale,
  then in the default locale. If both miss, it prints the key itself, so a
  missing string is visible, never blank. PuzzleKit logs a development warning,
  once per key and locale, with a did-you-mean from the table's keys; Sites
  already warns. In PuzzleKit the default-locale step happens at build time
  (see Build output), so the runtime table is already filled; the result is
  the same.
- **Input.** A missing input (`null`/`undefined`) prints nothing (D173 V4).
  Any other value is converted to a string and looked up, so runtime-built keys
  work: `{ ('status.' + order.status) | t }`.
- **Variables.** `{ 'greeting' | t({ name: user.first_name }) }` fills
  `{name}` placeholders in a single pass, left to right, so text that was
  inserted is never substituted again. The placeholder name is the exact text
  between `{` and `}`, with no trimming, as in Sites. A name missing from the
  variables stays visible as written (`{name}`). A name that is present with a
  missing value prints nothing. Values print by the D173 V6 rule. A `{` with no
  closing `}` is literal text. Non-object variables are ignored, with a
  development warning. The variables are an inline object literal (D173 V8)
  or any object value — a data field, a store record. A name is read from the
  object itself or from what it inherits from its class (a model's computed
  getters and relationships), never from `Object.prototype`, so
  `{constructor}` stays literal. `t` runs in every value position (D173 V1):
  text, quoted attributes, and brace-only attributes and props
  (`placeholder={ 'search.hint' | t }`).
- **Plurals (Shopify's model).** When the variables include `count`, the entry
  may be an object of CLDR plural categories (`zero`, `one`, `two`, `few`,
  `many`, `other`):

  ```json
  { "item_count": { "one": "{count} item", "other": "{count} items" } }
  ```

  `{ 'item_count' | t({ count: cart.items.length }) }`. PuzzleKit picks the
  category with `Intl.PluralRules(locale).select(count)`, cached per locale.
  Sites picks it with `golang.org/x/text/feature/plural`. A category the entry
  lacks falls back to `other`. **An exact `count` of 0 uses the entry's `zero`
  form when it has one, in every locale** — even where CLDR never selects
  `zero` (English). This is the Rails/Shopify rule: "Your cart is empty" needs
  no template branch, and it never contradicts CLDR where `zero` exists. A
  plural entry used without `count` renders `other`, with a development
  warning. A plain-string entry used with `count` just substitutes.
- **`{count}` is a localized number.** When `count` is a finite number, its
  placeholder prints in the active locale's number format (`1.234` in es), by
  the same helper that `pluralize` and `number_with_delimiter` use. Other
  variables print by V6, unformatted.
- **Output is text.** A translation never injects markup; `<b>` in a string
  prints as `<b>`. A translation with a link inside the sentence is future
  work (see Consequences).
- **`pluralize` stays** the simple English helper from D174. Translated apps
  use `t` with `count`.
- Conformance rows (shared with Sites) pin lookup, fallback, a missing key,
  single-pass substitution, an unknown placeholder, the en `one`/`other`
  choice, a `few` locale (`pl`), a missing category falling back to `other`,
  the `zero` form at 0, and `{count}` in `en`. Number strings in other locales
  are host-rendered, like D174's locale-rendered set.

### Locale files

Authors write one file per locale at `app/locales/<locale>.json`. The file name
is a BCP 47 tag (`en`, `es`, `pt-BR`). A name with `_` (`en_US.json`) is a
build error that suggests the `-` spelling.

```json
{
  "cart": {
    "title": "Your cart",
    "empty": "Your cart is empty.",
    "item_count": { "one": "{count} item", "other": "{count} items" }
  },
  "greeting": "Hello, {name}!",
  "nav.home": "Home"
}
```

- **Nesting flattens to dotted keys.** The file above defines `cart.title`,
  `cart.empty`, `cart.item_count`, `greeting` and `nav.home`. A flat file with
  dotted keys, the only form Sites accepts today, is valid too. Nesting is a
  PuzzleKit addition that Sites must adopt (see Sites), because plural entries
  make nested objects unavoidable in both hosts anyway.
- **An object whose keys are all CLDR category names is a plural entry**, and
  any other object is a namespace. A plural entry must have `other`; one
  without it is a build error. So `{ "one": …, "other": … }` is always a plural
  entry, and a namespace cannot use only category names as its keys.
- Values are strings, namespaces or plural entries. A number, boolean, array or
  `null` is a build error, positioned by key path. So is the same flattened key
  defined twice (`"a.b"` beside `"a": { "b": … }`). An empty object — a whole
  file or a namespace — defines no keys and is a build warning.

### Config

The locale list lives in `puzzle.config.js`, because the compiler emits the
files:

```js
export default { i18n: { locales: ['en', 'es'], defaultLocale: 'en' } };
```

- `defaultLocale` rather than `default`: `default` is a reserved word, so
  `const { default } = config.i18n` is a syntax error, and Next.js already uses
  `i18n.locales` + `i18n.defaultLocale`.
- `locales` must include `defaultLocale`. Every listed locale needs a file, or
  the build fails. A file under `app/locales/` that is not listed is not
  emitted, with a warning.
- The runtime reads everything it needs from the build's manifest (see Build
  output), so the `PuzzleApp` config does not repeat the locale list.
- `__PUZZLE_HAS_I18N__` is true only when `i18n` is configured. It is a
  config fact, not a usage-scan fact: script code can call `t` where no scan
  can see it. Without `i18n`, nothing ships and existing bundles stay
  byte-identical.

### Build output

The compiler (Go) owns the locale files end to end. The runtime never parses
nested files and never merges locales.

1. **Load and validate** every configured locale, applying the rules above.
2. **Flatten** each file to dotted keys. The emitted table is flat, and plural
   entries stay objects.
3. **Fill fallback at build time.** Every key in the default locale that is
   missing from another locale is copied in, and the build prints one warning
   per locale: `es: 3 keys missing, filled from en (cart.empty, nav.home,
   greeting)`. Keys that exist only in a non-default locale print a warning
   too; they are usually typos or stale keys. The browser downloads exactly
   one file and does no runtime fallback.
4. **Keep every key.** No pruning of unused keys (see Alternatives).
5. **Emit one hashed JSON file per locale**, `dist/locales/<locale>.<hash>.json`,
   minified. The hash is a content hash, in the same shape as the D160 chunk
   names. While `i18n` is configured, `locales/` is a reserved output name,
   the same way `chunks/` is reserved when splitting is on
   (`ValidatePublic` takes the flag).
6. **The manifest is a virtual module**, `@magic-spells/puzzle/i18n/manifest`,
   served by the esbuild plugin the way D31 serves the formatter manifest:
   `{ defaultLocale, locales: { en: 'locales/en.<hash>.json', … } }`. It
   reuses an existing exclusion mechanism, so D89's ceiling of three holds.
   The package `exports` map resolves the specifier to a default module that
   exports `null` for vitest, raw imports and other bundlers, as the formatter
   manifest does.
7. **A literal key missing from the default locale is a build warning.** The
   usage scan already walks every formatter chain in the templates. When a `t`
   input is a string literal, the scan checks it against the default table.
   Runtime-built keys are not checked.
8. **Using `t` without `i18n` configured is a build warning**, and so is an
   `app/locales/` folder without config. At runtime, the D43 guard's
   development hint for `t` says to configure `i18n`, and the key prints
   through.

### Runtime API

- **One service, `i18n`, beside the store and router.** It is on
  `this.ctx.i18n` in views and components, and on `app.i18n`, exactly the way
  `this.ctx.store` and `app.store` are. `ctx` gains the key only when `i18n` is
  configured. The per-view derived ctx (`_deriveCtx` in
  `datastore/adapter.js`) is built with `Object.create(base)`, so it inherits
  the key with no change.
  - `t(key, vars?)`: the same function the formatter calls.
  - `locale`: the active tag. `locales` and `defaultLocale` come from the
    manifest.
  - `setLocale(tag)`: switches the locale and returns a promise. It is the same
    method on `app.i18n`, so a language-switcher component calls
    `this.ctx.i18n.setLocale('es')`.
- **The `t` formatter is service-bound, like `link`.** It is registered over
  the service when `i18n` is present, if the app did not register its own. An
  app `t` wins, with D174's development shadow warning, because `t` is
  standard.
- **Why not `this.t()` on `PuzzleView`:** it would add a method to every view
  class in every app, collide with user methods named `t`, and give
  components a second way to reach a service that `ctx` already carries.
- **`<html lang>`** is set to the active locale on load and on every switch.
  Screen readers and hyphenation depend on it.
- **Static-kernel ctx and `/testing` ctx carry the service too.** The testing
  utilities take `i18n: { locale, strings }` so a test renders translated
  views without fetching.

### Locale selection

In order, at startup:

1. **The stored choice**: `localStorage['__puzzleLocale']`, read inside
   try/catch, used only if it is still a configured locale.
2. **`navigator.languages`**, in the viewer's order. For each tag, try the
   exact tag (compared case-insensitively), then its base language (`es-CO` →
   `es`), then a configured tag with the same base language (`pt` →
   `pt-BR`, the first in config order). The first match wins, so a viewer who
   prefers `es-CO` and then `en` gets `es` over `en`.
3. **`defaultLocale`.**

The prerender (Node) has no `navigator` or storage and always uses
`defaultLocale`.

`setLocale(tag)`:

- An unconfigured tag throws a `RangeError` naming the configured locales,
  following the config-validation throw pattern.
- The new file is fetched first. Only after it arrives do the table,
  `locale`, the format locale and `<html lang>` switch together, the choice is
  stored (try/catch), and the app refreshes once (see Loading). A failed fetch
  rejects the promise and changes nothing.
- Overlapping calls resolve last-wins, through a token.
- Called before the first commit (in `beforeMount`, for example, from a
  user-profile setting), it replaces the pending startup load and does not
  refresh anything.

### Loading

- **The first render has its strings.** `mount()` picks the locale and starts
  loading its strings in step 1, while services are wired, so the fetch
  overlaps `beforeMount`. It awaits the strings after `beforeMount` and before
  the HMR restore and `router.start()`. Navigation zero, including its guards,
  `data()` and the commit, never runs without the table. A `t` call made
  before the strings arrive (in `beforeMount`) prints the key, with a
  development warning.
- **The strings come from the island when possible.** A prerendered page
  carries the build locale's table (see below). If the active locale is the
  island's, no request is made. Otherwise the loader fetches
  `manifest.locales[active]`.
- **A failed load falls back once.** If the active locale's file fails to
  load, the loader tries the default locale (from the island, or by fetch).
  If that fails too, `mount()` rejects through the same teardown as a rejected
  `beforeMount`.
- **Switching refreshes the app once, as a same-location rebuild.** After the
  table swaps, the router re-runs the current location with no reuse (keep
  = 0), in replace mode: every routed view and layout is constructed fresh,
  `data()` re-runs, and the chain commits in one swap. No history entry is
  added, enter and exit animations are skipped, scroll stays where it is, and
  focus is not moved. This path already exists: the errorView retry rebuild
  ([[DECISION-D145-ERROR-BOUNDARIES]]) is a same-location navigation. Store
  records survive. Local view state (`setData`) does not, the same as after a
  reload, which is acceptable for a rare, user-started action; state that must
  survive a switch belongs in the store. In static output, the kernel
  re-assembles and re-mounts its page chain the same way.
- **A push in flight wins.** If a push is still loading when the switch lands,
  the rebuild waits for it and then rebuilds the page it committed, so neither
  a mid-navigation switch nor a login flow (`setLocale(user.locale)` then
  `push('/dashboard')`) strands the app on the previous page.
- **A failed rebuild rejects `setLocale`.** When the rebuild's `data()` throws
  (reported through `onError`), the old page stays on screen with the new
  locale already active, and `setLocale` rejects. The next navigation rebuilds
  every level in the new locale.
- **URLs.** Manifest paths are relative to the dist root. Path-mode apps
  resolve them against the normalized `routerBase`, the base that D81's static
  entry script already uses. Hash and memory modes resolve them against the
  shell document's URL, because those modes always serve the shell from the
  dist root. The static kernel uses its stub's base.

### Formatter locale

When `i18n` is configured, the active locale replaces the browser's default
locale in every locale-rendered formatter: `date`, `time`, `datetime`,
`number_with_delimiter`, `compact_number`, the `pluralize` count, and
`timeago` (`Intl.RelativeTimeFormat`). Without `i18n`, they keep D174's
browser-locale behavior.

- `client-runtime/formatters/locale.js` holds a module-level `formatLocale`
  (`undefined` by default, meaning the browser locale), `setFormatLocale(tag)`,
  and the `localeNumber` helper, moved there from `builtins.js` because
  `pluralize`, `number_with_delimiter` and `t`'s `{count}` all share it.
- `builtins.js` passes `formatLocale` where it passed `undefined`. The date
  family passes `locale ?? formatLocale`, so an explicit `locale` argument
  still wins. A locale change drops `localeNumber`'s per-digit cache and
  rebuilds the single-slot `compact_number` and `timeago` formatters.
- Only the i18n service calls `setFormatLocale`. Every read sits behind the
  inline `__PUZZLE_HAS_I18N__` probe, so without `i18n` the formatters keep
  their exact code.
- The slot is per page, not per app. Two mounted apps with different locales
  on one page share it, and the last switch wins; this is accepted.
- The prerender sets the slot to the build locale, so prerendered dates and
  numbers are in the default locale rather than the build machine's.

`currency` is not in this list. D174 F3 makes it identical-output (a fixed
symbol and `,` grouping, no `Intl`), so the active locale does not change it
(decided, see Consequences).

### Static and hybrid output

- **Pages prerender in `defaultLocale`.** The build's i18n service is built
  from the filled default table, which the Node pass reads from the staged
  `locales/` file named by the manifest, with no fetch.
- **`<html lang>` is the default locale** in every prerendered page: the
  build rewrites the shell's `lang` once per build, and the runtime keeps it in
  step on every switch.
- **Every prerendered page carries the table**, as
  `<script type="application/json" data-puzzle-locale="en">`, written through
  `escapeScriptJson` ([[DECISION-D113-SSG-RAWTEXT-RULE]]) at the shell's
  last `</body>` with the static data island
  ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]). The first load in the default
  locale makes no extra request. This applies in both modes. Static
  `prerender: false` pages carry it too; a hybrid `prerender: false` page is
  the verbatim shell and fetches. The cost is the whole table in every page's
  HTML. It compresses well, and splitting it per page would need the key
  analysis this card rejects.
- **A viewer whose locale differs sees the default language first.** Hybrid:
  the strings load before navigation zero, so takeover replaces the
  prerendered default-language markup with the active language in one swap.
  Static: the kernel fetches before its mount and swaps once. The first paint
  is in the default language on every page load until locale URL prefixes
  exist.
- **Locale URL prefixes (`/es/products`) are out of scope for 0.8.0.** Future
  design, recorded so it is not reinvented: `i18n: { routing: 'prefix' }`; the
  default locale unprefixed; every page prerendered once per locale into
  `dist/<locale>/…` with that locale's island; the locale from the URL wins
  over storage and `navigator`; `link` prefixes the active locale;
  `setLocale` navigates to the prefixed URL; the managed head gains
  `<link rel="alternate" hreflang>` per locale (build-time only, D111).
- **Plain SPA** (no prerender): the active locale's file is fetched during
  `mount()`, one request that overlaps `beforeMount`. A build-injected
  `<link rel="preload">` for it is possible later.

### Diagnostics

Build errors: a configured locale without a file; `defaultLocale` not in
`locales`; invalid JSON; a value of the wrong type (positioned by key path); a
plural entry without `other`; a flatten collision; a `_` in a file name.

Build warnings: keys filled from the default (one line per locale); keys that
exist only in a non-default locale; an empty object (a whole file or a
namespace) that defines no keys; a literal `t` key missing from the default
locale, in text and in quoted and brace-only attributes; `t` used without
`i18n` (worded "unless the app registers its own `t` formatter", because the
compiler never reads `app.js` and cannot see one); `app/locales/` without
`i18n`; an unlisted locale file.

Development-only runtime warnings (behind `__PUZZLE_DEV__`, warn-once): a
missing key, with a did-you-mean; `t` before the strings loaded; a plural
entry without `count`; non-object variables; the D43 hint for `t` without
`i18n`. `setLocale` with an unconfigured tag throws in every build.

## Alternatives rejected

- **Runtime fallback** (fetch the default locale too, or merge at lookup
  time). It means two downloads or a merge on every miss, plus a runtime merge
  step for plural objects. Filling at build time does the same work once, on
  the machine that already has every file, and prints a warning the author
  can act on.
- **Pruning unused keys.** The compiler never parses `<script>` (a public
  invariant), so keys used from JavaScript (`this.ctx.i18n.t('x')`) or built
  at runtime (`('status.' + s) | t`) would vanish silently, and the fallback
  would print raw keys in production. Keeping every key costs bytes in the
  locale file, never in `app.js`. Revisit only with an explicit keep-list,
  never by guessing.
- **Locales as `import()` chunks.** Splitting is off by default (D160) and
  forced off in static mode, and with it off esbuild inlines every locale into
  `app.js`, the opposite of fetching only the active one. Plain JSON works in
  every output mode, needs no module graph, and caches by hash.
- **All locales inlined into `app.js`.** The same problem at any size: every
  viewer downloads every language.
- **Locale URL prefixes now.** They touch routing, prerender (pages ×
  locales), `link`, redirects and head tags, which is a release of its own.
  The design is recorded under Static and hybrid output.
- **A separate i18n library (i18next, FormatJS).** Each is 10+ KB gzip before
  plugins, about half of a hello-world app (20.8 KB), and brings its own
  message syntax that Sites could not share. FormatJS's ICU MessageFormat also
  needs a parser at runtime or a compile step. The browser already ships
  `Intl.PluralRules` and `Intl.NumberFormat`, which do the hard part (CLDR
  plural rules and number formats), so the remaining work is a lookup, a
  single-pass substitution and a loader. Budget: 1–1.5 KB gzip, gated to zero
  without `i18n`. Apps that need ICU `select`/gender can still register their
  own `t` (with the shadow warning).
- **ICU MessageFormat strings** (`{count, plural, one {…} other {…}}`) in our
  own implementation. Shopify-style plural objects are plain JSON that
  translators and Sites already understand, and need no parser.
- **Locale config in the `PuzzleApp` config.** The compiler must know the
  locales to emit and fill files, and it cannot read `app.js`. One source of
  truth in `puzzle.config.js`, delivered to the runtime by the manifest.
- **`this.t()` on every view.** See Runtime API.
- **Refresh in place** (re-render every live view without rebuilding). It
  needs a live-view registry in production, which only exists in dev
  (`devstate.js`). It would also miss components that D170's identity
  short-circuit skips, and strings computed in `data()`. The same-location
  rebuild is an existing path and is correct by construction.
- **Flat files only, matching Sites today.** Plural entries are objects
  anyway, so Sites must change its locale parser either way. Nesting is what
  translators and Shopify themes use.
- **Strict CLDR for `zero`** (use it only where the locale's rules select it).
  It forces an `{#if count === 0}` branch around every "empty" message in
  English, the most common case; the adopted rule never contradicts CLDR where
  `zero` exists.

## Consequences

**Questions decided** (they were open when the card was written):

1. **Locale selection order:** as written under Locale selection — the stored
   choice, then each viewer tag exact, by base language, then the first
   configured tag with the same base (`pt` → `pt-BR`), then `defaultLocale`.
   The storage key is `__puzzleLocale`, and every storage access sits in
   try/catch.
2. **Config shape:** `i18n: { locales, defaultLocale }`, not `default`.
3. **Nested locale files** are allowed and flatten to dotted keys; Sites adopts
   flattening.
4. **The `zero` rule is adopted:** an exact `count` of 0 uses an entry's `zero`
   form when it has one, in every locale (see Plurals).
5. **`currency` stays locale-independent** per D174 F3. A locale-aware currency
   would change D174.
6. **Route `meta.title` stays static** ([[DECISION-D84-HEAD-MANAGEMENT]], SPEC
   §45). Translated tab titles need a D84 amendment, for example
   `meta: { title: { t: 'products.title' } }` resolved through the service;
   that is future work.

**Future work, labeled as such:** locale URL prefixes (above); rich-text
translations (a component or link inside a sentence); translation-key types
for `puzzle check` (a key union generated from the default table); `dir="rtl"`
from the locale; per-route string splitting if files grow large; a preload
hint for the SPA.

### Build list — PuzzleKit

Order: Go work first (items 1–5), then runtime (6–12). All twelve are built.
Items marked **[now]** could start before `feat/core-expressions` (D173 V1/V8,
PR #152) merged; the template-level `t({ … })` and brace-only attribute tests
landed once it did. Items marked **[after #150]** build on PR #150's
`builtins.js`.

**Go compiler:**

1. **[now] Config.** `compiler/internal/config/config.go`: an `I18n` field
   (`locales`, `defaultLocale`) with validation (default ∈ locales,
   non-empty, well-formed tags). Tests: `config_test.go`.
2. **[now] Locale discovery, validation, flatten, fill, hash and emit.** A new
   package, `compiler/internal/locales`: load `app/locales/*.json`, apply the
   value rules, recognize plural entries, flatten, report collisions, fill
   from the default with warnings, write minified hashed files, and return the
   manifest. Called from `compiler/internal/build/build.go` into staging, with
   `ValidatePublic` reserving `locales/` when `i18n` is on. Tests: a
   table-driven `locales_test.go` (nesting, dotted keys, collisions, plural
   recognition, `other` required, bad types, fill warnings, extra-key
   warnings, stable hashes), plus a build test that `dist/locales/` holds
   exactly one file per locale.
3. **[now] Manifest module and define.** `compiler/internal/plugin/manifest.go`
   serves `@magic-spells/puzzle/i18n/manifest`, fresh on every rebuild (the
   formatter manifest's `TestFormatterManifestFreshAcrossIncrementalRebuilds`
   pattern). `compiler/internal/build/options.go` adds
   `__PUZZLE_HAS_I18N__` to the bundle flags for every pass (SPA, watch,
   prerender, per-page static). Tests: plugin manifest golden; a production
   bundle without `i18n` holds none of the i18n module's distinctive string
   literals (D89's literal-probe rule).
4. **[now] Scan checks.** `compiler/internal/plugin/scan.go`: record `t` use
   and literal `t` keys during the existing formatter walk. Build warnings for
   a missing literal key and for `t` without `i18n`. Tests: `scan_test.go`.
5. **[now] Dev watch and reload.**
   - SPA: `compiler/internal/build/watch.go`'s batch classifier gains a locale
     class for `app/locales/**`: re-emit the locale files, refresh the
     manifest, rebuild, reload over SSE. The `WatchBuilder` writes in place,
     so it prunes superseded hashed files by diffing its own locale outputs
     (the D160 pattern).
   - Static: `compiler/internal/build/watch_static.go` and `route_deps.go`
     treat a locale file as render-wide. No metafile carries it, since it is
     read from disk and never imported: the same one-off edge as `{#svg}` in
     [[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]. Static dev stays on the warm
     staging swap of [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]].
   - Tests: watch tests for a string edit in both modes; the D155 equivalence
     test runs with and without i18n, and its locale-edit step requires the
     locale classification.
   - `puzzle check`: no change. Formatter calls already type-check through
     `__puzzle_check_formatter`. `types/index.d.ts` gains the service type (item
     6).

**Runtime:**

6. **[now] The i18n service**, a new `client-runtime/i18n.js`: locale
   selection, the loader (island first, then a hashed fetch with the
   URL-resolution rule), `t` (lookup, single-pass substitution, plural
   selection through a cached `Intl.PluralRules`), `setLocale`, `<html lang>`,
   and the development warnings. Imported by `app.js`, `static/index.js`,
   `ssg/index.js` and `testing/index.js`, behind the full inline
   `__PUZZLE_HAS_I18N__` probe at each import-holding site. Add the
   `./i18n/manifest` export and its `null` default in `package.json`, the
   vitest alias, and `types/index.d.ts` (`PuzzleI18n`, optional `ctx.i18n` and
   `app.i18n`). Tests: a new `tests/i18n.test.js` (selection order, lookup,
   missing key, substitution edge cases, plurals in en/pl/ar, the missing
   category, the zero form, a failed load falling back).
7. **[now] The `t` formatter.** Registered over the service if absent;
   `STANDARD_FORMATTERS` gains `t`; the D43 development hint names `i18n` for
   `t`. Tests: `tests/formatters.test.js`, and the shared conformance table
   gains the `t` rows (`tests/conformance/formatters.json`).
8. **[after #150] Formatter locale threading.** The new
   `client-runtime/formatters/locale.js` and the `builtins.js` edits described
   under Formatter locale. Tests: formatter locale cases in a child process
   (the de-DE pattern #150 uses), and an explicit `locale` argument still
   wins.
9. **[now] App wiring and loading.** `client-runtime/app.js`: build the service
   in step 1; start loading; await it after `beforeMount` and before
   `router.start()`; add `ctx.i18n` and `app.i18n`; `setLocale` drives the
   rebuild. Tests: an app test proving no render before the strings arrive,
   `setLocale` before first commit, a rejected switch changing nothing,
   last-wins, a switch during or before a push, a failed rebuild.
10. **[now] The same-location rebuild.** `client-runtime/router/router.js`: an
    internal entry beside `__failedView(view, true)` that re-runs the
    committed path with keep = 0, in replace mode, with no animations, no
    skeleton, no scroll change and no focus move, after any pending push.
    Tests: no new history entry, preserved scroll, every level reconstructed,
    no enter/out animation, no skeleton flash.
11. **[now] Prerender and static.** `client-runtime/ssg/index.js`: the build
    service over the default table, `setFormatLocale(defaultLocale)`, the
    shell's `<html lang>`, and the `data-puzzle-locale` island in both shell
    injectors. `client-runtime/static/index.js`: read the island, fetch when
    the active locale differs, re-mount on `setLocale`. Tests in
    `tests/i18n-ssg.test.js`: static prerender, the static kernel's single
    swap, hybrid takeover in a non-default locale, the island at the shell's
    last `</body>`, and the `</script>` escape.
12. **An example and the size gate.** A new `examples/i18n` (en, es, pl for
    `few`; SPA, `--hybrid` and `--static` builds in the test `pretest`), and
    `npm run measure:size` proving hello-world and todos are unchanged.
    `examples/i18n`'s own figure is the i18n cost (target 1–1.5 KB gzip).

**Docs, with the runtime items:**

- [[DOC-SPEC-TEMPLATE]] §66 and [[DOC-LANGUAGE-CORE]]'s formatter table.
- [[DOC-SPEC-ANATOMY]] (`i18n` config, `app/locales/`),
  [[DOC-SPEC-BUILD]] (`dist/locales/`, the manifest, the island) and
  [[DOC-SPEC-ROUTER]] (strings load before navigation zero; the
  same-location rebuild).
- D174's standard and Sites-only lists (35 / 24).
- [[COMPONENT-FORMATTERS]], [[COMPONENT-PUZZLE-APP]], [[COMPONENT-SSG]],
  `skills/puzzle/SKILL.md`, the README and the CHANGELOG.

### Sites (low priority; Cory is still designing Sites)

Sites already has lookup, the `en` fallback, the key-on-miss and single-pass
substitution. To match this card, it adds:

- Plural entries: pick the category with `golang.org/x/text/feature/plural`
  (the cardinal rules for the site locale), use the `zero` form for an exact
  0 when the entry has one, fall back to `other`, and use `other` when `count`
  is absent.
- `{count}` printed in the site locale's number format, the same helper as
  its `number_with_delimiter` and `pluralize` count.
- Locale files that nest, flattened to dotted keys, with plural-entry
  recognition and the same build errors (`readLocales` in
  `engine/theme/compile.go` stops requiring a flat `map[string]string`).
- A missing input prints nothing; non-map variables warn and are ignored
  (today they are an error). Variable names may come from a value's inherited
  fields, never from the object prototype.
- The shared `t` conformance rows, run from its Go formatter tests.
