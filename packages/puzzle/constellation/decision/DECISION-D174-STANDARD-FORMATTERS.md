---
name: >-
  D174 — The standard formatter set: proposed resolutions for F1–F27, renames and host-only
  formatters (PROPOSED, not decided)
status: planned
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-TEMPLATE
  - COMPONENT-FORMATTERS
  - COMPONENT-CODEGEN
  - DECISION-D173-CORE-SEMANTICS
---


# D174 — The standard formatter set

> **PROPOSED. Nothing on this card is decided.** This is batch 4 of the
> dialect-divergence proposals; batches 1, 2, 3 and 5 (V1–V18) are on
> [[DECISION-D173-CORE-SEMANTICS]]. Until Cory approves an item, the formatter
> table in [[DOC-LANGUAGE-CORE]] stands and neither host changes.

## Context

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] says **a standard formatter set
behaves identically in both hosts**. It is implemented twice, in
`client-runtime/formatters/builtins.js` and in
`sites/engine/engine/formatters/*.go`. Anything outside that set is
host-specific and named as such. [[DOC-LANGUAGE-CORE]] compared the two
registries: 14 names are identical, 27 differ (F1–F27), 3 are PuzzleKit-only
and 20 are Sites-only. This card proposes one behavior for each differing
name, then the resulting standard set, the renames and removals, and which
formatters stay host-only.

It uses the tie-breaks from D173: safer for authors first; PuzzleKit scripts
stay real JavaScript; when neither behavior is safer, Sites changes, because it
is unpublished. It also builds on three D173 proposals:

- **V3:** there is one absent value.
- **V6:** `NaN`, ±Infinity and objects print as nothing.
- **V7:** the formatters count text in code points, even though PuzzleKit's
  `.length` counts UTF-16 units.

**How the formatters are used today** (the corpus is described on D173). Uses
are few:

- **PuzzleKit built-ins:** `capitalize` 2 and `pluralize` 2 (blog), `date` 4
  (todos, the scaffold todos, stress, blog), `truncate` 2, `timeago` 1 and
  `link` 21.
- **PK apps:** `link` 83. No other built-in is used.
- **Sites:** `currency` 9, `date` 3, `pluralize` 1, `truncate` 2, `raw` 3,
  `escape` 1, `upcase` 1, plus the Sites-only `image_url` 24, `image_tag` 4,
  `t` 33 and `url` 5.
- **Shadowed names:** several PuzzleKit examples register an app formatter
  under a built-in name, so their template uses never reach the built-in. The
  `compact` in chirp, music and stays is a number shortener (13 uses). The
  `currency` in stays rounds to whole dollars (7 uses). typed-todos
  `pluralize` and chirp `timeago` are the other two. See J4.

## Proposals by formatter

Each entry gives the single proposed behavior, why, the host that changes,
whether that is breaking, and the templates affected.

### Numbers

- **F3 `currency(symbol = '$', places = 2)`: unify on Sites.** Groups
  thousands with `,`, puts the sign before the symbol (`-$1,234.50`), and
  rounds by the F19 rule. *Why:* that is the standard way to show money;
  PuzzleKit's `$-5.00` and ungrouped `$12345.00` are not. *Changes:*
  PuzzleKit. *Breaking:* PuzzleKit. *Templates:* none. PuzzleKit makes 0
  built-in calls (the 7 stays uses run its own formatter, which does exactly
  what the new standard `currency('$', 0)` does), and the 9 Sites uses in 4
  files are unchanged.
- **F7 `divided_by(n)`: unify on Sites.** A zero divisor returns absent, which
  renders empty, and the next formatter in the chain receives absent.
  *Why:* `Infinity` is never a display value, and under V6 it would print
  empty anyway; absent is the honest value. *Changes:* PuzzleKit.
  *Breaking:* PuzzleKit, in edge cases only. *Templates:* none found.
  Neither host does Liquid's integer division, and this card does not add
  it.
- **F11 `modulo(n)`: unify on Sites,** exactly as F7. The remainder takes the
  dividend's sign, as it already does in both hosts. *Changes:* PuzzleKit.
  *Breaking:* PuzzleKit, in edge cases only. *Templates:* none found.
- **F14 `percentage(places = 0)`: unify on Sites.** It takes the number as
  written, so `12.5 | percentage(1)` gives `12.5%`, and a ratio is written
  `ratio | times(100) | percentage`. *Why:* this matches how people type
  percentages into content, and Rails' `number_to_percentage`. The ratio form
  is one `times(100)` away, so no second name is needed. *Changes:*
  PuzzleKit. *Breaking:* PuzzleKit. *Templates:* none found (0 uses in any
  corpus).
