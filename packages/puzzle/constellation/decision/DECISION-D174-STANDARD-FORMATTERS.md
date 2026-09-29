---
name: >-
  D174 — The function library: 19 standard functions in both hosts, PuzzleKit-only link and timeago,
  Sites-only functions, sanitized raw
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
  - kind: deviation
    text: >-
      Choices the card leaves open, made in the PuzzleKit build. (1), (2), (4) and (5) and the
      calendar-date half of (3) are NOT pinned by the conformance table until Cory confirms them for
      Sites; the zero-offset `Z` half of (3) IS pinned (the UTC `time`/`datetime` iso rows), because
      Go's RFC 3339 already prints `Z`. (1) `currency` of an amount that rounds to zero is unsigned
      (`-0.001` → `$0.00`; Sites prints `-$0.00`). (2) The number functions that print text —
      `currency`, `percentage`, `number_with_delimiter`, `compact_number` and `pluralize` — print
      nothing for a missing input (V4/V6 spirit) instead of `Number(null)`'s `0`, and a non-numeric
      string passes through as text; `round`, which returns a number, still coerces a missing input
      to `0`. (3) The `iso` preset returns the calendar date itself for a `YYYY-MM-DD` input in all
      three date functions, `time` included (D114 idempotence); for an instant, `iso` prints `Z` for
      a zero offset. (4) `json` prints `null` for an `undefined` object value (JSON.stringify would
      omit it) and for a cycle. (5) An unknown dynamic date preset renders the function's own
      default after the dev error.
  - kind: gotcha
    text: >-
      `strip_html` stays Sites' quote-aware scanner, output-identical to the earlier implementation
      (differentially checked on 200k random inputs), but LINEAR: after the first tag scan that runs
      off the end it switches to a precomputed right-to-left table of "next unquoted `>` from here"
      (tracking all three quote states, since a later `<` scans from outside any quote), and a
      `<!--` with no `-->` means no later one has one. `'<a'.repeat(40000)` went from ~6 s to ~5 ms.
      Sites' Go port must keep it linear. Tests: tests/formatters-hardening.test.js.
---

# D174 — The function library

Decided with Cory on 2026-09-25; the library took its function form with
[[DECISION-D176-EXPRESSION-LANGUAGE]] (2026-09-28). The PuzzleKit half is
built on `release/0.8.0`; the Sites half of the build list is open. The
function table in [[DOC-LANGUAGE-CORE]] records where each host stands
against this card. Core expression and rendering semantics (V1–V18) are on
[[DECISION-D173-CORE-SEMANTICS]].

## Context

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] says **a standard function set
behaves the same in both hosts**, and anything outside it is host-specific
and named as such. The set is implemented twice: in JavaScript
(`client-runtime/formatters/builtins.js`) and in Go
(`sites/engine/engine/formatters/*.go`).

The hosts render in different places. **PuzzleKit formats in the viewer's
browser**, so it can use `Intl` with the viewer's locale and time zone.
**Sites renders entirely server-side in Go and serves static HTML**: every
Sites function runs in Go at render time, in the site's locale and time
zone. Anything locale-shaped is therefore computed from two different sets of
locale data.

Three principles decide the set:

- **A function presents a value; it never duplicates an operator, a method or
  a `Math` global** (D176). The expression language has `+ - * / %`, `??`,
  `.length`, the string and array method table and `Math.*`, so a name any of
  those already spells is not a function: `{ currency(price * qty) }`,
  `{ name ?? 'Anonymous' }`, `{ name.toUpperCase() }`,
  `{#for t in todos.filter(t => !t.done)}`.
- **What stays is what JavaScript cannot say in one call, or what needs the
  framework:** money and number presentation, locale-aware dates, markup,
  translation, links.
- **The tie-breaks from D173** otherwise apply: safer for authors first, and
  when neither behavior is safer, Sites changes, because it is unpublished.

## The library

A bare call `name(args)` in a template resolves to the library (D176 rule 4);
the value being presented is the first argument. The library is the standard
set, the host's own functions, and the functions an app registers.

**Standard (19)** — the same name, arguments and meaning in both hosts:

- **Identical output (12)**, pinned by the shared conformance table (name,
  input, arguments, expected output) that both hosts run: numbers `round`,
  `currency`, `percentage`; text `capitalize`, `truncate`, `strip_html`,
  `strip_newlines`; markup `escape`, `raw`, `newline_to_br`; values `json`,
  `in_timezone`.
