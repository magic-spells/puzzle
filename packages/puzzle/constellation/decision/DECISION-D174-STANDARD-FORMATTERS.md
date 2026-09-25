---
name: >-
  D174 — The standard formatter set: 35 names in both hosts, PuzzleKit-only and Sites-only
  formatters, sanitized raw
status: built
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-TEMPLATE
  - COMPONENT-FORMATTERS
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - DECISION-D114-CALENDAR-DATE-FORMATTERS
  - DECISION-D150-RAW-TEMPLATE-BLOCK
  - DECISION-D79-LINK-FORMATTER
notes:
  - kind: state
    text: >-
      PuzzleKit groups (a) and (g) are built on `feat/formatter-set` (PR #150 into release/0.8.0):
      builtins.js/json are the 34 standard names + `timeago` + `in_timezone`; the removed names pass
      through with a dev hint naming the replacement; `STANDARD_FORMATTERS` in formatters.js drives
      the dev-only shadow warning; the conformance table lives at
      `packages/puzzle/tests/conformance/formatters.json` (not in puzzle-lang, which this branch
      does not touch) and runs from tests/formatters.test.js, zone-bearing cases in one child
      process per `TZ`; the locale-rendered defaults are pinned against real de-DE strings in a
      child process with `LC_ALL=de_DE.UTF-8`. Group (e) (sanitized `raw`/`newline_to_br`) is still
      open, so the table carries no `raw`/`newline_to_br` rows yet. Sites work is untouched. Because
      `default` is a reserved word, builtins.js exports it as the module default and the Go virtual
      manifest aliases it (`default as __puzzle_default`, recorded on D31).
  - kind: deviation
    text: >-
      Choices the card leaves open, made in the PuzzleKit build. (1), (2), (4) and (5) and the
      calendar-date half of (3) are NOT pinned by the conformance table until Cory confirms them for
      Sites; the zero-offset `Z` half of (3) IS pinned (the UTC `time`/`datetime` iso rows), because
      Go's RFC 3339 already prints `Z`. (1) `currency` of an amount that rounds to zero is unsigned
      (`-0.001` → `$0.00`; Sites prints `-$0.00`). (2) The number formatters that print text —
      `currency`, `percentage`, `number_with_delimiter`, `compact_number` and `pluralize` — print
      nothing for a missing input (V4/V6 spirit) instead of `Number(null)`'s `0`, and a non-numeric
      string passes through as text; the arithmetic ones that return a number — `round`, `plus`,
      `minus`, `times`, `abs`, `floor`, `ceil` — still coerce a missing input to `0`. (3) The `iso`
      preset returns the calendar date itself for a `YYYY-MM-DD` input in all three formatters,
      `time` included (D114 idempotence); for an instant, `iso` prints `Z` for a zero offset. (4)
      `json` prints `null` for an `undefined` object value (JSON.stringify would omit it) and for a
      cycle. (5) An unknown date preset renders as `medium` after the dev error.
---

# D174 — The standard formatter set

Decided with Cory on 2026-09-25. The decisions below are adopted. PuzzleKit
groups (a), the formatter set, and (g), standard-set alignment, are built;
group (e), sanitized `raw` and `newline_to_br`, and the Sites half of the
build list are still open. The build list at the end is the implementation
order. The formatter table in [[DOC-LANGUAGE-CORE]] records where each host
stands against this card. Core expression and rendering semantics (V1–V18)
are on [[DECISION-D173-CORE-SEMANTICS]].

## Context

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] says **a standard formatter set
behaves the same in both hosts**, and anything outside it is host-specific
and named as such. The set is implemented twice: in JavaScript
(`client-runtime/formatters/builtins.js`) and in Go
(`sites/engine/engine/formatters/*.go`). Comparing the two registries found
14 identical names, 27 that differed (F1–F27), 3 PuzzleKit-only and 20
Sites-only.