- **F19 `round(places = 0)`: unify on Sites.** Rounds half away from zero on
  the decimal value, and negative places round to tens and hundreds. Shared
  fixtures pin the algorithm, including `1.005 | round(2)` and `2.5 | round`.
  PuzzleKit's `toFixed` gets `1.005` wrong, because it rounds the binary
  value. *Changes:* PuzzleKit, plus Sites if its `roundNumber` misses a
  pinned fixture. *Breaking:* PuzzleKit, in edge cases only. *Templates:*
  none found.

### Text

- **F1 `capitalize`: unify on Sites.** The first character is upper-cased and
  the rest is left as it is, so `iPhone` and `NASA` survive. *Why:* this
  never destroys data, and PuzzleKit's current behavior can still be written
  as `downcase | capitalize`; the reverse cannot be written. *Changes:*
  PuzzleKit. *Breaking:* PuzzleKit. *Templates:* none change. The 2 blog
  uses capitalize lowercase role names, which give the same output either
  way.
- **F8 `escape`: unify on Sites.** It returns the value as plain text, so the
  page shows the value's characters (`<b>` appears as `<b>`), never entity
  text such as `&lt;b&gt;`. In PuzzleKit that makes it an identity, since
  text nodes never inject markup. In Sites it removes the trusted-markup mark.
  *Changes:* PuzzleKit. *Breaking:* PuzzleKit. *Templates:* none found (1
  Sites fixture, 0 PuzzleKit).
- **F15 `pluralize(singular, plural = singular + 's')`: unify on PuzzleKit.**
  *Needs Cory's judgment (J2).* It returns the noun alone: `singular` for
  exactly 1, `plural` otherwise. *Why:* the bare noun is the building block.
  `{ n } { n | pluralize('minute') }` works, and so does `<b>{ n }</b>`
  followed by the noun. A count baked into the result cannot be taken back
  out. *Changes:* Sites. *Breaking:* Sites. *Templates:* 1 Sites starter file
  changes. In `starter/company/sections/post-article.pzl`,
  `reading_minutes | pluralize('minute')` must become the count followed by
  the pluralized noun. The 2 PuzzleKit blog uses already write the count
  separately; under Sites' rule they would print "3 3 comments".
- **F17 `replace(search, replacement = '')`: unify.** The search is literal
  and every occurrence is replaced. The replacement is optional, as in
  PuzzleKit, so Sites relaxes its argument count. A RegExp search stays a
  PuzzleKit addition, since the core has no regex literal. *Changes:* Sites.
  *Breaking:* no. *Templates:* none found.
- **F23 `strip_html`: unify on Sites.** Uses Sites' quote-aware scanner:
  comments are removed, a `<` that is not followed by a tag name stays, and
  entities are not decoded. PuzzleKit ports the scanner in place of its
  regex. *Changes:* PuzzleKit. *Breaking:* PuzzleKit, in edge cases only.
  *Templates:* none found.
- **F24 `strip_newlines`: unify on Sites.** Removes both CR and LF.
  *Changes:* PuzzleKit. *Breaking:* PuzzleKit, in edge cases only.
  *Templates:* none found.
- **F25 `truncate(length = 100, ellipsis = '…')`: unify.** It counts code
  points, and the result is never longer than `length`: an ellipsis longer
  than `length` is clipped. The optional length comes from PuzzleKit, so
  Sites relaxes its argument count. The counting unit and the clipping come
  from Sites, so PuzzleKit changes. *Breaking:* PuzzleKit, for text outside
  the BMP and for an ellipsis longer than `length`. *Templates:* none change.
  The 2 PuzzleKit and 2 Sites uses all pass an explicit length on BMP text.
- **F18 `reverse`: unify on PuzzleKit.** It reverses a list, and reverses a
  string by code point; Sites adds the string case. *Changes:* Sites.
  *Breaking:* no (Sites returned absent for a string). *Templates:* none
  found.
- **F20 `size`: unify on a merge.** A list gives its item count, a string its
  code-point count, an object its key count, and anything else, including
  absent, gives `0`. The unit comes from Sites; the `0` comes from
  PuzzleKit, because "0 items" beats an empty gap. *Changes:* both.
  *Breaking:* both, in edge cases only. *Templates:* none found.