- **Locale-rendered (6)**: `date`, `time`, `datetime`,
  `number_with_delimiter`, `compact_number`, `pluralize`. The name, arguments
  and meaning are standard; the exact string is host-rendered, because
  PuzzleKit uses the browser's `Intl` data for the viewer's locale (the app's
  active locale when it configures translations,
  [[DECISION-D175-TRANSLATIONS]]) and Sites uses its own Go locale data for
  the site's locale. Each host pins its own outputs. Cross-host rows pin only
  what is locale-independent: the `iso` date presets, the no-preset defaults
  in `en`, `pluralize`'s word choice, and `number_with_delimiter` with an
  explicit delimiter. PuzzleKit's `hybrid` and `static` prerender prints these
  six and `timeago` on the build machine — in its locale (`LANG`, or `LC_ALL`
  when set) and time zone (`TZ`), or in `i18n.defaultLocale` when the app
  configures translations, the zone still `TZ` — and the browser re-renders
  them in the viewer's; deterministic HTML needs the locale and `TZ` pinned
  on the build machine.
- **Translation (1)**: `t(key, vars)`, defined by
  [[DECISION-D175-TRANSLATIONS]]. In PuzzleKit `t` is not a built-in: the
  i18n service registers it when the app configures translations.

**PuzzleKit-only (2)**: `link(url)` (router-aware,
[[DECISION-D79-LINK-FORMATTER]]) and `timeago(v)` (reads the clock at render
time, so a list row that calls it is `volatile`, D170). Both are inherent to a
browser host, and an app may override either without a warning.

The compiler knows the 21 names as `codegen.LibraryFunctionNames`; `puzzle
check` types them from `libraryFunctionSignatures` in the check emitter, kept
equal to that list by `TestLibrarySignaturesMatchCodegen`; `types/index.d.ts`
publishes the same signatures as `LibraryFunctions` plus `DatePreset`. An
app-registered function is typed `(...args: any[]) => any`, through a call
(`__puzzle_app_fn("name")(…)`) rather than an index signature, so it
type-checks under `noUncheckedIndexedAccess`.

Failure policy outside a function's domain is host-defined (D173 V17). The
value a call returns prints by D173 V6.

## Behavior of each standard function

### Numbers

- **`round(v, places = 0)`** (F19): rounds half away from zero on the decimal
  value; negative places round to tens and hundreds; returns a number, so
  another function can keep formatting it. Fixtures pin `round(1.005, 2)` →
  `1.01` and `round(2.5)` → `3`. It stays in the library because JavaScript
  cannot say it in one call: `Math.round` takes no places, and `.toFixed()`
  rounds the binary value (`(1.005).toFixed(2)` is `1.00`) and returns a
  padded string.
- **`currency(v, symbol = '$', places = 2)`** (F3): groups thousands with `,`,
  puts the sign before the symbol (`-$1,234.50`), rounds by `round`'s rule.
- **`percentage(v, places = 0)`** (F14): takes the number as written:
  `percentage(12.5, 1)` gives `12.5%`. A ratio is `percentage(ratio * 100)`.
- **`number_with_delimiter(v, delimiter?)`**: groups the whole part and keeps
  the decimals as given. With no delimiter it follows the locale: PuzzleKit
  uses `Intl.NumberFormat` in the viewer's locale (`1.234,5` in de-DE); Sites
  uses the site locale in Go (en in v1, so `1,234.5`). An explicit delimiter
  forces it, groups in threes and keeps `.` as the decimal point, identically
  in both hosts.
- **`compact_number(v)`**: shortens a large number with a localized suffix.
  PuzzleKit uses `Intl.NumberFormat(locale, { notation: 'compact' })` in the
  viewer's locale (`1.2K`, `45K`, `3.4M` in en; `1,2 mil` and `3,4 M` in es).
  Sites computes it in Go from its own per-locale suffix data, because neither
  Go's standard library nor `x/text` has compact notation; it is English-only
  in v1 until Sites gains locales.
- Arithmetic is the operators and `Math.*` (D176); division by zero is the
  host's number semantics (D173 V5), not a function's concern.

### Text