The hosts render in different places. **PuzzleKit formats in the viewer's
browser**, so it can use `Intl` with the viewer's locale and time zone.
**Sites renders entirely server-side in Go and serves static HTML**: every
Sites formatter runs in Go at render time, in the site's locale and time
zone, and no JavaScript formats anything. Anything locale-shaped is therefore
computed from two different sets of locale data.

Two principles decide the set:

- **In PuzzleKit, list shaping is JavaScript.** Cory: "all of that logic
  should be in the js in puzzlekit." Filtering, sorting, mapping and picking
  items happen in `data()` or in a plain expression (`items[0]`,
  `items.at(-1)`), never in a formatter. Sites has no script, so it keeps
  list formatters as a Sites addition.
- **The tie-breaks from D173** otherwise apply: safer for authors first, and
  when neither behavior is safer, Sites changes, because it is unpublished.

Usage today is small. PuzzleKit built-ins: `capitalize` 2 and `pluralize` 2
(blog), `date` 4, `truncate` 2, `timeago` 1, `link` 21. PK apps: `link` 83.
Sites: `currency` 9, `date` 3, `pluralize` 1, `truncate` 2, `raw` 3, `escape`
1, `upcase` 1, plus the Sites-only `image_url` 24, `image_tag` 4, `t` 33 and
`url` 5. No template in any corpus calls a built-in list formatter.

## The standard set (35 names)

Every standard name exists in both hosts with the same arguments and the same
meaning.

**Identical output (28)**, pinned by a shared conformance table (name, input,
arguments, expected output) that both hosts run:

- Numbers: `abs`, `ceil`, `floor`, `plus`, `minus`, `times`, `divided_by`,
  `modulo`, `round`, `currency`, `percentage`.
- Text: `downcase`, `upcase`, `capitalize`, `trim`, `strip`, `truncate`,
  `replace`, `split`, `strip_html`, `strip_newlines`.
- Markup: `escape`, `raw`, `newline_to_br`.
- Values: `default`, `size`, `join`, `json`.

**Locale-rendered (6)**: `date`, `time`, `datetime`, `number_with_delimiter`,
`compact_number`, `pluralize`. The name, arguments and meaning are standard;
the exact string is host-rendered, because PuzzleKit uses the browser's
`Intl` data for the viewer's locale (the app's active locale when it
configures translations, [[DECISION-D175-TRANSLATIONS]]) and Sites uses its
own Go locale data for the site's locale, and the two can differ for the same
locale. Each host pins its own outputs. Cross-host fixtures pin only what is
locale-independent: the `iso` date presets, `pluralize`'s word choice, and
`number_with_delimiter` with an explicit delimiter.

**Translation (1)**: `t`, joined by [[DECISION-D175-TRANSLATIONS]] — lookup in
the active locale then the default, the key itself on a miss, single-pass
`{name}` placeholders, and CLDR plural entries chosen by `count`. The
conformance table pins lookup, fallback, substitution and the plural choice;
`{count}` in a non-`en` locale is host-rendered like the set above. In
PuzzleKit `t` is not a built-in: the i18n service registers it when the app
configures translations.

Failure policy outside a formatter's domain is host-defined (D173 V17). The
value printed after the chain follows D173 V6.

## Behavior of each standard formatter

### Numbers

- **`divided_by(n)`, `modulo(n)`** (F7, F11): a zero divisor returns a
  missing value, which prints nothing, and the next formatter in the chain
  receives the missing value. The remainder takes the dividend's sign. No
  integer division.
- **`round(places = 0)`** (F19): rounds half away from zero on the decimal
  value; negative places round to tens and hundreds. Fixtures pin
  `1.005 | round(2)` and `2.5 | round`.
- **`currency(symbol = '$', places = 2)`** (F3): groups thousands with `,`,
  puts the sign before the symbol (`-$1,234.50`), rounds by `round`'s rule.
- **`percentage(places = 0)`** (F14): takes the number as written:
  `12.5 | percentage(1)` gives `12.5%`. A ratio is
  `ratio | times(100) | percentage`.
