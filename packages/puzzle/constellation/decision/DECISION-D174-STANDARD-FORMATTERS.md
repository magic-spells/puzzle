---
name: 'D174 — The function library: 19 standard functions, PuzzleKit-only link and timeago, sanitized raw'
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
---

# D174 — The function library

The template function library: what each standard function does, which
names are host-only, how `raw` sanitizes, and how apps register their own.
Expression semantics are [[DECISION-D173-CORE-SEMANTICS]]; call syntax is
[[DECISION-D176-EXPRESSION-LANGUAGE]]. Built in PuzzleKit
(`client-runtime/formatters/builtins.js`); Sites' Go half
(`sites/engine/engine/formatters/`) is pending. [[DOC-LANGUAGE-CORE]]'s
function table tracks where each host stands.

## Principles

- **A function presents a value; it never duplicates an operator, a method or
  a `Math` global.** `{ currency(price * qty) }`, `{ name ?? 'Anonymous' }`,
  `{ name.toUpperCase() }`, `{#for t in todos.filter(t => !t.done)}`.
- What stays is what JS cannot say in one call or what needs the framework:
  money/number presentation, locale-aware dates, markup, translation, links.
- Otherwise D173's tie-breaks: safer for authors first, else Sites changes.
- **Hosts render in different places.** PuzzleKit formats in the viewer's
  browser with `Intl` (viewer's locale and zone; the app's active locale when
  it configures translations, [[DECISION-D175-TRANSLATIONS]]). Sites renders
  server-side in Go in the site's locale and zone.

## The library

A bare call `name(args)` resolves to the library (D176 rule 4); the presented
value is the first argument. The library = standard set + host functions +
app-registered functions.

**Standard (19)**, same name, arguments and meaning in both hosts:

- **Identical output (12)**, pinned by the shared conformance table:
  `round`, `currency`, `percentage`, `capitalize`, `truncate`, `strip_html`,
  `strip_newlines`, `escape`, `raw`, `newline_to_br`, `json`, `in_timezone`.
- **Locale-rendered (6)**: `date`, `time`, `datetime`,
  `number_with_delimiter`, `compact_number`, `pluralize`. Each host pins its
  own strings; cross-host rows pin only the locale-independent parts (`iso`
  presets, no-preset defaults in `en`, `pluralize`'s word choice,
  `number_with_delimiter` with an explicit delimiter). Prerender (`hybrid`,
  `static`) prints these six and `timeago` on the build machine — its `LANG`
  (or `LC_ALL`) or `i18n.defaultLocale`, and `TZ` — then the browser
  re-renders them; pin locale and `TZ` for deterministic HTML.
- **Translation (1)**: `t(key, vars)` ([[DECISION-D175-TRANSLATIONS]]); in
  PuzzleKit the i18n service registers it only when the app configures
  translations.

**PuzzleKit-only (2)**: `link(url)` (router-aware,
[[DECISION-D79-LINK-FORMATTER]]) and `timeago(v)` (reads the clock, so a row
calling it is `volatile`, D170). An app may override either silently.

**Sites-only**: `url`, `asset_url`, `menu_link`, `image_url`, `image_srcset`,
`image_tag`, `class_map`. Sites' Liquid list formatters leave for the method
table; `uniq`, `group_by`, `sort_natural` are undecided for Sites' evaluator.

**Typing.** The compiler knows the 21 PuzzleKit names as
`codegen.LibraryFunctionNames`; `puzzle check` types them from
`libraryFunctionSignatures` in `compiler/internal/check/emitter.go` (kept
equal by `TestLibrarySignaturesMatchCodegen`); `types/index.d.ts` publishes
`LibraryFunctions` and `DatePreset`. An app function is typed
`(...args: any[]) => any` through `__puzzle_app_fn("name")(…)`, not an index
signature, so it passes `noUncheckedIndexedAccess`. Out-of-domain policy is
host-defined (D173 V17); a returned value prints by D173 V6.

## Behavior

### Numbers

- **`round(v, places = 0)`** — half away from zero on the decimal value
  (`round(1.005, 2)` → `1.01`, `round(2.5)` → `3`); negative places round to
  tens/hundreds; returns a number. A missing input coerces to `0`.
- **`currency(v, symbol = '$', places = 2)`** — `,` thousands, sign before
  the symbol (`-$1,234.50`), `round`'s rule; an amount that rounds to zero is
  unsigned (`-0.001` → `$0.00`).
- **`percentage(v, places = 0)`** — the number as written
  (`percentage(12.5, 1)` → `12.5%`); a ratio is `percentage(r * 100)`.