- **`capitalize(s)`** (F1): upper-cases the first character and leaves the
  rest (`iPhone` and `NASA` survive). Lower-casing the rest first is
  `capitalize(s.toLowerCase())`.
- **`truncate(s, length = 100, ellipsis = '…')`** (F25): counts code points,
  never UTF-16 units, so it never splits a character; the result is never
  longer than `length` (an over-long ellipsis is clipped). On text outside the
  Basic Multilingual Plane it and `.length` count differently by design (D173
  V7).
- **`strip_html(s)`** (F23): Sites' quote-aware scanner, in linear time.
  Comments are removed, a `<` not followed by a tag name stays, entities are
  not decoded.
- **`strip_newlines(s)`** (F24): removes CR and LF.
- **`pluralize(count, singular, plural = singular + 's')`** (F15): prints the
  count and the word. `pluralize(n, 'comment')` gives `1 comment` /
  `3 comments`; the third argument covers irregular plurals
  (`pluralize(n, 'man', 'men')`). The word is `singular` when the count is
  exactly 1 and `plural` otherwise, identically in both hosts. The count is
  formatted in the locale, like `number_with_delimiter`: PuzzleKit uses the
  viewer's locale (`1.234 comentarios` in es-CO), Sites the site locale.

### Markup and escaping


- **`escape(s)`** (F8): its output is plain text, so the page shows the
  value's characters (`<b>` appears as `<b>`, never as `&lt;b&gt;`). In a
  text interpolation it is an identity.