- **F22 `split(separator = ',')`: unify.** `''` splits into code points, and
  absent gives an empty list. The optional separator comes from PuzzleKit
  (Sites relaxes its argument count). An absent input gives an empty list in
  both hosts, instead of PuzzleKit's `['']` and Sites' absent, so a missing
  value loops zero times and has size 0. *Changes:* both. *Breaking:*
  PuzzleKit, in edge cases only. *Templates:* none found.

### Lists and data

- **F2 `compact`: unify on PuzzleKit.** It drops absent items and `''`.
  *Why:* `compact` exists to feed `join` without `, ,` gaps, and `''` is as
  empty on the page as absent. Liquid drops nil only; the difference is noted
  for authors. *Changes:* Sites. *Breaking:* Sites, in edge cases only.
  *Templates:* none found. There are 0 built-in uses; all 13 PuzzleKit
  `compact` uses run the examples' own number shortener.
- **F9 `json`: unify.** Object keys are sorted by code point, which Sites
  already does and cannot avoid, since Go maps have no insertion order. Absent
  gives `null`, as in Sites. `NaN` and ±Infinity give `null`, as in
  `JSON.stringify`; Sites' encoder errors on them today. The output is not
  HTML-escaped; each host escapes it for where it is placed. *Changes:* both.
  *Breaking:* both, in edge cases only (key order in PuzzleKit).
  *Templates:* none found.
- **F10 `map(path)`: unify on Sites.** It takes a dotted path
  (`'fields.title'`). *Changes:* PuzzleKit. *Breaking:* PuzzleKit, only for a
  key that itself contains a dot. *Templates:* none found.
- **F21 `sort(path?)`: unify on one total order.** The key is a dotted path
  and the sort is stable. The order is absent, then booleans, then numbers
  (numeric, with `NaN` treated as absent), then dates (chronological), then
  text (code-point order), then lists and objects (which keep their relative
  order). This is Sites' ranking with dates added; PuzzleKit compares dates
  already. *Changes:* both. *Breaking:* both, in edge cases only
  (mixed-type lists). *Templates:* none found.
- **F26 `uniq`: unify on PuzzleKit.** Scalars are deduplicated by strict
  equality (`NaN` equals `NaN`), and lists and objects by identity; Sites adds
  the identity case. *Changes:* Sites. *Breaking:* Sites, in edge cases only.
  *Templates:* none found.
- **F27 `where(path, value?)`: unify on Sites.** The key is a dotted path.
  With a value, it keeps the items whose path strictly equals that value (one
  absent value, V3). With no value, it keeps the items whose path is truthy.
  *Why:* PuzzleKit's one-argument form compares against `undefined`, which is
  a bug, not a design. *Changes:* PuzzleKit. *Breaking:* PuzzleKit.
  *Templates:* none found.

### Dates (F4 `date`, F5 `time`, F6 `datetime`) — *needs Cory's judgment (J1)*

- **PROPOSED: a shared vocabulary, rendered by the host.** All three take
  `(preset = 'medium')`, and the presets are `short`, `medium`, `long` and
  `iso`. In an en-US render, the patterns are Sites' current ones:
  - `date`: short `9/24/26`, medium `Sep 24, 2026`, long `September 24, 2026`,
    iso `2026-09-24`.
  - `time`: short `3:04 PM`, medium `3:04:05 PM`, long adds the zone name,
    iso is the RFC 3339 time with its offset.
  - `datetime`: the date and time presets combined; iso is RFC 3339.
  - `iso` is identical in both hosts (shared fixtures). A `YYYY-MM-DD` input
    is a calendar day in both hosts, never shifted by a zone (D114).

  The **locale and time zone are host-defined**, because they belong to the
  render environment. PuzzleKit renders in the viewer's zone and locale, and
  its optional second `locale` argument stays a PuzzleKit addition. Sites
  renders in the value's own offset (UTC for epoch seconds) and in the site
  locale (en-US in v1). Sites' Go layout strings stay a Sites addition. An
  unknown preset is a development error in PuzzleKit; today it silently falls
  back to the default.
- **Why:** both hosts can match exactly only if both render in a fixed locale
  and a fixed zone. That is wrong for a browser app, where the reader expects
  their own clock. The preset names and argument shape can be identical,
  which is what authors actually move between hosts.
