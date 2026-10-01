---
name: Function library (the formatter registry)
status: verified
verified_at: '2026-09-25T10:47:50.423Z'
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
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
---

# Function library (the formatter registry)

The runtime half of the template function library
([[DECISION-D174-STANDARD-FORMATTERS]] owns each function's contract;
[[DECISION-D176-EXPRESSION-LANGUAGE]] rule 4 the call form). Code keeps the
`formatters` names (`client-runtime/formatters.js`, `client-runtime/formatters/`,
the `@magic-spells/puzzle/formatters/manifest` alias, the app's `formatters` config
key) because the compiler and package exports address them by those paths; everywhere
else they are "functions".

## Wiring

- Codegen writes `(__f["name"] || __f.__missing("name"))(…)`; render functions receive
  `registry.getAll()`, never the registry.
- **Name lists** (dev-only, tree-shaken): `STANDARD_FORMATTERS` (19, including `t`) and
  `PUZZLEKIT_FORMATTERS` (`link`, `timeago`). The same 21 names must match
  `codegen.LibraryFunctionNames`, `puzzle check`'s signatures and `LibraryFunctions` in
  `types/index.d.ts` (see [[COMPONENT-CODEGEN]]).
- **Built-ins** are pure named exports of `formatters/builtins.js`;
  `formatters/builtins.json` lists them (18 standard + `timeago`) and is embedded in Go
  (`builtins_embed.go`). The usage scan (`plugin/scan.go`) finds bare calls in every
  expression position except an `@event` value's own calls and serves a virtual module
  importing only those ([[DECISION-D31-FORMATTER-TREESHAKE]]); it errs toward inclusion,
  and `escape` is always seeded. `builtins-all.js` (full map for raw/test imports)
  namespace-imports `builtins.js`, so **any helper exported from builtins.js becomes a
  library function** — shared helpers (`localeNumber`, the `formatLocale` slot) live in
  `formatters/locale.js`; calendar-date parsing lives in `client-runtime/dates.js`.
- **`makeFormatterRegistry(custom, url)`** builds every registry: built-ins, then app
  functions, then `link` unless the app supplied one. `link` delegates to `router.url()`
  through a closure reading `this.router` lazily (re-mount safe); the static kernel builds
  the same registry over its page stub. `t` is installed afterwards by
  `installTranslate(registry, i18n)` (i18n.js) only when `i18n` is configured and the app
  has no `t`, so formatters.js never imports i18n. Neither enters the manifest; the scan
  records `t` literal keys separately (`Usage.TKeys`) for the missing-key warning.
- **`register(name, fn)` throws** on a bad name or non-function — silently skipping would
  disguise broken config as a typo. App functions win over built-ins; dev warns when one
  shadows a standard name, and specially for `raw`/`newline_to_br` (templates lower
  those to the live-HTML node, so an app override is unreachable from a template).
- **Handler shadows**: in dev, `PuzzleView.mount()` calls `warnHandlerShadows(view)` —
  once per view and name, for each `events` key naming a library or app function (the
  compiler warns too, `checkHandler`).
- **Unknown names** hit `__missing(name)`: dev reports once per registry + name with a
  did-you-mean (`nearestFormatter`, edit distance ≤ 2, reused by i18n), or the
  replacement from `REMOVED_FORMATTERS`, or the i18n hint for `t`; it returns a
  pass-through so the view still renders. All of it sits behind `__PUZZLE_DEV__`.

## Implementation gotchas

- **Rounding**: `round`, `currency`, `percentage` share one helper that shifts the
  decimal string (`1.005` → `100.5`) and rounds half away from zero.
- `truncate`/`capitalize` work on code points. `json` is hand-written (code-point key
  order, NaN/±Infinity/missing/cycle → `null`) because `JSON.stringify` can't carry
  sorted integer-like keys.
- **Locale**: the `formatLocale` slot is set only by the i18n service's
  `setFormatLocale` and read behind `__PUZZLE_HAS_I18N__`; `date`/`time`/`datetime` take
  `locale ??= formatLocale`. `currency` is locale-independent.
- **Intl caching**: date-family formatters live in module-level keyed Maps
  (locale + options object; `in_timezone` by zone; `timeago` one lazy slot) — ~30×
  faster. It must be a keyed Map, not a last-used slot (two presets alternating is worse
  than uncached). `.set()` goes AFTER the constructor inside the try — invalid locales and
  zones throw at construction. Only `undefined`/string locales are keys. Options objects
  are module-constant bindings (`MEDIUM_DATE`, `DATE_DEFAULTS`, …), never
  `DATE_PRESETS.date.medium`, since a module-level property read keeps both tables alive
  in date-free apps. Note `not-a-locale` is valid BCP-47 and does not throw.
- **Dates** ([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]): a bare `YYYY-MM-DD` is local
  midnight (round-trip checked); `in_timezone` passes it through unshifted. Unknown
  runtime presets log once per (function, preset) and render the default; literal ones
  are compile warnings (`codegen/presets.go`).
- **Known limitation**: `datetime(in_timezone(ts, zone), 'iso')` prints the target
  zone's wall clock with the VIEWER's offset, because `in_timezone` returns a shifted
  local Date, not a zoned value.

## Conformance

`packages/puzzle-lang/conformance/functions.json` holds the identical-output rows
(`zone` runs a case under that `TZ`, `locale` sets the function locale). The Go
`conformance` package embeds it beside `expressions-parse.json` so Sites runs the same
rows; PuzzleKit's vitest suite imports the JSON directly.