- **`raw(html)`** (F16): injects the value as real HTML in both hosts,
  **always through an allowlist sanitizer** (the Angular model). Cory: "make
  it safe if you can." The allowlist is shared and pinned by the `raw` rows of
  the conformance table — rich text that must survive, then an XSS corpus in
  which every case must come out inert. It grew from Sites' save-time
  rich-text sanitizer (`sites/server/internal/service/settings/richtext.go`,
  `SanitizeRichText`), which keeps document markup, links and images and
  drops scripts, embedded documents, forms and CSS, and its attribute rules
  follow DOMPurify's defaults. Cory, on `class` and `id`: "it should keep
  class and ID."
  - **Tags kept:** `a`, `abbr`, `address`, `b`, `bdi`, `bdo`, `blockquote`,
    `br`, `caption`, `cite`, `code`, `col`, `colgroup`, `dd`, `del`,
    `details`, `dfn`, `div`, `dl`, `dt`, `em`, `figcaption`, `figure`,
    `h1`–`h6`, `hr`, `i`, `img`, `ins`, `kbd`, `li`, `mark`, `ol`, `p`,
    `pre`, `q`, `s`, `samp`, `small`, `span`, `strike`, `strong`, `sub`,
    `summary`, `sup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `time`,
    `tr`, `u`, `ul`, `var`, `wbr`.
  - **Attributes kept:** `class`, `id`, `title`, `lang` and `dir` on any kept
    tag (with the `id` exceptions below); `a` `href`, `target`; `img` `src`,
    `srcset`, `alt`, `width`, `height`; `ol` `start`, `reversed`; `li`
    `value`; `td` `colspan`, `rowspan`; `th` `colspan`, `rowspan`, `scope`;
    `col`/`colgroup` `span`; `time`/`del`/`ins` `datetime`; `details` `open`.
    Never `style`, an author `rel`, or any `on*` handler — and **never
    `name`, for good**: `name` is what makes an element reachable as
    `document.<name>` and through a form's named properties, and keeping it
    stripped is what leaves `document` unclobberable (0 of 511 probed names
    reach it with `name` gone).
  - **`class`** lets sanitized content use the app's CSS. That is the point
    for HTML the app's own editors write; for untrusted user HTML it is a
    UI-overlay risk (a `fixed inset-0 z-50` block covering the page or faking
    a dialog), not code execution. The docs tell authors to render untrusted
    HTML inside a container with `contain: layout paint`.
  - **`id`** is kept verbatim, for heading anchors and styling, with two
    exceptions. **Never on `<img>`**: it is the one kept tag that is a
    form-associated "listed" element, so `<img id="action">` inside the app's
    own `<form>` would shadow `form.action` (about 473 form properties are
    reachable that way). **Never starting with `__`**: that keeps the
    framework's `window.__PUZZLE_*` globals and dev hooks out of reach. The
    value is checked and re-emitted decoded, so the browser sees the string
    that was checked. The remaining risk, documented for untrusted HTML: any
    other kept id becomes a `window[id]` named property when no global of
    that name exists (`<a id="CONFIG" href>` shadows an undefined
    `window.CONFIG` the app reads optionally), and a user id can collide with
    the app's own ids — skip-link targets, `label for`, `aria-labelledby`.
  - **`target` on `<a>`** is kept only as `_blank` (any case, after
    character-reference decoding), re-emitted as `target="_blank"`, and the
    link then gets `rel="noopener noreferrer"`; any other value is dropped (a
    named target sets `window.name` in the opened page, a known XSS gadget,
    and `_top`/`_parent` escape a frame). An author `rel` is always
    discarded, and the forced `rel` is decided by a flag set when `target` is
    kept, never by searching the emitted attribute text.
  - **URLs** in `href`, `src` and `srcset` (and `action`, `formaction` and
    `xlink:href`, should the allowlist ever keep them) survive only when
    relative or `http(s)`; `mailto:` and `tel:` survive on an `<a href>`
    only. The scheme is read the way the URL parser reads it: after
    character-reference decoding, with every leading C0 control or space
    (U+0000–U+0020, which JavaScript's `trim()` does not all cover) removed
    and every tab and newline removed, so `JaVaScRiPt:`, `java&#x09;script:`,
    `javascript&colon;` and `&#1;javascript:` are all caught. A `srcset` is
    checked token by token — every whitespace- or comma-separated token, so
    a candidate URL is checked wherever the srcset parser could start one —
    and dropped whole when any token fails. A failing URL attribute is
    dropped.
  - **Dropped with their contents:** `script`, `style`, `iframe`, `noscript`,
    `noembed`, `noframes`, `textarea`, `title` and `xmp` (scanned to their end
    tag, as the browser's tokenizer does); `template`, `object`, `applet`,
    `svg`, `math`, `select`, `head` and `frameset` (skipped to the balancing
    end tag); `plaintext` (the rest of the value).
  - **Unwrapped** (the tag goes, its text and kept descendants stay): every
    other tag — `form`, `button`, `label`, `font`, `body`, custom elements. A
    void one (`input`, `link`, `meta`, `base`, `embed`) simply disappears.
  - **Canonical output** (what the conformance rows pin, so both hosts emit
    the same bytes): kept tags re-emitted lowercase; attributes in source
    order, the first of a repeated name winning (as in the browser), always
    double-quoted, a valueless one as `name=""`, `target` always as
    `target="_blank"`, and a forced `rel="noopener noreferrer"` appended
    last; in text, `<` and `>` escaped and `&` escaped unless it begins a
    well-formed character reference (`&name;`, `&#N;`, `&#xH;`), which passes
    through for the browser to decode; plain attribute values the same, plus
    `"`; URL and `id` values re-emitted from their decoded form (URLs also
    trimmed) with `&`, `<`, `>` and `"` escaped, so the browser reads exactly
    the string that was checked. The decoder knows only `amp`, `lt`, `gt`,
    `quot`, `apos`, `nbsp`, `colon`, `Tab` and `NewLine` by name, plus every
    numeric reference; an unknown named reference stays literal, for the
    checker and — because the `&` is re-escaped — for the browser. Comments,
    doctypes, CDATA and processing instructions are dropped, as is a tag cut
    off by the end of the value; a stray end tag is dropped (in constant
    time: open tags are counted per name); every tag still open at the end is
    closed, so a value cannot leak formatting into the page around it; NUL
    characters are removed.
- **`newline_to_br(s)`** (F12): escapes its input (`&`, `<`, `>`), then emits
  a real `<br>` for each CR LF, CR and LF. Its output is safe by construction,
  so it needs no sanitizer, but it renders through the same markup path as
  `raw`.
- **The markup placement rule.** `raw` and `newline_to_br` return markup, not
  text, so each may only be **the outermost call of a text interpolation**,
  with exactly one argument: `{ raw(post.body) }`,
  `{ newline_to_br(note.text) }`. Anywhere else is a positioned compile error
  at the call, in both hosts: nested inside another call or operator, in an
  attribute value, a prop, a marker argument, a condition, a `{#for}` header
  or a handler argument. So is a markup interpolation inside a raw-text
  element (`<script>`, `<style>`, `<textarea>`, `<title>`, `<noscript>`,
  `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<plaintext>`) or inside
  foreign content — anywhere in an `<svg>` or `<math>` subtree, down to an SVG
  `<foreignObject>`, which hosts HTML again — because the prerendered page
  would parse the markup as SVG/MathML while the runtime inserts HTML nodes. A
  component's children and `<Snippet>` bodies are checked in the context of
  the element around the component (it renders inline); only a `<Portal>` body
  resets it. This rule is what lets PuzzleKit decide at compile time which
  interpolations render markup, and it is why an app function can never
  inject markup.
- **How PuzzleKit renders markup.** Codegen
  (`compiler/internal/codegen/markup.go`) checks every placement before
  emission, then lowers a markup interpolation to
  `new ViewNode('#html', { value })` (`br: true` for `newline_to_br`): the
  argument compiles as any expression does, the value takes the D173 V6
  display coercion, and the markup function itself is never called through
  the registry — an app function registered as `raw` or `newline_to_br` is
  unreachable from templates and draws a development warning. The node is a
  non-text sibling under the D168 whitespace rule, like an element. At
  runtime (`client-runtime/views/html.js`) the node holds its position with an
  empty comment and owns the parsed nodes right after it: mount parses the
  sanitized markup through an inert `<template>`, a changed value replaces the
  owned nodes, an unchanged one touches nothing, removal takes the whole
  range, and a keyed move carries it; the patcher never reconciles inside it.
  Two defines gate it, both set by the usage scan: the node behind
  `__PUZZLE_HAS_RAW_HTML__` (either name called) and the sanitizer
  (`client-runtime/sanitize.js`, a small DOM-free tokenizer plus the
  allowlist, with no top-level side effects) behind
  `__PUZZLE_HAS_RAW_SANITIZE__` (`raw` called). An app that uses neither ships
  nothing, a `newline_to_br`-only app pays about 0.4 KB gzip, and a `raw` app
  about 2.3 KB. A `'#html'` vnode that reaches a build with the node's define
  false fails loudly at the metadata-tag guard; a `raw` vnode in a build
  without the sanitizer renders nothing, never unsanitized markup. The static
  and hybrid prerender (`client-runtime/ssg/serialize.js`) emits the same
  `htmlOf()` string the browser parses, and takeover re-mounts over it. `raw`
  and `newline_to_br` stay in `builtins.js`, returning those markup strings
  for script code and the conformance table, but they never enter the
  function manifest.
- **How Sites renders markup.** Sites injects `raw` unsanitized today,
  trusting save-time sanitizing, and must sanitize at render time with the
  same allowlist, the same `id`, `target` and `name` rules, and the same
  canonical output: either `SanitizeRichText` moved into the engine and
  widened to the allowlist above, or `github.com/microcosm-cc/bluemonday`
  configured to it (`AllowAttrs("class", "id")` with an id filter for
  `<img>` and `__`, `target` matched to `_blank` only with the rel forced,
  and no `name`). Either way the shared `raw` and `newline_to_br`
  conformance rows are the contract. Details to watch:
  `golang.org/x/net/html` decodes every character reference and re-escapes
  quotes and apostrophes in text, so a renderer built on `html.Render` must
  pass well-formed references through and escape only what the canonical
  rules name; a Go scheme check must strip leading C0 controls the way the
  URL parser does (`strings.TrimSpace` misses U+0001–U+0008 and
  U+000E–U+001F); and bluemonday's defaults add `rel="nofollow"` and keep
  more URL schemes, both of which the rows reject.

### Values

- **`json(v)`** (F9): object keys sorted by code point; a missing value, `NaN`
  and ±Infinity give `null`; the output is not HTML-escaped, and each host
  escapes it for where it is placed.
- **`in_timezone(v, zone = 'UTC')`**: re-expresses an instant in another zone
  and returns a date whose wall clock reads as that zone, for `date()`,
  `time()` or `datetime()` to present: `datetime(in_timezone(ts, 'Asia/Tokyo'))`.
  It is standard because nothing in the expression language re-expresses an
  instant in another zone; the conformance rows compare the wall clock the
  result reads as (`YYYY-MM-DDTHH:MM:SS`). An omitted zone keeps the `'UTC'`
  default; a `null` or `''` zone (an unset `user.timezone`) renders the date
  un-shifted with no error. A zone the host cannot resolve renders the date
  un-shifted too, and in PuzzleKit it is a development error when `Intl`
  rejects it (`'America/New_Yrok'`, which passes the compile-time shape
  check): logged once per zone through the warn-once ledger the unknown-preset
  errors share, and stripped from production. An invalid date with a valid
  zone is not reported.

### Dates: `date`, `time`, `datetime` (F4–F6)

- Each is `(v, preset?, locale?)`, and the presets are `short`, `medium`,
  `long` and `iso`. In en-US:
  - `date`: short `9/24/26`, medium `Sep 24, 2026`, long
    `September 24, 2026`, iso `2026-09-24`.
  - `time`: short `3:04 PM`, medium `3:04:05 PM`, long adds the zone name,
    iso is the RFC 3339 time with its offset.
  - `datetime`: the date and time presets combined; iso is RFC 3339.
- **With no preset** (D176 rule 4): `date(v)` is the medium date
  (`Sep 24, 2026`), `time(v)` the short time (`3:04 PM`), and `datetime(v)`
  the medium date with the short time (`Sep 24, 2026, 3:04 PM`) — a pairing
  no named preset spells; `datetime(v, 'medium')` keeps medium/medium. The
  Intl options objects are PuzzleKit's formatter cache keys, so a default and
  the preset it equals share one formatter.
- **An unknown preset.** A string-literal preset the standard function does
  not know is a positioned build warning in PuzzleKit (`codegen/presets.go`),
  and so is a string-literal `in_timezone` zone that cannot be a zone id (a
  space, an empty string, a leading digit); a retired preset name —
  `date(v, 'time')` — says to call `time(v)` instead. It warns rather than
  fails because an app function registered under a standard name wins
  (*Registration and shadowing*), and the compiler cannot see which presets
  that function takes. A dynamic preset the standard function does not know
  renders the function's default; in development it also logs an error, once
  per preset name.
- **The host renders them.** PuzzleKit formats with `Intl` in the viewer's
  locale and time zone; the optional `locale` argument is a PuzzleKit
  addition. Sites formats in Go in the site's locale and time zone (en in
  v1); Go layout strings stay a Sites addition.