- **`number_with_delimiter(delimiter?)`**: groups the whole part and keeps the
  decimals as given. With no argument it follows the locale: PuzzleKit uses
  `Intl.NumberFormat` in the viewer's locale (`1.234,5` in de-DE); Sites uses
  the site locale in Go (en in v1, so `1,234.5`). An explicit delimiter
  forces it, groups in threes and keeps `.` as the decimal point, identically
  in both hosts.
- **`compact_number`** (new): shortens a large number with a localized
  suffix. PuzzleKit uses `Intl.NumberFormat(locale, { notation: 'compact' })`
  in the viewer's locale (`1.2K`, `45K`, `3.4M` in en; `1,2 mil` and
  `3,4 M` in es). Sites computes it in Go from its own per-locale suffix
  data, because neither Go's standard library nor `x/text` has compact
  notation. Sites is English-only in v1 (`1.2K`, `45K`, `3.4M`) until it
  gains locales. The exact strings are host-rendered.

### Text

- **`capitalize`** (F1): upper-cases the first character and leaves the rest
  (`iPhone` and `NASA` survive). The old PuzzleKit behavior is
  `downcase | capitalize`.
- **`truncate(length = 100, ellipsis = '…')`** (F25): counts code points; the
  result is never longer than `length` (an over-long ellipsis is clipped).
- **`replace(search, replacement = '')`** (F17): literal search, every
  occurrence. A RegExp search is a PuzzleKit addition.
- **`split(separator = ',')`** (F22): `''` splits into code points; a missing
  input gives an empty list.
- **`strip_html`** (F23): Sites' quote-aware scanner. Comments are removed, a
  `<` not followed by a tag name stays, entities are not decoded.
- **`strip_newlines`** (F24): removes CR and LF.
- **`pluralize(singular, plural = singular + 's')`** (F15): prints the count
  and the word. `{ n | pluralize('comment') }` gives `1 comment` /
  `3 comments`; the two-argument form covers irregular plurals
  (`pluralize('man', 'men')`, `pluralize('person', 'people')`). The word is
  `singular` when the count is exactly 1 and `plural` otherwise, identically
  in both hosts. The count is formatted in the locale, like
  `number_with_delimiter`: PuzzleKit uses the viewer's locale
  (`1.234 comentarios` in es-CO), Sites the site locale in Go.

### Markup and escaping

- **`escape`** (F8): its output is plain text, so the page shows the value's
  characters (`<b>` appears as `<b>`, never as `&lt;b&gt;`). In a plain
  interpolation it is an identity; after a `raw` earlier in the chain, it
  turns the value back into text.
- **`raw`** (F16): injects the value as real HTML in both hosts, **always
  through an allowlist sanitizer** (the Angular model). Safe tags and
  attributes are kept. Removed: `<script>` together with its contents, every
  `on*` attribute, `javascript:` and every other URL that is not http(s),
  `mailto:` or relative, and `<iframe>`, `<object>`, `<embed>` and `<style>`.
  The allowlist itself is shared and pinned by conformance fixtures. Its
  starting point is Sites' save-time rich-text sanitizer
  (`sites/server/internal/service/settings/richtext.go`, `SanitizeRichText`,
  built on `golang.org/x/net/html`), which already keeps document markup,
  links and images and drops scripts, embedded documents, forms and CSS.
- **`newline_to_br`** (F12): escapes its input, then emits real `<br>`
  elements for `\r\n`, `\r` and `\n`. Its output is safe by construction, so
  it needs no sanitizer, but it renders through the same markup path as
  `raw`.
- **A markup formatter is the last link of a text interpolation's chain.**
  After it, the value is markup rather than text, so a following formatter,
  or a markup formatter in an attribute or prop, is a compile error in both
  hosts. This is what lets PuzzleKit decide at compile time which
  interpolations render markup.
