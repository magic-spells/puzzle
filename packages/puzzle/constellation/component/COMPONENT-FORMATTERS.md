---
name: Function library (the formatter registry)
status: verified
verified_at: '2026-11-01T19:25:08.617Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FUNCTION-MISSING-GUARD
  - DECISION-D174-FUNCTION-LIBRARY
  - DECISION-D114-CALENDAR-DATE-FORMATTERS
  - FILE-FORMATTER-REGISTRY
  - FILE-FORMATTER-BUILTINS
  - FILE-FORMATTER-ALL
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Function library (the formatter registry)

The runtime half of the template function library. [[DECISION-D174-FUNCTION-LIBRARY]] owns
each function's contract, [[DECISION-D176-EXPRESSION-LANGUAGE]] rule 4 the call form. Code
keeps the `formatters` names (`client-runtime/formatters.js`, `client-runtime/formatters/`,
the `@magic-spells/puzzle/formatters/manifest` alias, the app's `formatters` config key)
because the compiler and package exports address them by those paths; everywhere else they
are "functions".

## Wiring

- Codegen writes `(__f["name"] || __f.__missing("name"))(…)`; render functions receive
  `registry.getAll()`, never the registry.
- **Name lists** (dev-only, tree-shaken): `STANDARD_FORMATTERS` (19, including `t`) and
  `PUZZLEKIT_FORMATTERS` (`link`, `timeago`). The same 21 names must match
  `codegen.LibraryFunctionNames`, `puzzle check`'s signatures and `LibraryFunctions` in
  `types/index.d.ts` ([[COMPONENT-CODEGEN]]).
- **Built-ins** are pure named exports of `formatters/builtins.js`; `formatters/builtins.json`
  lists them (18 standard + `timeago`) and is embedded in Go (`builtins_embed.go`). The usage
  scan (`plugin/scan.go`) finds bare calls in every expression position except an `@event`
  value's own calls and serves a virtual manifest importing only those
  ([[DECISION-D31-FORMATTER-TREESHAKE]]); it errs toward inclusion, and `escape` is always
  seeded. `builtins-all.js` (the full map for non-compiler imports) namespace-imports
  `builtins.js`, so **any helper exported from builtins.js becomes a library function** —
  shared helpers (`localeNumber`, the `formatLocale` slot) live in `formatters/locale.js`;
  calendar-date parsing lives in `client-runtime/dates.js`.
- **`makeFormatterRegistry(custom, url)`** builds every registry (app, static kernel, SSG,
  `/testing`): built-ins, then app functions, then `link` unless the app supplied one. `link`
  delegates to `router.url()` through a closure that reads the router lazily (re-mount safe).
  `t` is installed afterwards by `installTranslate(registry, i18n)` (i18n.js) only when `i18n`
  is configured and the app has no `t`, so formatters.js never imports i18n. Neither enters
  the manifest; the scan records `t` literal keys separately (`Usage.TKeys`) for the
  missing-key warning.
- **`register(name, fn)` throws** on a bad name or non-function — silently skipping would
  disguise broken config as a typo. App functions win over built-ins; dev warns when one
  shadows a standard name, and specially for `raw`/`newline_to_br` (templates lower those to
  the live-HTML node, so an app override is unreachable from a template).
- **Handler shadows**: in dev, `PuzzleView.mount()` calls `warnHandlerShadows(view)` once per
  view and name, for each `events` key naming a library or app function (the compiler warns
  too, `checkHandler`).
- **Unknown names** hit `__missing(name)`: dev reports once per registry + name with a
  did-you-mean (`nearestFormatter`, edit distance ≤ 2, reused by i18n), or the replacement from
  `REMOVED_FORMATTERS`, or the i18n hint for `t`; it returns a pass-through so the view still
  renders ([[DECISION-D43-FUNCTION-MISSING-GUARD]]). All of it sits behind `__PUZZLE_DEV__`.

## Implementation gotchas

- **Unreadable input**: `num` reads a number (missing, `''` and booleans are NaN); `unread`
  decides what a number or date function prints when it cannot read its input — a string as
  written, anything else (NaN, ±Infinity, an Invalid Date, an object) nothing. `in_timezone`
  returns `''` for an invalid date so a nested call prints nothing.
- **Rounding**: `round`, `currency`, `percentage` share one helper that shifts the decimal
  string (`1.005` → `100.5`) and rounds half away from zero.
- `truncate`/`capitalize` work on code points. `json` is hand-written (code-point key order,
  NaN/±Infinity/missing/cycle → `null`) because `JSON.stringify` can't carry sorted
  integer-like keys.
- **Locale**: the `formatLocale` slot is set only by the i18n service's `setFormatLocale` and
  read behind `__PUZZLE_HAS_I18N__`; `date`/`time`/`datetime` take `locale ??= formatLocale`.
  `currency` is locale-independent.
- **Intl caching**: date-family formatters keep their `Intl` objects in module-level keyed
  Maps (locale + options object; `in_timezone` by zone; `timeago` one lazy slot). It must be a
  keyed Map, not a last-used slot (two presets alternating is worse than uncached). `.set()`
  goes AFTER the constructor inside the try — invalid locales and zones throw at construction.
  Only `undefined`/string locales are keys. Options objects are module-constant bindings
  (`MEDIUM_DATE`, `DATE_DEFAULTS`, …), never `DATE_PRESETS.date.medium`, since a module-level
  property read keeps both tables alive in date-free apps. `not-a-locale` is valid BCP-47 and
  does not throw.
- **Dates** ([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]): a bare `YYYY-MM-DD` is local midnight
  (round-trip checked); `in_timezone` passes it through unshifted. Unknown runtime presets log
  once per (function, preset) and render the default; literal ones are compile warnings
  (`codegen/presets.go`).
- **Known limitation**: `datetime(in_timezone(ts, zone), 'iso')` prints the target zone's wall
  clock with the VIEWER's offset, because `in_timezone` returns a shifted local Date, not a
  zoned value.

## Conformance

`packages/puzzle-lang/conformance/functions.json` holds the identical-output rows (`zone` runs
a case under that `TZ`, `locale` sets the function locale). The Go `conformance` package
embeds it beside `expressions-parse.json`, and Sites's Go library runs the same rows;
PuzzleKit's vitest suite imports the JSON directly.