- `iso` output is identical for the same instant and zone. A `YYYY-MM-DD`
  input is a calendar day in both hosts, never shifted by a zone
  ([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]).

## Sites-only functions

- **Platform-bound (6):** `url`, `asset_url`, `menu_link`, `image_url`,
  `image_srcset`, `image_tag`; and **`class_map`**. Sites provides them the
  way a PuzzleKit app registers its own functions.
- **Open for Sites' evaluator (P6):** Sites' Liquid-heritage list formatters
  (`where`, `reject`, `find`, `sort`, `sort_natural`, `map`, `uniq`,
  `reverse`, `compact`, `first`, `last`, `slice`, `sum`, `concat`, `push`,
  `contains`, `group_by`) and `split`. The method table now spells most of
  them in both hosts (`filter`, `find`, `toSorted`, `map`, `toReversed`,
  `at(0)`, `at(-1)`, `slice`, `concat`, `includes`, `reduce`, `.split()`), so
  by this card's first principle they leave; Sites decides the rest (`uniq`,
  `group_by`, `sort_natural`) when it builds the evaluator. Not decided.

## Removed names

Removed outright, with no deprecation period in a published release. Cory:
"remove them immediately. we're the only ones using puzzle." A call to a
removed name reaches PuzzleKit's unknown-name guard
([[DECISION-D43-FORMATTER-MISSING-GUARD]]), which passes the value through and
names the replacement in development (`REMOVED_FORMATTERS` in
`client-runtime/formatters.js`).

