---
name: 'D173 — Core semantics: one meaning for each shared construct across PuzzleKit and Sites (V1–V18)'
status: built
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-TEMPLATE
  - COMPONENT-FORMATTERS
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - DECISION-D168-TEXT-RUN-WHITESPACE
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D167-COMPONENT-FAMILIES
notes:
  - kind: state
    text: >-
      2026-09-25: build groups (d) slot rules and (f) value printing are BUILT in PuzzleKit on
      feat/slot-and-print-rules (PR into release/0.8.0). V14: `isFilled` in viewManager.js
      `expandChildList`: a PLACEHOLDER_TAG vnode and whitespace-only text do not fill. It gates the
      plain default/named arm, the D71 forwarding arm (which forwards the wrapper's own fallback)
      and each snippet stamp. SSG/static share expandSlots. V13: `walkBranches` in
      puzzle-lang/parser/slot.go walks each exclusive {#if}/{#case} branch against its own copy of
      the markers on the path, then merges the result back. The eslint/prettier ports carry no slot
      check, so they did not change. V6/V9: display.js `displayValue(value, expression, sep)`.
      setAttr and serializeAttrs omit an object attribute and pass sep ' ' for a list. Controlled
      `value` also joins a list with spaces, because V9 says "on an element" and a
      property/attribute split would diverge from Sites. D127's "null brace-only attribute renders
      ''" wording was wrong: removal is the rule, and D127, SPEC §6 and LANGUAGE-CORE now state it.
      Cost: +87 B gzip hello-world, +80 B todos (not size-neutral). DOC-LANGUAGE-CORE marks
      V6/V9/V13/V14 as "PuzzleKit follows the core" until Sites changes.
  - kind: deviation
    text: >-
      V6 as built in PuzzleKit: (1) a FUNCTION (and a symbol) is not treated as an "object". It
      still prints as String() would. JS functions are objects, but guarding them costs bytes on
      every interpolation, and no correct template prints one. (2) A `Date` IS an object here, so `{
      post.createdAt }` on a Puzzle.date() field now prints nothing (plus the dev warning) instead
      of the locale string. The corpus scan found no such template. Authors format it with `| date`.
      Flag this if Sites treats a date as a scalar. (3) V14 applies to snippet stamps too: a stamp
      that renders nothing shows the marker's fallback for that stamp. This follows the card's
      "content supplied for it renders at least one node" literally. D166 said only "when nothing
      fills the position".
  - kind: deviation
    text: >-
      Addendum to the V6 deviation note above (PR #151 review). (2) is wider than Date. Every object
      prints nothing, whatever `toString` it defines. That includes a `URL`, a Decimal
      (decimal.js/big.js), a Temporal value, a Luxon DateTime, and any app class with a custom
      `toString`. Each used to print through String(), and each now needs a formatter or an explicit
      field/method in `data()`. Cory keeps "a Date prints nothing" as built. A Date gets its own
      dev-only warning ("format it with | date (or | datetime, | time)") inside the `__PUZZLE_DEV__`
      block. The production displayValue carries no `instanceof Date`, so the warning costs zero
      production bytes; checked in the todos production bundle.
  - kind: state
    text: >-
      PR #151 review round. The state note above is superseded on three points.


      (1) The V14 test now lives in ONE helper, `fill(out, nodes, marker, parts)` in viewManager.js,
      which replaces `isFilled` and the four duplicated fill/fallback arms. The filled test runs
      ONLY when the marker has a fallback. A marker without one splices the supplied nodes through
      as they are, placeholders included. That keeps its arity constant when a call-site `{#if}`
      toggles, so the positional patcher no longer shifts and remounts the siblings after it. The
      first build dropped the placeholder, which cost input focus and rebuilt a stateful sibling 3x;
      tests/slot-filled.test.js now pins this. The rendered result is identical to the V14 rule: an
      unfilled marker without a fallback shows nothing either way.


      (2) A fallback whose node count differs from the content's still shifts following siblings on
      each flip. Padding to fix this was rejected (+32 B gzip). SPEC §24, D141 and SKILL.md instead
      tell authors to keep such a fallback to one root element.


      (3) V9 now drops `false` and every item that prints nothing from an attribute list (the clsx
      idiom). The card's V9 text says so.


      Cost vs the pre-D173 base: hello-world 21,933 → 22,040 B gzip (+107), todos 25,884 → 25,991 B
      (+107).
  - kind: state
    text: >-
      Group (b) — V1 (pipe in attributes, props, if/else-if/unless/case headers, inline-if), the V1
      `{#for}`-header pipe ban, V2/V3 (`==` unchanged, pinned by a test), V4 (guarded member access
      in value positions), V8 (object literals as formatter/call arguments), V12 (missing/non-list
      collection loops zero times, dev warning) and V15 (script-less component's data() returns its
      props) — is built in PuzzleKit on feat/core-expressions (PR #152 into release/0.8.0).
      PuzzleKit goes beyond the core subset on V8: shorthand, quoted, computed and spread keys all
      work (JS superset; the core still names only `key: value`). Beyond the card as first written,
      the review round added: a segment after a pipe must be a formatter name (anything else — `{
      flags | 4 }`, `{ a |= 2 }` — is a positioned error steering to `(a | b)`), a `|` in a
      `{:when}` value is a positioned error, and integer-literal ranges are constant-folded without
      the loopRange import. Sites adoption of V1, V2 and V12 is still pending the dialect switch, as
      is the Sites wording of the `{#for}` fix-it. Measured cost: hello-world +0 B gzip, todos +35 B
      gzip.
  - kind: gotcha
    text: >-
      Sites vendors the 0.7.0 parser, and its renderer reads `DynamicAttr.Expr`, `If.Cond` and
      `Case.Expr` directly. After its next `make sync-parser` picks up the D173 (b) parser, a
      chained value position arrives as a bare base in `Expr`/`Cond` with the chain in the new
      `Formatters` fields (`DynamicAttr`, `If`, `Case`, `InlineIfPart`), and an `{#unless}` with a
      chain arrives un-negated with `If.Negate` set. A renderer that ignores those fields silently
      DROPS the formatters and inverts chained unless blocks — no error, just wrong output. Update
      the Sites renderer to apply `Formatters` (and honor `Negate`) in the same sync, and note the
      parser now also rejects a non-name after a pipe and a `|` in `{:when}` values, which may
      surface as new Sites compile errors.
  - kind: state
    text: >-
      Group (c) — V10 whitespace — is built in PuzzleKit on feat/whitespace-rule (PR #154 into
      release/0.8.0); D168 states the rule and the implementation. Codegen only, no shared-parser
      change. Choices the card left open, now fixed on D168: `<Snippet>` and `<Portal>` count as
      elements for rules 3 and 4; the `<pre>`/`<textarea>` rule covers the whole subtree; the one
      newline after the start tag is dropped (HTML's parser rule), except from a `{#raw}` first
      child; line endings in preserved and `{#raw}` text normalize to LF (HTML's input-stream rule);
      a `{#for}` body inside a `<pre>` still drops its own whitespace (a loop body is one root
      element); and the SSG serializer doubles a leading newline in pre/textarea/listing so
      prerendered text matches the mounted text. Measured corpus (612 files, against 50acbfeb): 830
      text runs in 131 files gain 1,004 spaces, none lose one, no pre/textarea body changes. Two
      templates were fixed in the same PR: the pieces demo's MeterDoc had `(`, `)` and `,` on their
      own lines beside `<code>` (it would render `gauge ( role="meter" ) for`, `Progress , which`),
      so the punctuation moved onto the element's line; the DevTools "State layers" span went from
      `ml-1.5` to `ml-1` to absorb the new space. The spaced slashes (`href / removable`) in
      ChatAttachmentDoc, ToolbarDoc and DropdownMenuDoc are kept as they now read. Every icon +
      label pair sits in a flex item and is unaffected. Production size against 50acbfeb:
      hello-world 21,977 B and todos 26,144 B gzip, byte-identical.
  - kind: state
    text: >-
      Group (e), sanitized `raw` and `newline_to_br` (D174), is built in PuzzleKit on
      feat/sanitized-raw, so the intro's "(e) sanitized `raw` [is] not" is superseded. A text
      interpolation ending in either name renders a live-HTML node (raw through the shared allowlist
      sanitizer), a non-text sibling under the V10/D168 whitespace rule like an element; either name
      anywhere else is a positioned compile error. D174's body holds the allowlist, the canonical
      output the conformance rows pin, and what Sites must do.
---

# D173 — Core semantics: one meaning for each shared construct

Decided with Cory on 2026-09-25. The decisions below are adopted. Build state
by group (the build list at the end is the implementation order): (a) the
formatter set, (b) expressions and loops, (c) whitespace, (d) slot rules, (f)
value printing and (g) standard-set alignment
([[DECISION-D174-STANDARD-FORMATTERS]]) are built in PuzzleKit; (e) sanitized
`raw` is not. Sites has adopted
none of it yet. Until an item lands, [[DOC-LANGUAGE-CORE]] keeps describing today's
behavior of each host, and its "Known divergences" entry stays open.
Formatters (F1–F27) are on [[DECISION-D174-STANDARD-FORMATTERS]].

## Context

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] makes Puzzle one template language
with two dialects, PuzzleKit and Sites, under one rule: **a dialect may add or
restrict, never redefine.** [[DOC-LANGUAGE-CORE]] found 18 places (V1–V18)
where the two implementations gave shared syntax different meanings. Each gets
one of four outcomes:

- **Unify**: both hosts behave the same.
- **Host-specific**: the difference is inherent to the host, so the core
  declares it host-defined and tells authors.
- **Restrict**: one dialect rejects the construct for now (the rule allows
  restriction).
- **Fix bug**: one side is simply wrong.

**How the winner is chosen**, in order:

1. **Valid JavaScript keeps its JavaScript meaning.** PuzzleKit template
   expressions are JavaScript, and a PuzzleKit author reads `==` or `===`
   the way the same file's `<script>` does. The core never redefines a
   JavaScript operator. Where Sites differs from JavaScript on an operator,
   Sites changes.
2. **Safer for template authors wins.** A missing value prints nothing rather
   than crashing the view, a missing list loops zero times, and nothing leaks
   `NaN` or `[object Object]` onto the page. PuzzleKit may get there by
   *lowering* template expressions in codegen (a member-access guard, a loop
   guard), because codegen already compiles every template expression and no
   script byte changes. Lowering may add safety. It never changes what a
   valid expression evaluates to when nothing is missing.
3. **When neither behavior is safer, Sites changes.** Sites is unpublished;
   PuzzleKit is on npm.

**Corpus for the "templates affected" counts** (heuristic scan on 2026-09-24
of every template section, with `<script>`, `<style>` and `<schema>` removed):
**PuzzleKit**, 593 files (`packages/puzzle/examples`, the scaffold templates,
and the `packages/puzzle-pieces` registry and demo); **PK apps**, 214 files
(`sites/web` and `sites/admin`, real PuzzleKit apps outside this monorepo);
**Sites**, 150 files (`sites/engine/testdata` and `sites/engine/starter`, not
counting the deliberately broken `testdata/themes/errors` fixtures). "None
found" means the scan found no template whose output changes; where the
answer depends on runtime values, the item says so.

## Summary

| Item | Outcome | Host that changes | Breaking | Templates that change |
|---|---|---|---|---|
| V1 pipes | Unify: a pipe is a formatter in every value position; banned in `{#for}` headers | both | PuzzleKit | none found |
| V2 `==` / `!=` | Unify: JavaScript loose equality | Sites | Sites (edge cases) | none found |
| V3 `null` vs `undefined` | Host-specific for strict comparison; `x == null` is the portable absence test | none | no | none found |
| V4 access through absent | Unify: yields absent, prints nothing | PuzzleKit | no | none found |
| V5 arithmetic on non-numbers | Host-specific | none | no | none found |
| V6 value printing | Unify on one printing rule | both | both (edge cases) | none found |
| V7 text units and Unicode | Host-specific | none | no | none found |
| V8 object literals | Fix bug; object literals join the core | PuzzleKit | no | none found |
| V9 list/object in an attribute | Unify on Sites' rule | PuzzleKit | PuzzleKit | none found |
| V10 whitespace | Unify on a merged rule (D168) | both | both | PK 119 files, PK apps 13, Sites 33 |
| V11 text inside `{#raw}` | Unify on PuzzleKit's rule | Sites | Sites | none found |
| V12 loop domain | Unify: non-lists loop zero times | both | both | none found |
| V13 markers in exclusive branches | Unify: one per render path | shared parser | no | none found |
| V14 when a slot is filled | Unify: filled means it rendered something | both | both | none found |
| V15 how props reach scope | Host-specific, plus script-less PuzzleKit components read props | PuzzleKit | no | none found |
| V16 dotted tags in Sites | Restrict: Sites rejects them for now | Sites | no | none |
| V17 formatter failure policy | Host-specific | none | no | none found |
| V18 scoped styles, `{#svg}` paths | Styles host-specific; `{#svg}` path unified | Sites | Sites | none found |

## Expressions


**V1 — the formatter pipe.**
- **A top-level single `|` is a formatter pipe in every template value
  position, in both hosts:** text interpolation, quoted and brace-only
  attribute values, component props, and the `{#if}`, `{:else if}`,
  `{#unless}` and `{#case}` subjects. So `title={ price | currency }` calls
  `currency` in PuzzleKit, where it used to compile to a bitwise OR. The
  splitting rule is the one text interpolation already uses: `||` stays
  logical OR, and a `|` inside a string, parentheses or brackets is not a
  pipe. A chained position reads `expr | chain` as a whole, as text does.
  `@event` handler bodies are PuzzleKit JavaScript, not value positions, and
  are untouched. Sites' `{#let}` value is also a pipe position (a Sites
  addition).
- **A pipe inside a `{#for}` header is a positioned compile error in both
  dialects,** in the collection and in range bounds. Cory: "No formatters in
  for loop headers in both - it adds too much to one line." The fix-it names
  the list first:
  - PuzzleKit: shape the list in `data()` and loop over that field.
  - Sites: `{#let filtered = products | where('inStock', true)}`, then
    `{#for p in filtered}`.
- **Breaking:** PuzzleKit. A bitwise OR in an attribute, prop or `{#if}` /
  `{#case}` header becomes a formatter call, and one in a `{#for}` header
  becomes an error. Sites gains chains in `{#if}`/`{#case}` headers, which it
  rejected; not breaking.
- **Templates:** none found. PuzzleKit and PK apps have 0 pipes in
  brace-only attributes, props or headers; Sites has 1 of each, both in the
  `errors/sections/let-misuse.pzl` fixture.

**V2 — `==` and `!=` mean what they mean in JavaScript, in both hosts.**
Cory: "it's valid js so we should allow valid js."
- They join the core with ECMAScript's loose-equality algorithm
  (`IsLooselyEqual`). PuzzleKit is unchanged. Sites implements the algorithm
  in its Go evaluator for `==`/`!=`, where today it treats them as
  `===`/`!==`; shared fixtures pin the cross-type cases (`1 == '1'`,
  `0 == ''`, `null == undefined`, `true == 1`).
- **No compiler warning.** A team that wants strict equality everywhere turns
  on an optional `eqeqeq`-style rule in `puzzle-eslint`.
- **Breaking:** Sites, in edge cases only: a comparison whose operands hold
  different types changes from false to the JavaScript result.
- **Templates:** none found. The 33 Sites uses in 21 files compare a field
  with a string literal, a number literal or another field. Only the ones
  that compare a field with a numeric-looking literal could change
  (`settings.columns == '2'` and its siblings, 8 uses; `settings.count == 2`,
  1 use), and only if the field holds the other type, where the result
  becomes true instead of never matching.

**V3 — `null`, `undefined` and strict comparison.**
- **The portable absence test is `x == null`** (and `x != null`). Under V2 it
  behaves identically in both hosts: true for both spellings of a missing
  value, false for everything else.
- **What `x === null` or `x === undefined` returns is host-defined.**
  PuzzleKit follows JavaScript, so `undefined === null` is false. Sites has
  one absent value in Go and does what it does. The docs tell authors to
  write `== null`. `??` and `?.` already treat both spellings as absent in
  both hosts.
- **Changes:** none (docs). **Breaking:** no.
- **Templates:** none found (0 comparisons against a `null` or `undefined`
  literal in any corpus).

**V4 — member access through a missing value.**
- **Reading a member of a missing value yields a missing value, and a
  missing value prints nothing: an empty string, never a word such as
  "empty".** PuzzleKit codegen guards every member and index step in a
  template value expression (`a?.b?.c`, `a?.[i]`); writing `?.` stays legal
  and becomes unnecessary. PuzzleKit's development warning for an undefined
  interpolation still points at the typo.
- **Why:** one missing intermediate object used to throw and send the whole
  PuzzleKit view to error handling. Only codegen changes; scripts stay real
  JavaScript, and a path that exists evaluates exactly as before.
- **Breaking:** no. A render that threw now prints nothing.
- **Templates:** none of the working templates change. Deep paths appear 24
  times in 6 PuzzleKit files and 12 times in 5 PK-app files; those print
  nothing instead of throwing if an intermediate object goes missing.

**V5 — arithmetic and comparison on non-numbers: host-specific.** The core
defines `+ - * / %`, unary `-` and `< <= > >=` for number with number, `+` with
a string operand as concatenation, and ordering for string with string. Any
other mix is host-defined: PuzzleKit follows JavaScript coercion; Sites yields
a missing value with a warning. Authors coerce in `data()` (PuzzleKit) or use
a formatter (`plus`, `times`). No template changes (4 PuzzleKit, 2 PK-app and
2 Sites arithmetic expressions, all number with number).

**V8 — object literals join the core, and PuzzleKit's scoping bug is fixed.**
Object literals are allowed in argument and nested positions, not at the
start of an expression, where `{ {` is ambiguous with the interpolation brace.
Keys are identifiers or quoted strings and values are core expressions; there
is no shorthand, computed key or spread. PuzzleKit codegen scopes the values
only; it used to scope the keys too, emitting `{__d.height: 480}`, invalid
JavaScript that only the bundler caught. Sites' image formatters take option
objects (4 starter uses, unchanged). Not breaking.

## Rendering, whitespace, escaping


**V6 — value printing, one rule in both hosts.** A missing value prints
nothing. Booleans print `true`/`false`. Numbers print by ECMAScript
Number::toString (the shortest round-trip decimal, exponent form at or above
1e21 and below 1e-6). `NaN` and ±Infinity print nothing. A list prints its
items by this same rule, joined with `,`. An object prints nothing and raises
a development warning. PuzzleKit changes its runtime text coercion
(non-finite numbers and objects); Sites changes its exponent range and object
printing. Breaking in edge cases for both; no template found prints a
non-finite literal or an object.

**V9 — a list or object in a brace-only attribute.** On an element, a list is
an attribute token list: its items print by V6 and join with single spaces, and
`false` and every item that prints nothing (`null`, `undefined`, `''`, and
anything else V6 prints as nothing) are dropped. So `class={ classes }` takes a
list, and the clsx idiom `class={ [active && 'on', 'btn'] }` writes
`class="btn"`, never `class="false btn"`. An object omits the attribute and
raises a development warning. Text interpolation keeps V6's plain comma join
(`false` prints, empty items stay as empty slots), and a list passed as a prop
stays a list. PuzzleKit changes `setAttr` stringification (breaking: a list
attribute joined with commas now joins with spaces). None found: the one
brace-only list literal in PuzzleKit (`InputOtpDoc.pzl`, `{ [3, 3] }`) is a
prop.

**V10 — whitespace: the merged rule, in both hosts.** Cory: "Yes this is a
real bug. I agree with the merged rule." The rule is stated in full on
[[DECISION-D168-TEXT-RUN-WHITESPACE]], which owns it: whitespace without a
newline collapses to one space; newline-bearing whitespace at a parent's
first- or last-child edge is dropped; between two elements it is dropped;
between text or an interpolation and an element it collapses to one space;
between text or an interpolation and a control block it keeps one space; and
`<pre>`/`<textarea>` bodies are preserved exactly.
- **PuzzleKit changes:** text next to an element, and `<pre>`/`<textarea>`.
  **Sites changes:** element-to-element gaps and the control-block boundary.
- **Templates:** PuzzleKit, about 965 line breaks between text and an inline
  element in 119 files (mostly puzzle-pieces demo prose), which gain the
  space they are missing today, plus 9 files with `<pre>` or `<textarea>`.
  PK apps: 7 such line breaks in 7 files, and 6 files with `<pre>` or
  `<textarea>`. Sites: 29 inline-sibling line breaks in 14 files lose their
  gap, and 30 interpolation-to-block line breaks in 19 files gain a space.

**V11 — text inside `{#raw}` follows the core text rule** and is not
entity-decoded. Sites escapes `&`, `<` and `>` in raw-block text, except inside
`<script>` and `<style>`, where both hosts write the text verbatim. Markup
inside `{#raw}` stays markup in both. Sites changes (breaking); its 2 raw
blocks, both fixtures, contain neither `&` nor a text `<`.

## Components, slots, loops

**V12 — a missing list loops zero times.** `{#for x in c}` iterates lists. A
missing collection runs zero times with no warning. Any other non-list (a
string, an object, a number) runs zero times with a development warning, in
both hosts. Range bounds are truncated toward zero, with a development warning
when a bound was not an integer, and a missing bound runs the range zero
times. PuzzleKit guards the collection in codegen and `listRows` (template
code, not script); Sites changes its non-integer-bound handling (it rendered
nothing). Breaking for both: a PuzzleKit loop over a string's characters
stops, and Sites bounds truncate. None found: every loop in every corpus
iterates a list-shaped path, and all 18 range loops use integer literals.

**The loop index** is `{#for item in items, i}` in both hosts (0-based), and
`{#for 1...n, x}` binds the current number. `loop.first` / `loop.last`
helper variables are not planned for now; compare the index (`i === 0`,
`i === items.length - 1`).

**V13 — at most one default marker per render path.** A default marker
(`<Children/>` or a bare `<Slot/>`), and a `<Slot name="x">` for any one name,
may appear once on any single render path. Two markers in mutually exclusive
branches of one `{#if}`/`{:else}` or `{#case}` are legal, so
`{#if compact}<div><Children/></div>{:else}<section><Children/></section>{/if}`
works. Markers inside loops (the snippet pattern) keep today's rules. The
check lives in the shared parser (`packages/puzzle-lang/parser/slot.go`, the
"duplicate default marker" error), so one change serves both hosts. Not
breaking; no file has two default markers except a Sites error fixture that
puts both on one path, which stays an error.

**V14 — a slot is filled when its content renders something.** A position is
filled when the content supplied for it renders at least one node that is not
whitespace-only text. A call-site `{#if}` that renders nothing, and a `{#for}`
over an empty list, both leave the position unfilled, so the fallback body
from [[DECISION-D141-MARKER-FALLBACK-BODIES]] shows in both hosts. That gives
the empty-state pattern for free: `<List>{#for}…{/for}</List>` with a fallback
of "Nothing here yet". PuzzleKit changes `expandChildList` (a false `{#if}`
placeholder and an empty expansion count as unfilled; an empty `{#for}`
already did). Sites renders the call-site content first and falls back when
the result is whitespace-only. Breaking for both; none found (0 call sites
whose only content is a block, passed to a component whose marker has a
fallback).

**V15 — how a component reads its props: host-specific, plus one PuzzleKit
addition.** A PuzzleKit component with no `<script>` gets a synthesized
`data(params, props)` that returns its props, so `{ tone }` reads the prop, as
in Sites. A component with a script keeps PuzzleKit's rule: its `data()`
decides. Not breaking; PuzzleKit has 1 script-less file, with no
interpolations.

**V16 — dotted component tags are a Sites restriction for now.** The tag
grammar stays core and the shared parser accepts `<Frame.Wrapper>`. Sites
rejects a dotted tag with a positioned error saying component families are
not supported in Sites yet. Cory: "haven't gotten that far with Sites yet.
It'll probably be more simple." Not breaking: no Sites file could back a
dotted tag before. PuzzleKit's barrel resolution
([[DECISION-D167-COMPONENT-FAMILIES]]) is unaffected.

## Host-specific declarations

**V7 — text units and Unicode.** `.length` on a string counts UTF-16 units in
PuzzleKit and code points in Sites. Case mapping follows each host's Unicode
tables (`ß` upcases to `SS` in PuzzleKit and stays `ß` in Sites), and the
whitespace set `trim` removes differs on U+0085 and U+FEFF. The docs tell
authors to use the `size` formatter for a text length: the standard
formatters `size`, `truncate` and `split('')` count code points in both hosts
(D174). Counting code points in PuzzleKit's `.length` would need a runtime
helper on every `.length`, since codegen cannot tell a string from a list,
for a difference that shows only outside the BMP.

**V17 — formatter failure policy.** Each host sets its own policy for an
unknown formatter name, a wrong argument count and out-of-domain input. Sites
fails the compile, or warns and prints nothing. PuzzleKit passes the value
through and logs a development error, because its app formatters are
registered in JavaScript at runtime, out of the compiler's sight. The
in-domain behavior of the standard set is pinned by D174.

**V18 — scoped styles and `{#svg}` paths.** Scoped styles are host-specific:
the stamping algorithm is shared, the attribute prefix and stamp target are
host-defined. The `{#svg}` path is unified: it is relative to the host's
assets root in both hosts. Sites stops accepting an explicit `assets/` prefix
(it named `app/assets/assets/x.svg` in PuzzleKit) and makes it a compile error
steering to the bare path. Sites changes; no `{#svg}` path in any corpus uses
the prefix.

## Alternatives rejected

- **V1: pipes in `{#for}` headers.** Rejected: it puts filtering, sorting and
  the loop on one line. Naming the list first (`data()` in PuzzleKit,
  `{#let}` in Sites) reads better and keeps list shaping out of the header.
- **V1: keep every block header plain.** Rejected: a formatter in an `{#if}`
  or `{#case}` subject (`{#if post.tags | size}`) is short and useful, and
  the loop header is the one position where a chain grows long.
- **V2: `==` means `===` in templates.** Rejected: a PuzzleKit template's
  `==` would mean something different from the same file's `<script>`, which
  redefines valid JavaScript.
- **V2: the core rejects `==`/`!=` with a fix-it steering to `===`.**
  Rejected: it forbids valid JavaScript. Teams that want that get it from the
  optional `puzzle-eslint` rule instead.
- **V3: PuzzleKit lowers `=== null` / `=== undefined` to `== null`.**
  Rejected for the same reason as V2: it changes the result of a valid
  JavaScript expression. `== null` already gives the portable test.
- **V4: make `?.` mandatory in the core.** Rejected: it keeps a crash in
  PuzzleKit for any author who forgets `?.`, and turns every existing Sites
  path into non-core syntax.
- **V5: unify on Sites through runtime helpers.** Rejected: work on every
  render in the hottest code, for inputs no correct template produces;
  development-only helpers would make production behave differently.
- **V7: count code points in PuzzleKit's `.length`.** Rejected: a helper on
  every `.length` for a difference outside the BMP.
- **V10: one host's whitespace rule wholesale.** PuzzleKit's keeps the glued
  prose (`tokens —a,band more`) and makes authors write `{ ' ' }`. Sites'
  brings back indentation gaps between inline-block siblings. See D168.
- **V12: Sites' "render nothing" for non-integer bounds.** Both are safe; the
  tie-break keeps the published behavior.
- **V14: a static rule, where any authored content that is not whitespace
  fills the position.** Rejected: it gives no empty-state behavior, and
  PuzzleKit's old split (a false `{#if}` filled, an empty `{#for}` did not)
  was a side effect of the `{#if}` placeholder node, not a design.
- **V16: map a dotted tag to a Sites file now**, as `Frame.Wrapper.pzl` in the
  flat folder or `Frame/Wrapper.pzl` in a folder per family. Rejected for
  now: Sites has no need for families yet, and its eventual design will
  probably be simpler. Lifting the restriction later is an addition.
- **Leave everything host-defined.** Rejected: it contradicts D172. Host-
  defined is kept only where the difference is inherent to the host (V3's
  strict comparison, V5, V7, V15, V17 and the V18 styles).

## Build list


PuzzleKit first. Sites is lower priority because Cory is still designing it.
Groups are separate feature branches off the release branch, in this order
across both cards: (a) the formatter set (D174), (b) expressions and loops,
(c) whitespace, (d) slot rules, (e) sanitized `raw` (D174), (f) value
printing, (g) standard-set alignment (D174). Items marked **[shared parser]**
touch `packages/puzzle-lang/parser`, so the vendored ports in
`packages/puzzle-eslint` / `packages/puzzle-prettier`, the three editor
grammars (puzzle-vscode/sublime/zed), and Sites' next parser sync must be
checked.

**(b) Expressions and loops — PuzzleKit codegen + shared parser.**
- V1 **[shared parser]**: `parser` splits a formatter chain in brace-only
  attributes, props and `{#if}`/`{:else if}`/`{#unless}`/`{#case}` subjects
  (the AST gains a chain on those nodes); `compiler/internal/codegen`
  (`expr.go`, `codegen.go`) emits the calls and includes them in the
  formatter manifest scan (D31). The `{#for}`-header pipe ban is a positioned
  parser error with the PuzzleKit fix-it; the Sites fix-it wording arrives
  with the dialect switch (D172). Editor grammars: highlight the pipe and
  formatter name in those positions. eslint port: mirror the new error if it
  reports parse errors.
- V4: codegen emits guarded member and index access in template value
  expressions (`expr.go`). Measure bytes and render time against the D170
  bench gates (`npm run bench`, after `build:compiler`).
- V8: codegen scopes object-literal values only (`expr.go`).
- V12: codegen plus `client-runtime/views/listBlock.js` guard the collection
  (missing → empty, non-list → empty plus a dev warning) and range bounds.
- V15: codegen synthesizes `data(params, props)` for a script-less component.
- Tests: `expr_test.go`, `range_for_parens_test.go`, `listblock_test.go`, new
  codegen tests per item, parser tests for the header chain and the ban,
  vitest for the loop guard; goldens re-blessed.

**(c) Whitespace — the merged rule (D168).** `compiler/internal/codegen/
codegen.go` (`processText`, `buildTextRun`, `processChildren`): text next to
an element keeps one space; `<pre>` and `<textarea>` bodies are preserved.
Tests: `text_run_space_test.go`, the todos goldens, and a pieces-demo compile
diff. puzzle-prettier must agree with the rule (a line break between text and
an inline element is now a space, and `<pre>` is whitespace-sensitive). Not a
parser change.

**(d) Slot rules.**
- V14: `client-runtime/views/viewManager.js` `expandChildList` treats a false
  `{#if}` placeholder and an empty expansion as unfilled. Tests: the fallback
  suites in `tests/`, including an `{#if}` and an empty `{#for}` at the call
  site.
- V13 **[shared parser]**: `packages/puzzle-lang/parser/slot.go` allows one
  default marker per render path. Tests: `parser_test.go`,
  `snippets_test.go`. No grammar change.

**(f) Value printing — PuzzleKit runtime.** V6: text coercion in
`client-runtime/views/` (non-finite numbers and objects print nothing, with
the dev warning for objects). V9: `setAttr` joins a list with spaces and omits
an object with a dev warning. Tests: `display_value_test.go` and vitest
render tests. The SSG serializer (`client-runtime/ssg/`) must print the same.

**PuzzleKit docs, with each group:** [[DOC-SPEC-TEMPLATE]] §6 and §24, the
embedded agent skill (`skills/puzzle/SKILL.md`), and [[DOC-LANGUAGE-CORE]],
where each landed item moves from "Known divergences" into the core rules. The
`eqeqeq`-style `puzzle-eslint` rule (V2) is optional and unscheduled.

**Sites (later, its own repo and cards):**
- Evaluator: JavaScript loose equality (V2); chains in `{#if}`/`{#case}`
  headers and the `{#for}`-header error with the `{#let}` fix-it (V1); value
  printing (V6).
- Renderer: whitespace (V10), raw-block escaping (V11), loop bounds (V12), the
  slot-filled rule (V14), the `{#svg}` prefix error (V18), and the dotted-tag
  error (V16).
- The one starter-theme output change is whitespace (V10).

**Shared:** a conformance fixture for every unified item, run by both hosts.
It is the only real proof that a unified item is identical.

**Breaking changes:**
- PuzzleKit: 6 (V1, V6, V9, V10, V12, V14). Only V10 changes the output of
  existing templates, and there it fixes glued prose.
- Sites: 7 (V2, V6, V10, V11, V12, V14, V18). Only V10 changes the output of
  existing templates.