- **Changes:** PuzzleKit. The `date`, `time` and `datetime` preset names
  retire, `medium` is added and becomes the default, and `short` for `date`
  becomes date-only (PuzzleKit's `short` includes the time today). Sites:
  none.
- **Breaking:** PuzzleKit. **Templates:** 3 PuzzleKit files change:
  `examples/todos` and the scaffold todos `TodoItem.pzl`, plus
  `examples/stress` `Formatters.pzl`, all of which use `date('short')` and
  would lose the time unless they switch to `datetime('short')`. The
  scaffold template is embedded in the binary, so this ships only with a
  binary rebuild. The blog's `date('long')` gives the same en-US output. The
  3 Sites uses are unchanged.
- **The question:** accept "standard vocabulary, host-rendered" as a declared
  exception to identical behavior, or require identical output by fixing
  en-US and UTC in PuzzleKit too?

### Markup formatters (F8 is above; F12 `newline_to_br`, F13 `noescape`, F16 `raw`) — *needs Cory's judgment (J3)*

- **PROPOSED: Sites-only.** PuzzleKit removes all three, and a use becomes a
  positioned error with a fix-it. For `raw` and `noescape` the message says
  PuzzleKit never injects markup from a value, and points to `{#svg}` or a
  `ref`. For `newline_to_br` it points to the `whitespace-pre-line` utility.
- **Why:** all three produce or inject trusted markup. PuzzleKit's invariant
  is that an interpolation becomes a text node, so in PuzzleKit `raw` and
  `noescape` do nothing and `newline_to_br` shows a literal `<br>`: the same
  spelling with a different meaning.
- **Changes:** PuzzleKit. **Breaking:** PuzzleKit. **Templates:** none in
  PuzzleKit (0 uses). The 3 Sites `raw` uses (1 starter file, 2 fixtures) are
  unchanged.
- **The question:** should PuzzleKit ever gain trusted-markup injection (a
  marked value rendered through a parsed fragment), which would make all
  three standard? The recommendation is no. It gives up the XSS property
  that PuzzleKit has kept since v1, and `{#svg}` covers the static case.

## The proposed standard set

These 48 names behave the same in both hosts, pinned by shared input/output
fixtures. Failure policy outside a formatter's domain is host-defined (D173
V17).

- **Identical today (14):** `abs`, `ceil`, `downcase`, `first`, `floor`,
  `join`, `last`, `minus`, `number_with_delimiter`, `plus`, `strip` (an alias
  of `trim`), `times`, `trim`, `upcase`.
- **Unified by this card (21):** `capitalize`, `compact`, `currency`,
  `divided_by`, `escape`, `json`, `map`, `modulo`, `percentage`, `pluralize`,
  `replace`, `reverse`, `round`, `size`, `sort`, `split`, `strip_html`,
  `strip_newlines`, `truncate`, `uniq`, `where`.
- **Promoted from Sites (10):** `default`, `slice`, `sum`, `contains`,
  `concat`, `push`, `reject`, `find`, `sort_natural`, `group_by`. PuzzleKit
  adds them with Sites' current behavior, pinned by fixtures. They are pure,
  and PuzzleKit's per-name tree-shaking means an app that doesn't use them
  pays nothing. Open detail: Sites' `default` treats `0` as falsy; Liquid
  keeps `0`. The fixtures should settle this before PuzzleKit copies it.
- **Shared vocabulary, host-rendered (3):** `date`, `time`, `datetime`, if J1
  is approved as recommended.

That is 45 identical names plus 3 host-rendered ones.

## Host-only formatters