| Removed | Write instead |
|---|---|
| `upcase` / `downcase` | `.toUpperCase()` / `.toLowerCase()` |
| `trim`, `strip` | `.trim()` |
| `replace(a, b)` | `.replaceAll(a, b)` for plain strings. The old function was exactly `.split(a).join(b)`; `.replaceAll()` differs on a missing replacement (it inserts `undefined`), on `$` patterns in the replacement, and on an empty search. |
| `join(sep)` | `.join(', ')`. The old default separator was `', '`; `.join()` with no argument joins with `,`. |
| `abs` / `ceil` / `floor` | `Math.abs(x)` / `Math.ceil(x)` / `Math.floor(x)` |
| `sort`, `where`, `map`, `reverse`, `compact`, `first`, `last` | `.toSorted()`, `.filter()`, `.map()`, `.toReversed()`, `.filter(x => x != null)`, `.at(0)`, `.at(-1)` |
| `uniq` | dedupe the list in `data()` |
| `size` | `.length` |
| `plus`, `minus`, `times`, `divided_by`, `modulo` | the operators |
| `default` | `??` |
| `split` | `.split()` |
| `noescape` | `raw` |

Sites also removes `upper` and `lower`, its own duplicates of `upcase` and
`downcase`, and with them the names above.

## Registration and shadowing

