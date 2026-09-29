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
notes:
  - kind: state
    text: >-
      Dev-only did-you-mean machinery is tree-shaken from prod (2026-07-24). The D43 __missing
      typo-guard computed its Levenshtein suggestion OUTSIDE the (dropConsole-stripped)
      console.error, so ~0.5 KB of dead code shipped in production. editDistance + the nearest-match
      search (a module-level `nearestFormatter` function, not a class method) plus the whole warn
      block are wrapped in `if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)`;
      production folds __PUZZLE_DEV__ to false, DCEs the branch, and tree-shakes both functions out.
      Does NOT touch D31 manifest tree-shaking or the D43 pass-through contract.
    sha: d9591d6
  - kind: gotcha
    text: >-
      Intl objects in the date family are CACHED in module-level Maps and reused for the app's
      lifetime — `date`/`time`/`datetime` keyed on (locale, options object), `in_timezone` on the tz
      argument, and `timeago` — which takes no locale — held in a single lazily-built module-level
      slot. Constructing them per call cost ~37us each; 100k calls went 3725ms -> 122ms (~30x).
      Anything added here must stay stateless for reuse:
      Intl.DateTimeFormat/RelativeTimeFormat/NumberFormat are safe because format()/formatToParts()
      carry no per-call state.


      Two non-obvious constraints hold the design together. (1) It must be a keyed Map, NOT a
      single-slot last-used memo: a single slot collapses to worse-than-uncached the moment a page
      renders two presets (85ms vs 3450ms on an alternating workload). (2) The `.set()` must sit
      AFTER the constructor inside the existing try, because an invalid locale (`en_US`, `!!`, `e`)
      and an unknown time zone both throw at CONSTRUCTION; insert-after-success keeps a throwing tag
      from poisoning the entry or growing the Map. `not-a-locale` is a structurally valid BCP-47 tag
      and does NOT throw, so it is useless as a negative test. Only undefined and string locales are
      keys: a locale LIST built inline is a fresh object per render and constructs a formatter per
      call instead.


      The options objects are module constants (`MEDIUM_DATE`, `SHORT_TIME`, the preset tables,
      `DATE_DEFAULTS`), so an unknown preset collapses onto the function's default entry instead of
      minting one per typo, and a default shares its formatter with the preset it equals. They are
      bindings, never `DATE_PRESETS.date.medium`: a property read at module level is a side effect
      to the bundler, which would keep both tables in apps with no dates.
  - kind: gotcha
    text: >-
      `datetime(in_timezone(ts, 'Asia/Tokyo'), 'iso')` (and `time(…, 'iso')`) prints the TARGET
      zone's wall clock with the VIEWER's offset — e.g. Tokyo's 09:00 stamped `-04:00` for a New
      York viewer — because `in_timezone` returns a shifted local Date, not a zoned value. The Intl
      presets look right because they print no offset. Known limitation of `in_timezone`'s
      shifted-Date contract; not an `iso` bug.
  - kind: gotcha
    text: >-
      `formatters/locale.js` exists because `builtins-all.js` namespace-imports `builtins.js`: any
      helper exported from builtins.js would become a library function. Keep shared helpers
      (`localeNumber`, the `formatLocale` slot) in locale.js.
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
---

# Function library (the formatter registry)

The runtime half of the template function library
([[DECISION-D174-STANDARD-FORMATTERS]], [[DECISION-D176-EXPRESSION-LANGUAGE]]
rule 4): display-only functions a template calls as `name(value, …args)`. The
registry seeds the built-ins the build selected, applies the app's own
functions over them, and hands the raw function map to render functions. The
modules keep their `formatters` names — `client-runtime/formatters.js`,
`client-runtime/formatters/` (`builtins.js`, `builtins.json`,
`builtins-all.js`, `locale.js`, `builtins_embed.go`) and the
`@magic-spells/puzzle/formatters/manifest` alias — because the compiler and the
package exports address them by those paths; "formatter" survives only in those
identifiers and in the app's `formatters` config key.

**The compiled call.** Codegen writes every library call as
`(__f["name"] || __f.__missing("name"))(…args)` (the D43 guard, name
JSON-quoted since registry keys are arbitrary strings), and render functions
receive `registry.getAll()`, never the registry instance.