- **PuzzleKit-only (3):** `link` (router-aware), `timeago` (needs a clock at
  render time), `in_timezone` (needs the viewer's zone). All three are
  inherent to a browser host.
- **Sites-only (11):** `url`, `asset_url`, `menu_link`, `image_url`,
  `image_srcset`, `image_tag` and `t` are platform-bound: site URLs, the
  image pipeline and locale strings. `class_map` is pure, and a candidate for
  promotion later. `raw`, `noescape` and `newline_to_br` are markup (J3).

## Renames and removals

- **No standard formatter is renamed.** `percentage` (F14) and `pluralize`
  (F15) were the rename candidates. Each settles on one behavior instead,
  because the other behavior is one formatter away (`times(100)`, or writing
  the count yourself).
- **Removed spellings:**
  - Sites drops its aliases `upper` and `lower`, keeping one name per
    function (`upcase`, `downcase`). There are 0 uses.
  - PuzzleKit drops `raw`, `noescape` and `newline_to_br` (J3). There are 0
    uses.
  - PuzzleKit's date preset names `date`, `time` and `datetime` retire in
    favor of `short`, `medium`, `long` and `iso` (J1).
- **App formatters that shadow a standard name (J4).** Under the
  recommendation, the examples change:
  - chirp, music and stays `compact` becomes `compact_number`.
  - stays drops its own `currency`; its 7 call sites become `currency('$', 0)`.
  - typed-todos drops its own `pluralize`, which matches the standard.
  - chirp's `timeago` shadows a PuzzleKit-only built-in, not a standard name,
    so it may stay. Renaming it is still clearer.

## Needs Cory's judgment

- **J1 — dates:** accept "standard vocabulary, host-rendered", with locale
  and zone belonging to the host, or require identical output with a fixed
  locale and zone?
- **J2 — `pluralize`:** noun only (recommended; Sites' 1 starter use
  changes), or count plus noun (PuzzleKit's 2 blog uses change)? A third
  option is noun-only `pluralize` plus a new count-prefixed name.
- **J3 — markup formatters:** keep `raw`, `noescape` and `newline_to_br`
  Sites-only (recommended), or give PuzzleKit trusted-markup injection?
- **J4 — shadowing:** may an app register a formatter under a standard name?
  The recommendation is no: `PuzzleApp` throws at construction when a
  `formatters` key names a standard formatter, because an app that redefines
  `compact` breaks the "same name, same behavior" promise for everyone who
  reads its templates. The milder options are a development warning, or
  allowing it and documenting it. Four examples change under the
  recommendation: chirp, music, stays and typed-todos.
- **J5 — scope of promotion:** should all 10 Sites list formatters plus
  `default` join the standard set (recommended), or should PuzzleKit keep
  its "filtering belongs in `data()`" stance and leave them Sites-only?

## Alternatives considered

- **Rename every differing formatter on one side.** For example, PuzzleKit
  keeps its behavior under new names and Sites keeps the originals. Rejected:
  it doubles the vocabulary for behavior nobody depends on (almost every
  F-item has 0 uses), and it leaves the standard set small.
- **`percentage` as a ratio (PuzzleKit's behavior).** It is equally
  composable (`divided_by(100)`), but content authors type `12.5`, and Rails
  reads the number as written. With 0 uses anywhere, the tie-break favors
  Sites.
- **Identical dates with a fixed en-US locale and UTC.** Rejected (J1): a
  PuzzleKit app would show every reader a clock that is not theirs.
- **PuzzleKit markup injection** (J3): rejected for now, on XSS grounds.
- **Keep `upper`/`lower` as standard aliases in both hosts.** Rejected: two
  names for one function add nothing. `strip` stays only because it is
  already identical in both hosts and is Liquid's name.

## Consequences

If approved, the build list is:

**PuzzleKit** ([[COMPONENT-FORMATTERS]]):
- `builtins.js` rewrites F1, F3, F4–F6, F7, F8, F9, F10, F11, F14, F19, F20,
  F21, F22, F23, F24, F25 and F27.
- It adds the 10 promoted formatters and removes `raw`, `noescape` and
  `newline_to_br`, each with a steering diagnostic.
- Update the `builtins.json` manifest, which drives tree-shaking.
- Add the shadowing check in `PuzzleApp` (J4).
- Update examples: stays, chirp, music and typed-todos configs; todos and
  stress switch to `datetime('short')`. The scaffold todos template needs a
  binary rebuild at release.
- Update docs: [[DOC-SPEC-TEMPLATE]] §6, COMPONENT-FORMATTERS, the formatter
  list in the embedded agent skill, and the standard-formatter table in
  [[DOC-LANGUAGE-CORE]].

**Sites:**
- F2 `compact`, F9 `json` (non-finite numbers), F15 `pluralize`, F17
  `replace` (argument count), F18 `reverse` (strings), F20 `size` (absent
  gives 0), F21 `sort` (dates), F22 `split` (argument count and absent), F25
  `truncate` (argument count), F26 `uniq` (identity).
- Drop `upper` and `lower`.
- Fix the starter theme's `post-article.pzl` `pluralize` call.

**Shared:** a formatter conformance table (name, input, arguments, expected
output), run by the `builtins.js` tests and by the Go formatter tests. This is
what makes "standard" checkable.

**Breaking-change count under the recommended answers:**
- PuzzleKit: 22 of the 27 items (F1, F3, F4, F5, F6, F7, F8, F9, F10, F11,
  F12, F13, F14, F16, F19, F20, F21, F22, F23, F24, F25, F27). Existing
  templates change in 3 files, the `date('short')` uses, plus the 4 example
  configs under J4. Everything else has 0 uses.
- Sites: 6 of the 27 items (F2, F9, F15, F20, F21, F26), plus dropping
  `upper`/`lower`. Existing templates change in 1 file, the starter
  `pluralize`.
