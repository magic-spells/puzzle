---
name: Formatter registry
status: verified
verified_at: '2026-07-25T05:23:34.249Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
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
      lifetime — `date` keyed on (locale, resolved preset), `timeago` on locale, `in_timezone` on
      the tz argument. Constructing them per call cost ~37us each; measured against the real
      exported date(), 100k calls went 3725ms -> 122ms (~30x). Anything added here must stay
      stateless for reuse: Intl.DateTimeFormat/RelativeTimeFormat are safe because
      format()/formatToParts() carry no per-call state. Do not cache anything that does.


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
      onto the `date` entry instead of minting one per typo.
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

# Formatter registry


Liquid-style, display-only transformations used by compiled template chains. The registry seeds built-ins, applies user registrations last (user overrides win), exposes the raw function map to render functions, and supports arbitrary string keys through bracket access.

`register(name, fn)` validates both arguments and **throws** on a non-empty-string name or a non-function value. This closes the one gap in an otherwise established config-validation pattern — `PuzzleApp` already throws for non-function lifecycle hooks and the router for non-function guards. It throws rather than warning because a non-function formatter is a deterministic config error, and skipping it silently would fall through to `__missing` and disguise the broken config as a typo. Note the asymmetry with the paragraph below, which is deliberate: a bad *name* is a typo and renders through, a bad *value* is a config error and stops.

An unknown formatter calls `__missing(name)`: warn once per registry, include a did-you-mean suggestion at edit distance at most two, and return a pass-through function. A typo therefore renders the original value instead of crashing the view.

Built-ins are pure named exports. A JSON name manifest is embedded by the Go build scanner, which serves a virtual module importing only formatters observed in project templates. The scan deliberately errs toward inclusion; `escape`, `raw`, and `noescape` remain safety defaults. Raw/test imports use the full built-in map.

One built-in is not a pure export: `link` (D79) needs the live router, so PuzzleApp registers it at mount after constructing the router — only if absent, so a user `link` from config wins. It delegates to `router.url()` (nullish → `''`, non-strings coerced, non-`/` strings pass through). The tree-shake scanner ignores the name (not on the allowlist), the same handling as any custom formatter.

All built-ins fail soft on nullish or invalid display input. Numeric precision normalizes to an integer in the `toFixed` range; date/locale/time-zone failures fall back to a string; sort copies before comparing and treats numeric arrays numerically. `raw`/`noescape` only skip formatter escaping—they do not inject HTML into text vnodes. `reverse` iterates strings by code POINT (`[...v]`, since 0.3.0), not UTF-16 code unit — `split('')` tore surrogate pairs, so emoji/astral text reversed into lone-surrogate garbage; a user-visible output change for such strings.

The date family (`date`/`time`/`datetime`/`timeago`/`in_timezone`) treats a
bare `YYYY-MM-DD` string as a **calendar date**
([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]): one shared `parseDateInput`
constructs it as local midnight so it displays as written in every timezone,
with a round-trip check that sends rollover components back to the
Invalid-Date fail-soft path, and `in_timezone` passes it through UNSHIFTED —
a day names no instant to re-express. The `iso` preset is idempotent on such
inputs; Date instances, timestamps, and full ISO datetimes parse exactly as
before.

## Measured cost: the Intl cache, and what it bought

Measured, not inferred, through [[DOC-STRESS-EXAMPLE]]'s `formatters` scenario
and the production harness ([[DECISION-D128-BENCHMARK-METHODOLOGY]]). Before
the date family cached its Intl objects, a 10,000-row re-render running
`date('short')` and `timeago` on each row constructed **10,000
`Intl.DateTimeFormat`** and **10,000 `Intl.RelativeTimeFormat`** objects — one
per formatter call — and the formatters were **91.4%** of the re-render:
376.1ms against 32.4ms for an identical tree rendering plain record strings.
That measurement priced the cache; the gotcha note on this card carries its
design constraints (keyed Maps, insert-after-success).

With the cache shipped, the same A/B reads **40.8ms against 31.4ms** — the two
formatters cost ~9ms, roughly a quarter of the formatted arm — and the
scenario's `count-intl` op asserts **zero** Intl constructions across a warmed
render. That op is the cache's regression pin in the production benchmark
baseline: a count above zero fails the run.