**The library.** `STANDARD_FORMATTERS` in `formatters.js` lists the 19 standard
names Sites implements with the same arguments and meaning: `round`,
`currency`, `percentage`, `number_with_delimiter`, `compact_number`,
`pluralize`, `capitalize`, `truncate`, `strip_html`, `strip_newlines`,
`escape`, `raw`, `newline_to_br`, `json`, `date`, `time`, `datetime`,
`in_timezone` and `t`. `PUZZLEKIT_FORMATTERS` lists the two PuzzleKit-only
names, `link` and `timeago`. Both lists are development-only (they feed
warnings) and tree-shake out of production. The compiler's
`codegen.LibraryFunctionNames`, `puzzle check`'s signature table and
`LibraryFunctions` in `types/index.d.ts` carry the same 21 names; `types/` also
exports `DatePreset`, and `PuzzleView.events` is typed
`Record<string, (...args: any[]) => void>` so a multi-argument handler
type-checks.

**Built-ins are pure named exports** of `formatters/builtins.js`, and
`formatters/builtins.json` is the compiler-facing manifest of them — 19 names:
the 18 standard built-ins (every standard name but `t`) plus `timeago`. The Go
build embeds the manifest (`builtins_embed.go`); the usage scan
(`plugin/scan.go`) finds library functions by bare call in every expression
position — never an `@event` value's own call, which names a view handler — and
serves a virtual module importing only the built-ins the templates call
([[DECISION-D31-FORMATTER-TREESHAKE]]). The scan errs toward inclusion; `escape`
is the one safety default the registry always seeds. Raw and test imports use
the full map (`builtins-all.js`). There is no deprecated module and no size
helper: `upcase`, `downcase`, `trim`, `strip`, `replace`, `join`, `abs`,
`ceil`, `floor`, `size`, the arithmetic names, `default`, `split`, the list
formatters and `noescape` are not exports.

**Service-bound functions.** `link` (D79) needs the live router and `t` (D175)
the i18n service, so neither is a built-in. Every registry is built by one
`makeFormatterRegistry(custom, url)`: the manifest's built-ins, then the app's
functions from the `formatters` config map, then `link` only when the app did
not supply its own. `link` delegates to `router.url()` (nullish → `''`,
non-strings coerced); `PuzzleApp` passes a closure that reads `this.router`
lazily, so a re-mount never captures a stale Router, and the static kernel
builds the same registry against its per-page router. `t` is installed right
after by `installTranslate(registry, i18n)` from `client-runtime/i18n.js`, only
when the app configured `i18n` and did not register its own `t`, so
`formatters.js` never imports the i18n module. Neither `link` nor `t` enters the
manifest; the usage scan records `t` calls and their literal keys separately
(`Usage.TKeys`) for the missing-key build warning.