- **An app registers functions through the `formatters` config map**, which
  keeps its name (there is no `app.formatter()` method), and templates call
  them bare: `{ specialFormat(product.title) }`. Registration order: the
  manifest-selected built-ins, then the app's functions over them, then the
  router-backed `link` only when the app did not provide one.
- **An app function under a standard name** wins, with a development warning
  ("app function … shadows the standard function"), never a throw, because
  the app's templates then no longer mean what the standard name means. Under
  `link` or `timeago` there is no warning: overriding a PuzzleKit-only name is
  ordinary. Under `raw` or `newline_to_br` the function is unreachable from
  templates, and the warning says so. Sites themes cannot register functions,
  so the question does not arise there.
- **A view handler that shares a library name.** Inside an `@event` value a
  bare call names the view's handler; everywhere else it names the library
  (D176 rule 4). Cory: "we should throw a warning if there are two with the
  same name." PuzzleKit warns twice over: the compiler's positioned warning
  when an `@event` names a handler after a standard or PuzzleKit-only function
  (`checkHandler` in `markup.go`), and a development warning at mount,
  once per view and name, when a key of `view.events` names a standard,
  PuzzleKit-only or app-registered function (`warnHandlerShadows`, behind
  `__PUZZLE_DEV__`).

## Alternatives rejected

- **The 27-name formatter set, applied with `|` pipes** (`{ price | currency }`,
  `{ name | upcase }`, `{ tags | join }`). Rejected by
  [[DECISION-D176-EXPRESSION-LANGUAGE]]: pipes are a second syntax beside
  JavaScript, and nine of the names only re-spelled a JavaScript method or a
  `Math` global.
- **Keep the nine covered names as functions**, or deprecate them for a
  release. Rejected: two ways to say one thing, the duplication the pipe set
  was rejected for; no published release carried them as functions, and the
  corpus migration rewrote every use.
- **Drop `round` too.** Rejected: `Math.round` takes no places, and
  `.toFixed()` rounds the binary value (`1.005` → `1.00`) and returns a padded
  string, so neither says "round to two places" correctly in one call.
- **Keep `in_timezone` PuzzleKit-only.** Rejected: nothing in the expression
  language re-expresses an instant in another zone, and Sites has zones too.
- **Rename the registration to `app.function()` or a `functions` config key.**
  Rejected for now: the `formatters` key keeps its name.
- **Promote Sites' list formatters into the standard set.** Rejected: list
  shaping is the method table in both hosts.
- **Keep the Liquid arithmetic formatters, `default` and `size`.** Rejected:
  each duplicated an operator or a property the expression language has;
  zero templates used any of them.
- **`pluralize` returns the noun alone**, with the count written separately.
  Rejected: the count and the word belong together, the function can then
  localize the count, and every call site stops repeating `{ n }`.
- **Keep `raw` Sites-only**, with PuzzleKit never injecting markup from a
  value. Rejected: rich text from a CMS is a real need in both hosts, and an
  allowlist sanitizer keeps the XSS property that "a value is never
  executable markup".
- **Unsanitized `raw`** (Sites' old behavior, trusting save-time
  sanitizing). Rejected: one value that skipped the save path is an XSS hole,
  and render-time sanitizing makes the guarantee local to the function.
- **DOMPurify as PuzzleKit's sanitizer.** Rejected: it is several times the
  size of the whole markup path, and it needs a DOM, which the static and
  hybrid prerender does not have. A tokenizer is enough because the output
  is re-written, never copied: every kept tag and attribute is re-emitted
  from its name with escaped, double-quoted values, and no RAWTEXT element,
  `<template>`, `<noscript>` or foreign content is ever emitted, so a
  browser parsing the output reads exactly the tags and attributes the
  sanitizer wrote. Its attribute defaults are kept (`class`, `id`,
  `target`), with the `id` and `target` rules above.
