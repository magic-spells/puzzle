---
name: Formatter registry
status: verified
verified_at: '2026-08-24T21:39:23.520Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - DECISION-D174-STANDARD-FORMATTERS
  - FILE-FORMATTER-REGISTRY
  - FILE-FORMATTER-BUILTINS
  - FILE-FORMATTER-ALL
notes:
  - kind: state
    text: >-
      Dev-only did-you-mean machinery is now tree-shaken from prod (2026-07-24). The D43 __missing
      typo-guard computed its Levenshtein suggestion OUTSIDE the (dropConsole-stripped)
      console.error, so ~0.5 KB of dead code shipped in production. editDistance + the nearest-match
      search (now a module-level `nearestFormatter` function, no longer a class method) plus the
      whole warn block are wrapped in `if (typeof __PUZZLE_DEV__ === 'undefined' ||
      __PUZZLE_DEV__)`; production folds __PUZZLE_DEV__ to false, DCEs the branch, and tree-shakes
      both functions out. Verified: the "did you mean"/"unknown formatter" strings and the DP loop
      are ABSENT from a prod examples/todos app.js. Dev/test behavior (warn-once with suggestion)
      unchanged. Does NOT touch D31 manifest tree-shaking or the D43 pass-through contract.
    sha: d9591d6
  - kind: gotcha
    text: >-
      Intl objects in the date family are CACHED in module-level Maps and reused for the app's
      lifetime — `date`/`time`/`datetime` keyed on (locale, `kind:preset`), `in_timezone` on the tz
      argument, and `timeago` — which takes no locale — held in a single lazily-built module-level
      slot. Constructing them per call cost ~37us each; measured against the real exported date(),
      100k calls went 3725ms -> 122ms (~30x). Anything added here must stay stateless for reuse:
      Intl.DateTimeFormat/RelativeTimeFormat/NumberFormat are safe because format()/formatToParts()
      carry no per-call state. Do not cache anything that does.


      Two non-obvious constraints hold the design together. (1) It must be a keyed Map, NOT a
      single-slot last-used memo. A single slot benchmarks ~7% faster on a uniform workload and then
      collapses to worse-than-uncached the moment a page renders two presets — measured 85ms vs
      3450ms on an alternating workload, which is as ordinary as a table with a short date column
      and a long date in its header. (2) The `.set()` must sit AFTER the constructor inside the
      existing try, because an invalid locale (`en_US`, `!!`, `e`) and an unknown time zone both
      throw at CONSTRUCTION. Insert-after-success is what keeps a throwing tag from poisoning the
      entry and stops repeated bad tags from growing the Map unbounded; the surrounding catch still
      fails soft to str(v). Note `not-a-locale` is a structurally valid BCP-47 tag and does NOT
      throw — it resolves to the default locale, so it is useless as a negative test.


      Preset resolution uses Object.hasOwn before the lookup, so an unknown preset name collapses
      onto the `medium` entry instead of minting one per typo. The kind is part of the key because
      `date('short')` and `time('short')` are different Intl options.
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: gotcha
    text: >-
      `in_timezone(...) | datetime('iso')` (and `time('iso')`) prints the TARGET zone's wall clock
      with the VIEWER's offset — e.g. Tokyo's 09:00 stamped `-04:00` for a New York viewer — because
      `in_timezone` returns a shifted local Date, not a zoned value. The Intl presets look right
      because they print no offset. Known limitation of `in_timezone`'s shifted-Date contract; not
      an `iso` bug.
  - kind: state
    text: >-
      Translations (D175, v1.81). `t` is the 35th name in `STANDARD_FORMATTERS` but not a built-in:
      it lives in `client-runtime/i18n.js`, and `installTranslate(registry, i18n)` registers it over
      the i18n service right after `makeFormatterRegistry`, only when the app configured `i18n` and
      did not register its own `t` (an app `t` wins and draws the standard-name shadow warning). It
      is not in the D31 manifest; the usage scan records `t` calls and literal keys separately
      (`Usage.TKeys`). Without `i18n`, a template `t` hits the D43 `__missing` guard, whose
      development hint for `t` says how to configure `i18n`. `nearestFormatter` is exported so the
      service reuses it for its missing-key did-you-mean. The formatter locale lives in
      `client-runtime/formatters/locale.js` (NOT builtins.js, which builtins-all.js
      namespace-imports — any helper exported there would become a formatter): the `formatLocale`
      slot, `setFormatLocale` (the i18n service's apply step calls it, so the prerender renders in
      the default locale), and `localeNumber` (moved from builtins.js; shared by `pluralize`,
      `number_with_delimiter` and `t`'s `{count}`). `date`/`time`/`datetime` do `locale ??=
      formatLocale`, so an explicit argument wins; `compact_number` and `timeago` rebuild their
      single-slot formatter when the slot moves; `setFormatLocale` clears `localeNumber`'s cache.
      Every read sits behind the inline `__PUZZLE_HAS_I18N__` probe, so an app without translations
      passes `undefined` exactly as before. `currency` stays locale-independent. The conformance
      table carries top-level `translations` and `t` rows with a `locale`, run through the service
      in tests/formatters.test.js.
  - kind: state
    text: >-
      D174 group (e): the markup pair is no longer a registry concern. Templates never call `raw` or
      `newline_to_br` through `__f` — codegen lowers a text interpolation ending in either to the
      live-HTML vnode, and the runtime applies `client-runtime/sanitize.js` itself — so the scan
      keeps both names out of the manifest, `FormatterRegistry` seeds only `escape` (the body's
      "`escape` and `raw` remain safety defaults" is now `escape` alone), and
      `makeFormatterRegistry` warns in development that an app `raw`/`newline_to_br` is never called
      from templates instead of the generic shadow warning. The `builtins.js` exports return the
      sanitized markup / escaped-text-with-<br> strings, for script code and the conformance table;
      importing them pulls in the sanitizer.
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Formatter registry



Liquid-style, display-only transformations used by compiled template chains. The registry seeds built-ins, applies user registrations last (user overrides win), exposes the raw function map to render functions, and supports arbitrary string keys through bracket access.

`register(name, fn)` validates both arguments and **throws** on a non-empty-string name or a non-function value. This closes the one gap in an otherwise established config-validation pattern — `PuzzleApp` already throws for non-function lifecycle hooks and the router for non-function guards. It throws rather than warning because a non-function formatter is a deterministic config error, and skipping it silently would fall through to `__missing` and disguise the broken config as a typo. Note the asymmetry with the paragraph below, which is deliberate: a bad *name* is a typo and renders through, a bad *value* is a config error and stops.

An unknown formatter calls `__missing(name)`: warn once per registry, include a did-you-mean suggestion at edit distance at most two, and return a pass-through function. A typo therefore renders the original value instead of crashing the view. A name D174 removed (`sort`, `where`, `map`, `uniq`, `reverse`, `compact`, `first`, `last`, `noescape`) gets a replacement hint instead of a did-you-mean — `data()`, `items[0]`, `items.at(-1)`, `compact_number`, `raw`. The hint table sits behind `__PUZZLE_DEV__` with the rest of the warn block, so production carries none of it.

**The built-in set is D174's standard set** ([[DECISION-D174-STANDARD-FORMATTERS]]): the 34 names Sites implements with the same arguments and meaning, plus the PuzzleKit-only `link`, `timeago` and `in_timezone`. `formatters.js` exports the 34 as `STANDARD_FORMATTERS`, and `makeFormatterRegistry` logs a **development-only** `console.warn` when an app formatter registers under one of them — the app still wins, and it never throws. PuzzleKit-only names (and an app `link`) draw no warning. An app `raw` or `newline_to_br` draws a different warning: templates never call either name through the registry, so the app's function is unreachable from a template. There are no list formatters: list shaping is `data()` or a plain expression. The identical-output part of the set is pinned by the shared conformance table `tests/conformance/formatters.json` (name, input, args, expect; JSON `null` is the missing value; a `zone` field runs a case in a child process with that `TZ`), which Sites' Go tests are meant to run too.

Built-ins are pure named exports. A JSON name manifest is embedded by the Go build scanner, which serves a virtual module importing only formatters observed in project templates. The scan deliberately errs toward inclusion; `escape` is the one safety default the manifest and the registry always carry. The markup pair never enters the manifest: codegen lowers a text interpolation ending in `raw` or `newline_to_br` to the live-HTML node, whose runtime applies the sanitizer itself, and the scan records the pair only as the `__PUZZLE_HAS_RAW_HTML__` bit. Raw/test imports use the full built-in map. `default` is a reserved word, so `builtins.js` exports it as `export { defaultValue as default }` — the module's default export — and the virtual manifest binds it as `default as __puzzle_default`; nothing may import `builtins.js`'s default expecting anything else.

One built-in is not a pure export: `link` (D79) needs the live router. Every
registry is therefore built by one shared `makeFormatterRegistry(custom, url)`
helper — built-ins, then the app's custom formatters, then `link` only when the
app did not supply its own, so a user `link` from config wins. `PuzzleApp`
constructs its registry alongside the Store and passes a closure that reads
`this.router` lazily, so a re-mount can never capture a stale Router; the static
kernel builds the same registry against its per-page router. `link` delegates to
`router.url()` (nullish → `''`, non-strings coerced, non-`/` strings pass
through). The tree-shake scanner ignores the name (not on the allowlist), the
same handling as any custom formatter.

All built-ins fail soft on nullish or invalid display input. The number formatters that print (`currency`, `percentage`, `number_with_delimiter`, `compact_number`, `pluralize`) print nothing for a missing value rather than `Number(null)`'s `0`; `divided_by`/`modulo` return `undefined` for a zero divisor. `round`, `currency` and `percentage` share one decimal rounding helper that shifts the decimal string (`1.005` → `100.5`, not binary `100.4999…`) and rounds half away from zero; `places` normalizes to an integer, clamped to 0–100 for the `toFixed` pair and −100–100 for `round`. `escape` is an identity on text. The `raw` and `newline_to_br` exports return the markup the live-HTML node renders — the sanitized value, and the escaped value with a `<br>` per line break — from `client-runtime/sanitize.js`, for script code and the conformance table; importing either pulls the sanitizer in. `size`, `truncate`, `split('')` and `capitalize` work on code points, not UTF-16 units. `json` is a hand-written serializer (keys sorted by code point, missing / NaN / ±Infinity → `null`, a cycle → `null`), because a JS object always enumerates integer-like keys first and so cannot carry sorted order through `JSON.stringify`.

Locale-rendered output uses the viewer's locale (Intl's default): `number_with_delimiter` with no argument and `pluralize`'s count go through one cached `Intl.NumberFormat` per fraction-digit count, so decimals print as given; `compact_number` uses one cached compact formatter.

Those value-level runtime formatters are unrelated to D150's
`{#raw}…{/raw}` source block, which disables brace lexing before any formatter
could run.

The date family (`date`/`time`/`datetime`/`timeago`/`in_timezone`) treats a
bare `YYYY-MM-DD` string as a **calendar date**
([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]): one shared `parseDateInput`
constructs it as local midnight so it displays as written in every timezone,
with a round-trip check that sends rollover components back to the
Invalid-Date fail-soft path, and `in_timezone` passes it through UNSHIFTED —
a day names no instant to re-express. `date`, `time` and `datetime` share the
presets `short`, `medium` (default), `long` — `dateStyle`/`timeStyle` per
formatter — and `iso`, which is RFC 3339 in the viewer's zone (`Z` for a zero
offset) and returns the calendar date itself for a calendar-date input. An
unknown preset logs one development `console.error` per `(formatter, preset)`
and renders as `medium`; the retired preset names `date`/`time`/`datetime`
point at the formatter of that name.