**Registration.** `register(name, fn)` validates both arguments and **throws**
on an empty or non-string name or a non-function value — a deterministic config
error, where skipping it silently would fall through to `__missing` and
disguise the broken config as a typo. An app function wins over a built-in of
the same name. In development, `makeFormatterRegistry` warns when an app
function registers under a standard name ("app function … shadows the standard
function of the same name") and warns differently for `raw` and
`newline_to_br`, which templates never call through the registry (codegen
lowers them to the live-HTML node, whose runtime applies
`client-runtime/sanitize.js`), so the app's function is unreachable from a
template. Overriding `link` or `timeago` draws no warning. It never throws.

**The handler-shadow warning.** Inside an `@event` value a bare call names the
view's handler; everywhere else it names the library. In development,
`PuzzleView.mount()` calls `warnHandlerShadows(view)` behind the inline
`__PUZZLE_DEV__` probe: for each key of `view.events` that names a standard
function, a PuzzleKit-only function or a function this app registered, it warns
once per view and name that the handler shadows the library function inside
`@event`. Standard names count even when the manifest tree-shook them out. The
compiler raises its own positioned warning for the same collision on standard
and PuzzleKit-only names (COMPONENT-CODEGEN's `checkHandler`).

**An unknown name** reaches `__missing(name)`, a factory: in development it
reports once per registry and name, then returns a pass-through, so a typo
renders the original value instead of crashing the view. The report is
`unknown function "x"` with a did-you-mean at edit distance at most two
(`nearestFormatter`, which the i18n service also reuses for its missing-key
suggestion); a name in `REMOVED_FORMATTERS` gets its replacement instead —
`.toUpperCase()`, `.trim()`, `.replaceAll(search, replacement)` (noting the old
function was exactly `.split(search).join(replacement)`), `.join(', ')` (noting
`.join()` alone joins with `,`), `Math.abs(x)`, `.toSorted()`, `.filter()`,
`.map()`, `.at(0)`, `.at(-1)`, `.length`, the operators, `??`, `.split()`,
`raw`; and `t` without translations says how to configure `i18n`
("t() needs translations"). The whole block, the tables and the edit-distance
search sit behind `__PUZZLE_DEV__`, so production carries none of it.

**Behavior** (D174 holds each function's contract). All built-ins fail soft on
nullish or invalid display input. The number functions that print
(`currency`, `percentage`, `number_with_delimiter`, `compact_number`,
`pluralize`) print nothing for a missing value rather than `Number(null)`'s `0`;
`round` returns a number. `round`, `currency` and `percentage` share one decimal
rounding helper that shifts the decimal string (`1.005` → `100.5`, not binary
`100.4999…`) and rounds half away from zero; `places` normalizes to an integer,
clamped to 0–100 for the `toFixed` pair and −100–100 for `round`. `escape` is an
identity on text. The `raw` and `newline_to_br` exports return the markup the
live-HTML node renders — the sanitized value, and the escaped value with a
`<br>` per line break — for script code and the conformance table; importing
either pulls the sanitizer in. `truncate` and `capitalize` work on code points,
not UTF-16 units. `json` is a hand-written serializer (keys sorted by code
point, missing / NaN / ±Infinity → `null`, a cycle → `null`), because a JS
object always enumerates integer-like keys first and so cannot carry sorted
order through `JSON.stringify`.

**Locale.** Locale-rendered output uses the viewer's locale (Intl's default),
or the app's active locale when it configures translations: the
`formatLocale` slot in `formatters/locale.js`, set only by the i18n service's
`setFormatLocale` and read behind the inline `__PUZZLE_HAS_I18N__` probe, so an
app without translations passes `undefined` exactly as before.
`number_with_delimiter` with no argument, `pluralize`'s count and `t`'s
`{count}` share `localeNumber`, one cached `Intl.NumberFormat` per
fraction-digit count, so decimals print as given; `compact_number` and
`timeago` hold one single-slot formatter each, rebuilt when the slot moves.
`date`/`time`/`datetime` take `locale ??= formatLocale`, so an explicit
argument wins. `currency` stays locale-independent.

**Dates.** The date family (`date`/`time`/`datetime`/`timeago`/`in_timezone`)
treats a bare `YYYY-MM-DD` string as a **calendar date**
([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]): one shared `parseDateInput`
constructs it as local midnight so it displays as written in every timezone,
with a round-trip check that sends rollover components back to the
Invalid-Date fail-soft path, and `in_timezone` passes it through UNSHIFTED — a
day names no instant to re-express. `date`, `time` and `datetime` share the
presets `short`, `medium`, `long` — `dateStyle`/`timeStyle` per function — and
`iso`, which is RFC 3339 in the viewer's zone (`Z` for a zero offset) and
returns the calendar date itself for a calendar-date input. With no preset,
`date` renders the medium date, `time` the short time, and `datetime` the
medium date with the short time (`DATE_DEFAULTS`). An unknown preset logs one
development `console.error` per `(function, preset)` and renders the function's
default; a retired preset name (`date(v, 'time')`) points at the function of
that name. A string-literal unknown preset never gets this far: the compiler
rejects it (`codegen/presets.go`).

**Conformance.** The identical-output rows are
`packages/puzzle-lang/conformance/functions.json` (name, input, args, expect;
JSON `null` is the missing value; a `zone` field runs a case in a child process
with that `TZ`; a `locale` field sets the function locale, as the `t` rows and
the no-preset date rows in `en` do). The language module's `conformance`
package embeds it (`go:embed`, `conformance.Functions`) beside
`expressions-parse.json`, so both hosts run the same rows pinned at the same
module version; PuzzleKit's vitest suite imports the JSON directly.

These value-level functions are unrelated to D150's `{#raw}…{/raw}` source
block, which disables brace lexing before any expression is parsed.