- **`number_with_delimiter(v, delimiter?)`** — groups the whole part, keeps
  decimals. No delimiter: locale (PuzzleKit `Intl.NumberFormat`, `1.234,5` in
  de-DE; Sites the site locale, en in v1). An explicit delimiter groups in
  threes with `.` decimal point, identically in both hosts.
- **`compact_number(v)`** — `Intl.NumberFormat(locale, { notation:
  'compact' })` in PuzzleKit (`1.2K`, `3.4M`); Sites computes it from its own
  suffix data (Go has no compact notation), English-only in v1.
- `currency`, `percentage`, `number_with_delimiter`, `compact_number` and
  `pluralize` print nothing for a missing input and pass a non-numeric string
  through as text. Arithmetic is operators and `Math.*`.

### Text

- **`capitalize(s)`** — upper-cases the first character only (`iPhone`,
  `NASA` survive).
- **`truncate(s, length = 100, ellipsis = '…')`** — counts code points, never
  splits a character, never longer than `length` (an over-long ellipsis is
  clipped). Disagrees with `.length` on non-BMP text by design (D173 V7).
- **`strip_html(s)`** — quote-aware scanner; comments removed, a `<` not
  followed by a tag name stays, entities not decoded. **Must stay linear**:
  after the first tag scan that runs off the end it uses a precomputed
  right-to-left "next unquoted `>`" table (tracking all three quote states),
  and an unterminated `<!--` means no later one terminates
  (`'<a'.repeat(40000)` ~5 ms; `tests/formatters-hardening.test.js`). Sites'
  Go port must keep it linear.
- **`strip_newlines(s)`** — removes CR and LF.
- **`pluralize(count, singular, plural = singular + 's')`** — prints the
  locale-formatted count and the word (`1 comment` / `3 comments`); the word
  is `singular` exactly when the count is 1.

### Values

- **`json(v)`** — keys sorted by code point; missing, `NaN`, ±Infinity, an
  `undefined` object value and a cycle give `null`; not HTML-escaped (the
  host escapes for placement).
- **`in_timezone(v, zone = 'UTC')`** — returns a date whose wall clock reads
  as `zone`, for `date`/`time`/`datetime` to present. A `null`/`''` zone or
  an unresolvable one renders un-shifted; PuzzleKit logs a dev error once per
  zone when `Intl` rejects it (stripped in production).

### Dates: `date`, `time`, `datetime`

- `(v, preset?, locale?)`; presets `short`, `medium`, `long`, `iso`. In en-US
  `date`: `9/24/26`, `Sep 24, 2026`, `September 24, 2026`, `2026-09-24`;
  `time`: `3:04 PM`, `3:04:05 PM`, long adds the zone, iso is RFC 3339 time;
  `datetime` combines them, iso is RFC 3339 (`Z` for a zero offset).
- **No preset**: `date` medium, `time` short, `datetime` medium date + short
  time (`Sep 24, 2026, 3:04 PM`). Intl option objects are the formatter cache
  keys, so a default and its equal preset share one formatter.
- A `YYYY-MM-DD` input is a calendar day, never zone-shifted
  ([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]); `iso` returns it unchanged in
  all three functions.
- **Unknown preset.** A string-literal preset (or an impossible literal
  `in_timezone` zone) is a positioned build *warning*
  (`codegen/presets.go`); a retired name like `date(v, 'time')` steers to
  `time(v)`. Warning, not error, because an app function under the same name
  wins and its presets are invisible. A dynamic unknown preset renders the
  default and logs a dev error once per name.
- `locale` is a PuzzleKit addition; Go layout strings are a Sites addition.

## Markup: `escape`, `raw`, `newline_to_br`

- **`escape(s)`** — output is plain text; in a text interpolation it is an
  identity.
- **`newline_to_br(s)`** — escapes `&`, `<`, `>`, then a real `<br>` per CR
  LF, CR or LF. Safe by construction; renders through `raw`'s markup path.