- **A wrapper element for the markup node** (`<span>` or a custom element).
  Rejected: it changes the markup the author wrote, breaks child selectors
  and block content inside inline wrappers; a position comment plus an
  owned node range costs one comment.
- **Strip `class` and `id` from sanitized markup.** Rejected by Cory ("it
  should keep class and ID"): rich text from the app's own editors needs its
  classes and anchor ids, DOMPurify keeps both by default, and the overlay
  risk is not code execution.
- **A fixed list of `document`/`<form>` property names to drop as ids.**
  Rejected after the PR #155 security review: with `name` stripped,
  `document` is not reachable by id at all, while the reachable surfaces — an
  `<img id>` inside the app's own `<form>` and `window[id]` for undefined
  globals — were not what it listed. Dropping `id` on `<img>` and ids starting
  with `__` closes the first and protects the framework's own globals.
- **GitHub-style `user-content-` id prefixing.** Rejected: Cory wants ids kept
  verbatim, so in-content anchors and CSS keep working.
- **Keep any `target` value.** Rejected: a named target sets `window.name` in
  the opened page and `_top`/`_parent` escape a frame; `_blank` is the one
  value rich text needs.
- **Rename every differing function on one side.** Rejected: it doubles the
  vocabulary for behavior nobody depends on.
- **Identical dates, numbers and suffixes with a fixed en-US locale and UTC.**
  Rejected: a PuzzleKit app would show every reader a clock and number format
  that are not theirs.
- **A fixed `,` for `number_with_delimiter`.** Rejected: the default follows
  the reader's locale; an explicit delimiter still forces one.
- **Throw at construction when an app shadows a standard name.** Rejected as
  too strict; a development warning surfaces it.
- **`percentage` as a ratio.** Rejected: content authors type `12.5`, Rails
  reads the number as written, and the ratio form is one `* 100` away.

## Build

**PuzzleKit — built on `release/0.8.0`.** Groups lettered to match D173's:
(a) the set (list-shaping names removed, `compact_number` added, `pluralize`
prints the count), (e) sanitized `raw` and `newline_to_br` (`markup.go`,
`sanitize.js`, `views/html.js`, the two defines), (g) standard-set alignment
(F1–F25 behavior, the date presets), then D176 P3 (the registry becomes the
function library: `STANDARD_FORMATTERS`, the `time`/`datetime` defaults,
`warnHandlerShadows`, the `t` key rule, `LibraryFunctions` types) and P4 (the
nine covered names deleted from `builtins.js`, `builtins.json` and the
conformance rows; `formatters/deprecated.js` and the size helper deleted; the
literal preset check). The runtime modules keep their `formatters` names
(`client-runtime/formatters.js`, `client-runtime/formatters/`, the
`@magic-spells/puzzle/formatters/manifest` alias) because they are
compiler-facing ([[COMPONENT-FORMATTERS]]).

**Conformance:** `packages/puzzle-lang/conformance/functions.json`, embedded
by the `conformance` package (`conformance.Functions`), so Sites pins the rows
at the puzzle-lang tag; PuzzleKit's vitest suite imports the file.
Zone-bearing rows run in one child process per `TZ`; the no-preset date rows
carry `locale: 'en'`.

**PuzzleKit docs:** [[DOC-SPEC-TEMPLATE]] §6, [[COMPONENT-FORMATTERS]], the
embedded agent skill (`skills/puzzle/SKILL.md`), the README, the CHANGELOG,
and the function table in [[DOC-LANGUAGE-CORE]].

**Sites (later, its own repo):**
- The 19 standard functions in Go with the same arguments, called from its
  evaluator (D176 P6), passing the shared conformance rows; `in_timezone` is
  new to Sites.
- `raw` sanitizes at render time with the same allowlist, attribute rules and
  canonical output (above), and the compile rules follow: a markup function is
  only the outermost call of a text interpolation, never inside a raw-text
  element or foreign content. Drop `noescape`, `upper`, `lower`, `size`, the
  arithmetic names and `default`.
- `compact_number` with English suffix data; `number_with_delimiter` and the
  `pluralize` count formatted by the site locale; dates rendered in the site's
  time zone, with the D176 no-preset defaults.