- **How PuzzleKit renders markup.** Codegen lowers an interpolation whose
  chain ends in `raw` or `newline_to_br` into a new runtime node kind that
  holds live HTML and re-renders when the value changes. It splits a
  coalesced text run the way an element does. The node kind and the
  sanitizer ship only in apps that use them, behind a
  `__PUZZLE_HAS_RAW_HTML__` define like the other `__PUZZLE_HAS_*__` flags,
  so hello-world does not grow. The sanitizer is DOM-free JavaScript, so the
  static and hybrid prerender (`client-runtime/ssg/`) uses the same code as
  the browser. App formatters can never inject markup: only these two
  built-in names reach the markup path.
- **How Sites renders markup.** `raw` runs a Go allowlist sanitizer at render
  time: the shared allowlist, either built on `SanitizeRichText` moved into
  the engine, or on `github.com/microcosm-cc/bluemonday` configured to it.

### Values

- **`default(fallback)`** (promoted from Sites): returns `fallback` when the
  value is missing, `false`, `''` or an empty list. Every other value,
  including `0` and an empty object, passes through. Sites changes: it
  treated `0` as falsy.
- **`size`** (F20): a list gives its item count, a string its code-point
  count, an object its key count, and anything else, missing included, `0`.
- **`join(separator = ', ')`**: unchanged, identical today.
- **`json`** (F9): object keys sorted by code point; a missing value, `NaN`
  and ±Infinity give `null`; the output is not HTML-escaped, and each host
  escapes it for where it is placed.

### Dates: `date`, `time`, `datetime` (F4–F6)

- All three take `(preset = 'medium')`, and the presets are `short`,
  `medium`, `long` and `iso`. In en-US:
  - `date`: short `9/24/26`, medium `Sep 24, 2026`, long
    `September 24, 2026`, iso `2026-09-24`.
  - `time`: short `3:04 PM`, medium `3:04:05 PM`, long adds the zone name,
    iso is the RFC 3339 time with its offset.
  - `datetime`: the date and time presets combined; iso is RFC 3339.
- **The host renders them.** PuzzleKit formats with `Intl` in the viewer's
  locale and time zone; its optional second `locale` argument stays a
  PuzzleKit addition. Sites formats in Go in the site's locale and time zone
  (en in v1); Go layout strings stay a Sites addition.
- `iso` output is identical for the same instant and zone. A `YYYY-MM-DD`
  input is a calendar day in both hosts, never shifted by a zone
  ([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]). An unknown preset is a
  development error in PuzzleKit.

## Host-only formatters