- **`raw(html)`** — injects real HTML in both hosts, **always through an
  allowlist sanitizer**. The allowlist, attribute rules and canonical output
  are pinned by the `raw` conformance rows (rich text that must survive, then
  an XSS corpus that must come out inert):
  - **Tags kept:** `a abbr address b bdi bdo blockquote br caption cite code
    col colgroup dd del details dfn div dl dt em figcaption figure h1–h6 hr i
    img ins kbd li mark ol p pre q s samp small span strike strong sub summary
    sup table tbody td tfoot th thead time tr u ul var wbr`.
  - **Attributes kept:** `class`, `id`, `title`, `lang`, `dir` on any kept
    tag; `a` `href target`; `img` `src srcset alt width height`; `ol`
    `start reversed`; `li` `value`; `td` `colspan rowspan`; `th` `colspan
    rowspan scope`; `col`/`colgroup` `span`; `time`/`del`/`ins` `datetime`;
    `details` `open`. Never `style`, an author `rel`, `on*`, or **`name`**
    (stripping `name` keeps `document.<name>` and form named properties
    unclobberable).
  - **`id`** kept verbatim (heading anchors, styling) except **never on
    `<img>`** (a form-listed element; it would shadow `form.action` etc.) and
    **never starting with `__`** (protects `window.__PUZZLE_*`). Remaining
    documented risk for untrusted HTML: a kept id becomes `window[id]` when
    no such global exists, and can collide with app ids. `class` lets content
    use app CSS (overlay risk, not code execution) — docs say to render
    untrusted HTML in a `contain: layout paint` container.
  - **`target`** kept only as `_blank` (any case, after reference decoding),
    re-emitted as `target="_blank"` plus `rel="noopener noreferrer"`, decided
    by a flag, never by searching emitted text.
  - **URLs** (`href`, `src`, `srcset`) survive only relative or `http(s)`;
    `mailto:`/`tel:` on `<a href>` only. The scheme is read as the URL parser
    does: after reference decoding, leading C0 controls and spaces
    (U+0000–U+0020) stripped, every tab/newline removed. `srcset` is checked
    token by token (every whitespace- or comma-separated token) and dropped
    whole on any failure. A failing URL attribute is dropped.
  - **Dropped with contents:** `script style iframe noscript noembed noframes
    textarea title xmp` (to their end tag, as the tokenizer does);
    `template object applet svg math select head frameset` (to the balancing
    end tag); `plaintext` (rest of the value). **Unwrapped:** every other tag
    (`form`, `button`, custom elements…); void ones (`input`, `link`, `meta`,
    `base`, `embed`) vanish.
  - **Canonical output:** tags lowercase; attributes in source order, first
    of a repeated name wins, double-quoted, valueless as `name=""`, forced
    `rel` last; in text `<`/`>` escaped and `&` escaped unless it starts a
    well-formed reference (`&name;`, `&#N;`, `&#xH;`), which passes through;
    plain attribute values the same plus `"`; URL and `id` values re-emitted
    from their decoded form (URLs trimmed) with `& < > "` escaped. The decoder
    knows only `amp lt gt quot apos nbsp colon Tab NewLine` by name plus all
    numeric references; unknown named references stay literal. Comments,
    doctypes, CDATA, PIs, a tag cut off at the end, and stray end tags are
    dropped (in constant time: open tags counted per name); tags still open
    at the end are closed; NUL removed.
- **Placement rule.** `raw` and `newline_to_br` may only be **the outermost
  call of a text interpolation, with one argument**: `{ raw(post.body) }`.
  Anywhere else is a positioned compile error in both hosts (nested in a call
  or operator, attribute, prop, marker argument, condition, `{#for}` header,
  handler argument), as is a markup interpolation inside a raw-text element
  (`script style textarea title noscript xmp iframe noembed noframes
  plaintext`) or foreign content (anywhere under `<svg>`/`<math>`, down to
  `<foreignObject>`). Component children and `<Snippet>` bodies are checked in
  the context of the element around the component; only a `<Portal>` body
  resets it. This is why an app function can never inject markup.
- **PuzzleKit rendering.** `compiler/internal/codegen/markup.go` checks
  placement, then lowers to `new ViewNode('#html', { value })` (`br: true`
  for `newline_to_br`); the argument takes V6 coercion and the markup
  function is never called through the registry (an app function named
  `raw`/`newline_to_br` is unreachable and draws a dev warning). The node is
  a non-text sibling for D168 whitespace. `client-runtime/views/html.js`
  holds the position with an empty comment and owns the parsed nodes after
  it (parsed via an inert `<template>`; unchanged value touches nothing;
  keyed moves carry the range; the patcher never reconciles inside).
  `__PUZZLE_HAS_RAW_HTML__` gates the node (either name called) and
  `__PUZZLE_HAS_RAW_SANITIZE__` gates `client-runtime/sanitize.js` (`raw`
  called; DOM-free tokenizer, no top-level side effects). Neither used →
  nothing ships; `newline_to_br` only ≈ 0.4 KB gzip; `raw` ≈ 2.3 KB. A
  `'#html'` vnode in a build without the node define fails loudly; a `raw`
  vnode without the sanitizer renders nothing, never unsanitized markup. SSG
  (`client-runtime/ssg/serialize.js`) emits the same `htmlOf()` string.
  `raw`/`newline_to_br` stay in `builtins.js` for script code and
  conformance but never enter the function manifest.
- **Sites, pending:** sanitize at render time (today it trusts save-time
  `SanitizeRichText`) to the same rows — widen `SanitizeRichText` or
  configure bluemonday (no default `rel="nofollow"`, no extra schemes). Go
  gotchas: `x/net/html` decodes every reference and re-escapes quotes, so
  pass well-formed references through; `strings.TrimSpace` misses
  U+0001–U+0008 and U+000E–U+001F in the scheme check.

## Removed names

Removed outright (no deprecation release). A call reaches the unknown-name
guard ([[DECISION-D43-FORMATTER-MISSING-GUARD]]), which passes the value
through and names the replacement in development (`REMOVED_FORMATTERS` in
`client-runtime/formatters.js`); a `| name` steers the same way
(`RemovedFormatters` in `packages/puzzle-lang/expr/errors.go`). Keep the two
tables in step:

`upcase`/`downcase`, `trim`/`strip`, `replace` (→ `.replaceAll()`; the old
function was `.split(a).join(b)`), `join` (→ `.join(', ')`; old default was
`', '`), `abs`/`ceil`/`floor` (→ `Math.*`), `sort`/`where`/`map`/`reverse`/
`compact`/`first`/`last` (→ array methods, `.at()`), `uniq` (→ `data()`),
`size` (→ `.length`), `plus`/`minus`/`times`/`divided_by`/`modulo` (→
operators), `default` (→ `??`), `split` (→ `.split()`), `noescape` (→ a plain
`{ value }`; Sites maps it to `raw`). Sites also drops `upper`/`lower`.

## Registration and shadowing

- **Apps register through the `formatters` config map** (the key keeps its
  name; no `app.formatter()`), called bare: `{ specialFormat(x) }`. Order:
  manifest-selected built-ins, then app functions over them, then the
  router-backed `link` only if the app provided none. Runtime modules keep
  `formatters` names because they are compiler-facing
  ([[COMPONENT-FORMATTERS]]).
- **An app function under a standard name wins**, with a dev warning ("app
  function … shadows the standard function"), never a throw. No warning for
  `link`/`timeago`. Under `raw`/`newline_to_br` it is unreachable, and the
  warning says so. Sites themes cannot register functions.
- **A view handler sharing a library name.** In an `@event` value a bare call
  names the handler; everywhere else, the library. The compiler warns
  (`checkHandler` in `markup.go`) when an `@event` names a handler after a
  library function, and `warnHandlerShadows` (dev, once per view and name)
  warns when a `view.events` key names a standard, PuzzleKit-only or
  app-registered function.

## Conformance

`packages/puzzle-lang/conformance/functions.json`, embedded as
`conformance.Functions` so Sites pins rows at the puzzle-lang tag;
PuzzleKit's vitest imports it. Zone-bearing rows run one child process per
`TZ`; no-preset date rows carry `locale: 'en'`. Not yet pinned (awaiting
Sites confirmation): the unsigned zero `currency`, missing-input printing for
the text-printing number functions, the calendar-date half of `iso`, `json`'s
`undefined`/cycle → `null`, and the unknown-dynamic-preset default.

## Alternatives rejected

- **Formatter pipes / keeping duplicate names as functions** — two ways to say
  one thing; the method table and operators already cover them.
- **Drop `round`** — `Math.round` takes no places; `.toFixed()` rounds the
  binary value (`1.005` → `1.00`) and returns a padded string.
- **`in_timezone` PuzzleKit-only** — nothing else re-expresses an instant in
  another zone, and Sites has zones.
- **Promote Sites' list formatters to standard** — list shaping is the method
  table in both hosts.
- **`pluralize` returns the noun alone** — the count and word belong together
  and the count gets localized.
- **`raw` Sites-only, or unsanitized** — rich text is a real need in both
  hosts; render-time sanitizing keeps "a value is never executable markup"
  local to the function.
- **DOMPurify** — several times the whole markup path's size and needs a DOM
  the prerender lacks. A tokenizer suffices because output is re-written from
  names with escaped, double-quoted values, never copied.
- **Wrapper element for markup** — changes the author's markup and breaks
  selectors; a position comment costs one node.
- **Strip `class`/`id`** — app-authored rich text needs them (Cory: "it should
  keep class and ID").
- **A fixed denylist of `document`/form property ids, or `user-content-`
  prefixes** — with `name` stripped `document` is unreachable; the `<img>`
  and `__` rules close the real surfaces; Cory wants ids verbatim.
- **Any `target` value** — named targets set `window.name` (XSS gadget);
  `_top`/`_parent` escape frames.
- **Fixed en-US/UTC output** — every reader would see a format not theirs.
- **Throw when an app shadows a standard name** — too strict; dev warning.
- **`percentage` as a ratio** — authors type `12.5`.
- **Rename the registration key to `functions`** — kept `formatters` for now.