- **PuzzleKit-only (3):** `link` (router-aware,
  [[DECISION-D79-LINK-FORMATTER]]), `timeago` (needs a clock at render time),
  `in_timezone` (needs the viewer's zone). All three are inherent to a
  browser host.
- **Sites-only (24):**
  - Platform-bound (6): `url`, `asset_url`, `menu_link`, `image_url`,
    `image_srcset`, `image_tag`.
  - Pure (1): `class_map`.
  - List formatters (17): `where`, `reject`, `find`, `sort`, `sort_natural`,
    `map`, `uniq`, `reverse`, `compact`, `first`, `last`, `slice`, `sum`,
    `concat`, `push`, `contains`, `group_by`. They are usable through
    `{#let}` and in plain expressions, never in a `{#for}` header (D173 V1).
    Sites keeps their current behavior; as Sites-only names they need no
    cross-host agreement.

Totals: PuzzleKit ships 38 names (35 standard + 3), Sites 59 (35 standard +
24).

## Removed names

Removed outright, with no deprecation period. Cory: "remove them immediately.
we're the only ones using puzzle."

- **PuzzleKit removes** `sort`, `where`, `map`, `uniq`, `reverse`, `compact`,
  `first` and `last` (list shaping moves to `data()` or plain expressions:
  `items[0]`, `items.at(-1)`, a `data()` field). It keeps `join` and `size`.
  The development guard for an unknown name ([[DECISION-D43-FORMATTER-MISSING-GUARD]])
  names the replacement for each removed name.
- **Both hosts remove `noescape`**, a duplicate name for `raw`.
- **Sites removes `upper` and `lower`**, duplicates of `upcase` and
  `downcase`. `strip` stays: it is identical in both hosts and is Liquid's
  name.

## Shadowing a standard name

An app may register a formatter under a standard name, and the app's function
wins. PuzzleKit logs a **development-only warning** when it does, because the
app's templates then no longer mean what the standard name means. It does not
throw. Sites themes cannot register formatters, so the question does not
arise there. `timeago` is PuzzleKit-only, not standard, so chirp's own
`timeago` draws no warning.

## Alternatives rejected

- **Promote Sites' list formatters into the standard set.** Rejected: in
  PuzzleKit, list shaping belongs in JavaScript, where it is typed, testable
  and visible to the data layer.
- **Deprecate the removed PuzzleKit list formatters for a release first.**
  Rejected: Magic Spells is the only user, and no template calls them.
- **`pluralize` returns the noun alone**, with the count written separately.
  Rejected: the count and the word belong together, the formatter can then
  localize the count, and every call site stops repeating `{ n }`. A second,
  noun-only name was rejected as vocabulary nobody asked for.
- **Keep `raw` Sites-only**, with PuzzleKit never injecting markup from a
  value. Rejected: rich text from a CMS is a real need in both hosts, and an
  allowlist sanitizer keeps the XSS property that "a value is never
  executable markup".
- **Unsanitized `raw`** (Sites' old behavior, trusting save-time
  sanitizing). Rejected: one value that skipped the save path is an XSS hole,
  and render-time sanitizing makes the guarantee local to the formatter.
- **Identical dates, numbers and suffixes with a fixed en-US locale and UTC.**
  Rejected: a PuzzleKit app would show every reader a clock and number format
  that are not theirs. Sites cannot share the browser's `Intl` data, so exact
  locale strings stay host-rendered.
- **A fixed `,` for `number_with_delimiter`.** Rejected: the default follows
  the reader's locale; an explicit delimiter still forces one.
- **Throw at construction when an app shadows a standard name.** Rejected as
  too strict; a development warning surfaces it. Allowing it silently was
  rejected too.
- **`default` treats `0` as empty** (Sites' old behavior). Rejected: `0` is a
  real value, as in Liquid.
- **Rename every differing formatter on one side.** Rejected: it doubles the
  vocabulary for behavior nobody depends on.
- **`percentage` as a ratio.** Rejected: content authors type `12.5`, Rails
  reads the number as written, and the ratio form is one `times(100)` away.

## Build list


PuzzleKit first; Sites is lower priority because Cory is still designing it.
Groups are separate feature branches off the release branch, lettered to
match D173's build list, which holds (b), (c), (d) and (f). No group here
touches the shared parser in `packages/puzzle-lang`, the eslint/prettier
ports or the editor grammars: formatter names are not grammar.

**(a) The formatter set — PuzzleKit.**
- `client-runtime/formatters/builtins.js`, `builtins.json`,
  `builtins-all.js`: remove `sort`, `where`, `map`, `uniq`, `reverse`,
  `compact`, `first`, `last`, `noescape`; add `compact_number` and `default`;
  `pluralize` prints the count (via `Intl.NumberFormat`) and the word;
  `number_with_delimiter` defaults to the viewer's locale.
- `client-runtime/formatters.js`: drop `noescape` from the required
  built-ins; the dev-only shadow warning in `FormatterRegistry`; dev-only
  replacement hints in the `__missing` guard for removed names. Update D31's
  always-kept list.
- Examples: blog's 2 `pluralize` uses drop their separate `{ n }`; chirp and
  music switch their `compact` calls to `compact_number` (14 uses in 7
  files); chirp, music and stays delete their own `compact` formatter
  (stays registers it without using it); typed-todos, the scaffold todos
  `app.js` and the `examples/todos` README drop their unused, noun-only
  `pluralize` registration, which would now shadow the standard one. The
  scaffold template is embedded in the binary, so it ships with a binary
  rebuild.
- Tests: `tests/formatters.test.js`, a shadow-warning test, the D31
  tree-shake tests, example builds.

**(e) Sanitized `raw` and `newline_to_br` — PuzzleKit.**
- Codegen (`compiler/internal/codegen`): lower a text interpolation whose
  chain ends in `raw`/`newline_to_br` to the markup node; the compile error
  for a markup formatter mid-chain or in an attribute or prop; set the
  `__PUZZLE_HAS_RAW_HTML__` flag (`compiler/internal/build/options.go`).
- Runtime: the markup node kind in `client-runtime/views/ViewNode.js` and
  `viewManager.js` (mount, replace on change, unmount); a DOM-free sanitizer
  module shared with `client-runtime/ssg/` for static and hybrid prerender.
- Tests: the shared sanitizer fixture table (XSS vectors), codegen tests,
  SSG/static output, hybrid takeover, and `npm run measure:size` proving
  hello-world is unchanged.

**(g) Standard-set alignment — PuzzleKit.**
- `builtins.js`: F1 `capitalize`, F3 `currency`, F7 `divided_by`, F8
  `escape`, F9 `json`, F11 `modulo`, F14 `percentage`, F19 `round`, F20
  `size`, F22 `split`, F23 `strip_html`, F24 `strip_newlines`, F25
  `truncate`; dates F4–F6 (the `medium` preset and default, date-only
  `short`, the old `date`/`time`/`datetime` preset names retired, an unknown
  preset a dev error).
- Examples: `examples/todos` and the scaffold todos `TodoItem.pzl`, and
  `examples/stress` `Formatters.pzl`, switch `date('short')` to
  `datetime('short')`; stays drops its own `currency`, and its 7 call sites
  in 2 files become `currency('$', 0)`.
- The shared conformance table (a JSON file of name, input, arguments,
  expected output) run by `tests/formatters.test.js` now and by Sites' Go
  tests later. Tests: `tests/formatters.test.js`,
  `tests/formatters-timezone.test.js`.

**PuzzleKit docs, with each group:** [[DOC-SPEC-TEMPLATE]] §6,
[[COMPONENT-FORMATTERS]], the embedded agent skill
(`skills/puzzle/SKILL.md`), the README formatter list, the CHANGELOG, and the
formatter table in [[DOC-LANGUAGE-CORE]].

**Sites (later, its own repo):**
- `raw` sanitizes at render time with the shared allowlist; drop `noescape`,
  `upper`, `lower`.
- `default` keeps `0`; `compact_number` with English suffix data;
  `number_with_delimiter` and the `pluralize` count formatted by the site
  locale; dates rendered in the site's time zone.
- F9 `json` (non-finite numbers give `null`); F17 `replace`, F22 `split` and
  F25 `truncate` take their optional arguments; F20 `size` gives `0` for a
  missing value; F22 `split` gives an empty list for one.
- Run the shared conformance table from the Go formatter tests.

**Breaking changes:**
- PuzzleKit: 29. Every F-item except F17 (26: F1–F16 and F18–F27, counting
  the removals of `compact`, `map`, `noescape`, `reverse`, `sort`, `uniq`
  and `where`), plus removing `first` and `last`, plus the locale default of
  `number_with_delimiter`. Existing templates change in 14 files: blog 2
  (`pluralize`), chirp 4 and music 3 (`compact_number`), the 3
  `date('short')` files, and stays 2 (`currency('$', 0)`). The app configs of
  chirp, music, stays, typed-todos and the scaffold todos change too.
- Sites: 11. F4–F6 (the site's zone), F9, F13, F15 (the count is grouped),
  F16 (sanitized), F20, F22, `default` keeping `0`, and dropping `upper` and
  `lower`. No starter output changes: the starter's `raw` bodies are rich
  text already sanitized when saved, and its one `pluralize` counts minutes.
  The `escaping-text` test fixture's `raw` expectation may change.
