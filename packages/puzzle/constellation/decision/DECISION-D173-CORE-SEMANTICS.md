---
name: >-
  D173 — Core semantics: proposed resolutions for the dialect divergences V1–V18 (PROPOSED, not
  decided)
status: planned
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-TEMPLATE
  - COMPONENT-FORMATTERS
  - COMPONENT-CODEGEN
  - DECISION-D168-TEXT-RUN-WHITESPACE
  - DECISION-D141-MARKER-FALLBACK-BODIES
---

# D173 — Core semantics: resolving V1–V18

> **PROPOSED. Nothing on this card is decided.** Every item below is a proposal
> for Cory to approve, amend or reject, in the batches given. Until an item is
> approved, [[DOC-LANGUAGE-CORE]] keeps listing it as an open divergence and
> neither host changes. Formatter differences (F1–F27, batch 4) are on
> [[DECISION-D174-STANDARD-FORMATTERS]].

## Context

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] makes Puzzle one template language
with two dialects, PuzzleKit and Sites, under one rule: **a dialect may add or
restrict, never redefine.** Shared syntax that behaves differently per host
must either be made identical or get a new spelling. [[DOC-LANGUAGE-CORE]]
lists 18 places where today's two implementations still break that rule
(V1–V18). This card proposes one outcome for each:

- **Unify**: both hosts behave the same; the card says which behavior wins and
  which host changes.
- **Host-specific**: the difference is inherent to the host. The core spec
  states it as host-defined and tells authors.
- **Rename**: two different things share a spelling; one gets a new spelling.
- **Fix bug**: one side is simply wrong.

**How the winner was chosen**, in order:

1. **Safer for template authors wins.** An absent value renders empty rather
   than crashing the view; a missing list loops zero times; nothing leaks
   `NaN` or `[object Object]` onto the page.
2. **PuzzleKit's `<script>` stays real JavaScript.** That invariant covers
   scripts, not template expressions: PuzzleKit's codegen already compiles
   every template expression, so it may lower them (optional chaining, a
   `?? []` loop guard, `== null`) without touching a byte of script. Where
   that is the mechanism, the item says so.
3. **When neither behavior is safer, Sites changes.** Sites is unpublished, so
   a breaking change there costs nothing outside Magic Spells. PuzzleKit 0.7.0
   is on npm.

**Corpus for the "templates affected" counts** (heuristic scan on 2026-09-24
of every template section, with `<script>`, `<style>` and `<schema>` removed):

- **PuzzleKit**, 593 files: `packages/puzzle/examples` (173),
  `compiler/internal/scaffold/templates` (8), `packages/puzzle-pieces`
  registry and demo (412).
- **PK apps**, 214 files: the two PuzzleKit apps inside the Sites repo,
  `sites/web` and `sites/admin`, counted separately because they are real
  PuzzleKit code outside this monorepo.
- **Sites**, 150 files: `sites/engine/testdata` (115) and
  `sites/engine/starter` (35). The deliberately broken fixtures under
  `testdata/themes/errors` do not count as "would change".

"None found" means the scan found no template whose output changes. Where the
difference depends on runtime values that a scan cannot see, the item says so.

## Batch summary

| Item | Batch | Proposed outcome | Host that changes | Breaking | Templates that change |
|---|---|---|---|---|---|
| V1 pipe outside text | 1 | Unify: a pipe is a formatter in every value position | both | PuzzleKit | none found |
| V2 loose equality | 1 | Unify: `==` means `===` **(judgment)** | PuzzleKit | PuzzleKit | none found |
| V3 null vs undefined | 1 | Unify: one absent value | PuzzleKit | PuzzleKit | none found |
| V4 access through absent | 1 | Unify: yields absent | PuzzleKit | no | none found |
| V5 arithmetic on non-numbers | 1 | Host-specific | none | no | none found |
| V8 object literals | 1 | Fix bug, and object literals join the core | PuzzleKit | no | none found |
| V6 value printing | 2 | Unify on one printing rule | both | both (edge cases) | none found |
| V9 list/object in an attribute | 2 | Unify: Sites' rule | PuzzleKit | PuzzleKit | none found |
| V10 whitespace edges | 2 | Unify on a merged rule **(judgment)** | both | both | PK 119 files, PK apps 13, Sites 33 |
| V11 text inside raw | 2 | Unify: PuzzleKit's rule | Sites | Sites | none found |
| V12 loop domain | 3 | Unify: non-lists loop zero times | both | both | none found |
| V13 markers in exclusive branches | 3 | Unify: one per render path | shared parser | no | none found |
| V14 when a slot is filled | 3 | Unify: filled means it rendered something **(judgment)** | both | both | none found |
| V16 dotted tags in Sites | 3 | Host-specific: Sites maps to a dotted file name | Sites | no | none found |
| V7 text units and Unicode | 5 | Host-specific | none | no | none found |
| V15 how props reach scope | 5 | Host-specific, plus script-less PuzzleKit components read props | PuzzleKit | no | none found |
| V17 formatter failure policy | 5 | Host-specific | none | no | none found |
| V18 scoped styles and svg paths | 5 | Styles host-specific; the svg path is unified | Sites | Sites | none found |

## Batch 1 — expression semantics


**V1 — the formatter pipe outside text and quoted attributes.**
- **PROPOSED: Unify on the formatter reading.** A top-level single `|` is a
  formatter pipe in every template value position: text, quoted and unquoted
  attributes, component props, the `{#if}`, `{:else if}`, `{#unless}` and
  `{#case}` subjects, and the `{#for}` collection. `||` stays logical OR, and a
  `|` inside a string, parentheses or brackets is not a pipe; this is the
  splitting rule text interpolation already uses. `@event` handler bodies are
  PuzzleKit JavaScript, not value positions, and are untouched.
- **Why:** one reading everywhere. Bitwise OR is not in the core, and in a
  template it is almost certainly a bug. A chain in a `{#for}` header gives
  Sites, which has no script, list filtering without a `{#let}`.
- **Changes:** PuzzleKit codegen (use the text splitter in attribute, prop and
  header positions) and the Sites evaluator (accept chains in block headers;
  attributes already work).
- **Breaking:** PuzzleKit, in principle: a bitwise OR in an attribute, prop or
  header becomes a formatter call. Sites: no (an error becomes legal).
- **Templates:** none found. PuzzleKit and PK apps have 0 pipes in unquoted
  attributes, props or headers. Sites has 1 of each, both in the
  `errors/sections/let-misuse.pzl` fixture.

**V2 — `==` and `!=`.** *Needs Cory's judgment.*
- **PROPOSED: Unify on strict.** In a template expression, `==` and `!=` mean
  `===` and `!==` in both hosts. PuzzleKit codegen emits `===`/`!==` for them.
- **Why:** theme authors who are not JavaScript developers write `==` (35 uses
  in 21 Sites files, including every starter theme), and cross-type loose
  equality is never what a template means. With V3, `x == null` still tests
  "absent", which is the one loose-equality idiom JavaScript developers use.
- **Changes:** PuzzleKit codegen.
- **Breaking:** PuzzleKit (`1 == '1'` becomes false).
- **Templates:** none found in PuzzleKit or PK apps (0 loose comparisons). The
  35 Sites uses keep their meaning.
- **The question:** under this proposal a `==` in a PuzzleKit template means
  something different from a `==` in the same file's `<script>`. The other
  option is for the core to reject `==`/`!=` with a fix-it steering to `===`.
  That leaves no silent difference from JavaScript, but the 35 Sites uses must
  be rewritten. That costs little now, while Sites is unpublished.

**V3 — `null === undefined`.**
- **PROPOSED: Unify on Sites: the core has one absent value**, and `null` and
  `undefined` are two spellings of it. `x === null`, `x === undefined` and
  their `!==` forms test absence. PuzzleKit codegen lowers a `===`/`!==` whose
  operand is a `null` or `undefined` literal to `== null`/`!= null`.
- **Why:** a data field that was never set is `undefined` in PuzzleKit, so
  `{#if post.image === null}` is false for it today, which is a silent bug. `??` and
  `?.` already treat both spellings as absent in both hosts.
- **Residual, declared host-defined:** comparing two variables that hold
  different spellings (`a === b` with `a` null and `b` undefined). Covering
  it would route every `===` through a runtime helper, and no real template
  needs it.
- **Changes:** PuzzleKit codegen. **Breaking:** PuzzleKit, strictly.
- **Templates:** none found (0 comparisons against a `null` or `undefined`
  literal in any corpus).

**V4 — member access through an absent value.**
- **PROPOSED: Unify on Sites: reading a member of an absent value yields
  absent.** PuzzleKit codegen emits optional chaining for every member and
  index step in a template value expression (`a?.b?.c`, `a?.[i]`). Writing
  `?.` stays legal, and is no longer needed.
- **Why:** today one missing intermediate object throws, and PuzzleKit sends
  the whole view to error handling. Empty is the safer result, and PuzzleKit's
  existing development warning for an undefined interpolation still points at
  the typo. Only codegen changes, so scripts stay real JavaScript.
- **Changes:** PuzzleKit codegen. Measure the byte cost against the D170 bench
  gates before adopting.
- **Breaking:** no. A render that threw now renders empty.
- **Templates:** none of the working templates change. Deep paths such as
  `a.b.c` appear 24 times in 6 PuzzleKit files and 12 times in 5 PK-app files;
  those render empty instead of throwing if an intermediate object goes
  missing.

**V5 — arithmetic and comparison on non-numbers.**
- **PROPOSED: Host-specific, declared.** The core defines `+ - * / %`, unary
  `-` and `< <= > >=` for number with number, `+` with a string operand as
  concatenation, and ordering for string with string. Any other mix of operand
  types is host-defined: PuzzleKit follows JavaScript coercion, and Sites
  yields absent with a warning. The docs tell authors to coerce in `data()`
  (PuzzleKit) or use a formatter (`plus`, `times`).
- **Why:** matching Sites would put a runtime helper behind every arithmetic
  operator, in the hottest template code, for inputs no correct template
  produces. Once V6 prints `NaN` as empty, the visible results mostly agree
  anyway.
- **Changes:** none (docs). **Breaking:** no.
- **Templates:** none found. PuzzleKit has 4 arithmetic expressions (loop
  index delays and `16 / 9`), PK apps 2 and Sites 2, all number with number.

**V8 — object literals.**
- **PROPOSED: Fix the PuzzleKit bug, and bring object literals into the core**
  in argument and nested positions. They are not allowed at the start of an
  expression, where `{ {` is ambiguous with the interpolation brace. Keys are
  identifiers or quoted strings and values are core expressions; there is no
  shorthand, no computed key and no spread. PuzzleKit codegen scopes the
  values only. Today it scopes the keys too, emitting `{__d.height: 480}`,
  which is invalid JavaScript that only the bundler catches.
- **Why:** Sites' image formatters take option objects (4 starter-theme uses),
  and PuzzleKit app formatters benefit the same way. Today it is a build
  failure in PuzzleKit.
- **Changes:** PuzzleKit codegen. Sites confirms its accepted form matches this
  rule; if it accepts more than this, the extra stays a Sites addition.
- **Breaking:** no.
- **Templates:** none in PuzzleKit (object literals do not compile there
  today). The 4 Sites starter uses (`image_tag({class: …})`) keep working.

## Batch 2 — rendering, whitespace, escaping

**V6 — value printing.**
- **PROPOSED: Unify on one core printing rule.** Absent prints nothing.
  Booleans print `true`/`false`. Numbers print by ECMAScript
  Number::toString: the shortest round-trip decimal, with exponent form at or
  above 1e21 and below 1e-6. `NaN` and ±Infinity print nothing. A list prints
  its items by this same rule, joined with `,`. An object prints nothing and
  raises a development warning.
- **Why:** `NaN`, `Infinity`, `[object Object]` and `[object]` never belong on
  a page, and printing nothing matches the absent rule. The JavaScript number
  format is a published algorithm that Go can implement, and PuzzleKit already
  has it.
- **Changes:** PuzzleKit runtime text coercion (non-finite numbers and
  objects); Sites value printing (the exponent range and objects).
- **Breaking:** both, in edge cases only.
- **Templates:** none found. The values arrive at runtime, so a scan cannot
  prove this. No template prints a non-finite literal or interpolates a
  value known to be an object.

**V9 — a list or object in a brace-only attribute.**
- **PROPOSED: Unify on Sites.** In a brace-only attribute on an element, a
  list prints its items (by the V6 rule) joined with single spaces, so
  `class={ classes }` accepts a list. An object omits the attribute and raises
  a development warning. Text interpolation keeps the comma join from V6.
  Props are unaffected: a list passed as a prop stays a list.
- **Why:** a space-joined list is what `class`, `rel` and the `aria-*`
  ID-list attributes need, and `[object Object]` in markup is never wanted.
- **Changes:** PuzzleKit runtime (`setAttr` stringification).
- **Breaking:** PuzzleKit (a list attribute joined with commas now joins with
  spaces).
- **Templates:** none found. The one brace-only list literal in PuzzleKit
  (`InputOtpDoc.pzl`, `{ [3, 3] }`) is a prop. A scan cannot see data fields
  holding lists that feed an element attribute; pieces build their class
  strings with `join(' ')` in `data()`.

**V10 — whitespace edges.** *Needs Cory's judgment.*
- **PROPOSED: Unify on a merged rule that both hosts adopt:**
  1. Whitespace with no newline collapses to one space (both hosts already).
  2. Whitespace containing a newline at a parent's first- or last-child edge
     is dropped (both hosts already).
  3. Between two elements (components and markers included) it is dropped.
     This is PuzzleKit's rule; Sites changes.
  4. Between text or an interpolation and an element, in either order, it
     collapses to one space. This is Sites' rule; PuzzleKit changes.
  5. Between text or an interpolation and a control-block boundary it keeps
     one space, which is D168's control-flow rule. Sites changes.
  6. `<pre>` and `<textarea>` bodies are preserved exactly. This is Sites'
     rule; PuzzleKit changes.
- **Why:** rule 3 stops source indentation from putting gaps between
  inline-block siblings such as buttons and badges. Rule 4 fixes a visible
  PuzzleKit bug: prose that wraps an inline element across lines renders
  glued together. Checked with `pzlc` on 2026-09-24: `tokens —`, newline,
  `<code>a</code>,`, newline, `<code>b</code>`, newline, `and more` compiles to
  the text `tokens —a,band more`. The puzzle-pieces demo's Theming page is
  written exactly this way. Rule 6 is what HTML authors expect for code
  blocks.
- **Changes:** both: PuzzleKit's compiler whitespace pass and Sites' renderer
  whitespace pass. [[DECISION-D168-TEXT-RUN-WHITESPACE]] is rewritten in place
  to state the merged rule.
- **Breaking:** both.
- **Templates:**
  - PuzzleKit: about 965 line breaks between text and an inline element, in
    119 files, mostly prose in the puzzle-pieces demo. These gain the space
    they are missing today. 9 files have `<pre>` or `<textarea>`.
  - PK apps: 7 such line breaks in 7 files, and 6 files with `<pre>` or
    `<textarea>`.
  - Sites: 29 line breaks between inline siblings, in 14 files, lose their
    gap (rule 3), and 30 interpolation-to-block line breaks, in 19 files, gain a
    space (rule 5).
- **The question:** adopt the merged rule, so both hosts change, or take one
  host's rule wholesale? Taking PuzzleKit's rule keeps the prose glue, and
  authors must write `{ ' ' }`. Taking Sites' rule is HTML-like, and brings
  back the indentation gaps between inline-block siblings.

**V11 — text inside `{#raw}`.**
- **PROPOSED: Unify on PuzzleKit.** Text inside `{#raw}` follows the core text
  rule and is not entity-decoded. Sites escapes `&`, `<` and `>` in raw-block
  text, except inside `<script>` and `<style>`, where both hosts write the
  text verbatim. Markup inside `{#raw}` stays markup in both hosts.
- **Why:** `{#raw}` exists to make braces literal, not to change the text
  rule. One rule for all text.
- **Changes:** the Sites renderer. **Breaking:** Sites.
- **Templates:** none found. Sites has 2 raw blocks, both in fixtures, and
  neither contains `&` or text `<`. PuzzleKit has none.

## Batch 3 — components, slots, loops

**V12 — `{#for}` input outside its domain.**
- **PROPOSED: Unify.** `{#for x in c}` iterates lists. An absent collection
  runs zero times with no warning. Any other non-list (a string, an object, a
  number) runs zero times and raises a development warning, in both hosts.
  Range bounds are truncated toward zero, with a development warning when a
  bound was not an integer. That is PuzzleKit's truncation; Sites today
  renders nothing. An absent bound runs the range zero times.
- **Mechanism in PuzzleKit:** codegen and `listRows` guard the collection
  (absent becomes an empty list, with a list check). This is template code,
  not script.
- **Why:** a missing list loops zero times, and a template never means to walk
  a string's characters. For bounds, both behaviors avoid a crash;
  PuzzleKit's is published, so by the tie-break Sites changes.
- **Changes:** PuzzleKit (absent and non-list collections) and Sites
  (non-integer bounds).
- **Breaking:** PuzzleKit (a loop over a string's characters stops) and Sites
  (bounds).
- **Templates:** none found. 458 PuzzleKit loops in 193 files, 141 PK-app
  loops in 69 files and 58 Sites loops in 39 files all iterate list-shaped
  paths. All 18 range loops use integer literals.

**V13 — two default markers in exclusive branches.**
- **PROPOSED: Unify on Sites: at most one per render path.** A default marker
  (`<Children/>` or a bare `<Slot/>`), and a `<Slot name="x">` for any one
  name, may appear once on any single render path. Two markers in mutually
  exclusive branches of one `{#if}`/`{:else}` or `{#case}` are legal. Markers
  inside loops (the snippet pattern) keep today's rules. The check lives in
  the shared parser (`compiler/internal/parser`, the "duplicate default
  marker" error), so one change serves both hosts; Sites picks it up at its
  next parser sync.
- **Why:** `{#if compact}<div><Children/></div>{:else}<section><Children/></section>{/if}`
  is a real layout need, and only one of the two ever renders.
- **Changes:** the shared parser. **Breaking:** no; the parser accepts more
  than before.
- **Templates:** none found. No file in any corpus has two default markers,
  apart from a Sites error fixture that puts both on one path, which stays an
  error.

**V14 — when is a slot "filled"?** *Needs Cory's judgment.*
- **PROPOSED: Unify on a dynamic rule.** A position is filled when the content
  supplied for it renders at least one node that is not whitespace-only text.
  A call-site `{#if}` that renders nothing, and a `{#for}` over an empty list,
  both leave the position unfilled, so the fallback shows, in both hosts.
- **Why:** it matches D141's wording ("renders only when nothing fills that
  position"), and it gives the empty-state pattern for free:
  `<List>{#for}…{/for}</List>` with a fallback body of "Nothing here yet".
  PuzzleKit's current split, where a false `{#if}` counts as filling and an
  empty `{#for}` does not, is a side effect of the `{#if}` placeholder node,
  not a design choice.
- **Changes:** the PuzzleKit runtime (`expandChildList` treats `{#if}`
  placeholders and empty expansions as unfilled). The Sites renderer renders
  the call-site content first and falls back when the result is
  whitespace-only.
- **Breaking:** both.
- **Templates:** none found. The heuristic finds 0 call sites whose only
  content is a block, passed to a component whose default marker has a
  fallback. Fallback bodies exist in 29 PuzzleKit files, 17 PK-app files and 1
  Sites fixture.
- **The question:** the dynamic rule (recommended), or a static rule where any
  authored content that is not whitespace fills the position? The static rule
  is Sites' behavior today; under it PuzzleKit changes only the empty-`{#for}`
  case. It can be decided at compile time, but it gives no empty-state
  behavior.

**V16 — dotted component tags in Sites.**
- **PROPOSED: Host-specific resolution.** The tag grammar is core; how a tag
  finds its file is a host rule, as [[DOC-LANGUAGE-CORE]] already says. In
  Sites, `<Frame.Wrapper>` resolves to `components/Frame.Wrapper.pzl`. The
  folder stays flat, the file-name pattern grows to
  `^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)*$`, and `<Frame>` still resolves to
  `components/Frame.pzl`.
- **Why:** the file name mirrors the tag exactly and stays easy to grep.
  PuzzleKit resolves families through the `Object.assign` barrel, which has no
  Sites equivalent.
- **Changes:** the Sites resolver and theme validation. **Breaking:** no.
- **Templates:** none. Sites uses no dotted tags. Dotted tags appear in 122
  PuzzleKit files and 73 PK-app files, which are unaffected.

## Batch 4 — formatters

See [[DECISION-D174-STANDARD-FORMATTERS]] (F1–F27, the standard set, renames
and the host-only lists). Formatter failure policy (V17) is in batch 5.

## Batch 5 — host-specific declarations

**V7 — text units and Unicode.**
- **PROPOSED: Host-specific, declared.** `.length` on a string counts UTF-16
  units in PuzzleKit and code points in Sites. Case mapping follows each
  host's Unicode tables (`ß` upcases to `SS` in PuzzleKit and stays `ß` in
  Sites). The whitespace set that `trim` removes differs on U+0085 and U+FEFF.
  The core spec states these as host-defined and tells authors to use the
  `size` formatter for a text length. D174 makes the formatter counts
  identical: `size`, `truncate`, `reverse` and `split('')` count code points
  in both hosts.
- **Why:** to count code points, PuzzleKit's `.length` would need a runtime
  helper on every `.length`, since codegen cannot tell a string from a list,
  and the difference only shows for characters outside the BMP, such as
  emoji. The formatters are the cheap, portable path.
- **Changes:** none here (docs). **Breaking:** no.
- **Templates:** none found. `.length` appears 79 times in 40 PuzzleKit files,
  35 times in 26 PK-app files and 17 times in 13 Sites files, all on lists.

**V15 — how a component reads its props.**
- **PROPOSED: Host-specific, declared, plus one PuzzleKit addition.** A
  PuzzleKit component with no `<script>` gets a synthesized
  `data(params, props)` that returns its props, so `{ tone }` reads the prop,
  as in Sites. A component with a script keeps PuzzleKit's rule: its `data()`
  decides.
- **Why:** how props reach scope is inherent to each host. PuzzleKit has a
  model layer and Sites has none. The script-less component is the one case
  that could be portable, and PuzzleKit renders it empty today, which helps
  nobody.
- **Changes:** PuzzleKit codegen (the synthesized class for script-less
  files). **Breaking:** no.
- **Templates:** none. PuzzleKit has 1 script-less file, with no
  interpolations; PK apps have none.

**V17 — formatter failure policy.**
- **PROPOSED: Host-specific (a restriction).** Each host sets its own policy
  for an unknown formatter name, a wrong argument count, and out-of-domain
  input. Sites fails the compile, or warns and renders empty. PuzzleKit
  passes the value through and logs a development error, because its app
  formatters are registered in JavaScript at runtime, where the compiler
  cannot see every name. The in-domain behavior of the standard set is
  identical (D174). Once V6 prints `NaN` as empty, most numeric out-of-domain
  results already agree. An optional PuzzleKit tightening: check the argument
  counts of built-in formatters at compile time from `builtins.json`.
- **Changes:** none required. **Breaking:** no.
- **Templates:** none found. The only unknown names are in Sites error
  fixtures (`nosuchformatter`, `captialize`).

**V18 — scoped styles and `{#svg}` paths.**
- **PROPOSED: Scoped styles are host-specific.** The stamping algorithm is
  shared; the attribute prefix and the stamp target are host-defined.
  **The `{#svg}` path is unified:** it is relative to the host's assets root
  in both hosts. Sites stops accepting an explicit `assets/` prefix and makes
  it a compile error steering to the bare path.
- **Why:** today `{#svg 'assets/x.svg'}` names two different files (in
  PuzzleKit, `app/assets/assets/x.svg`). That is exactly a same-spelling,
  different-meaning case, and no template uses the prefix.
- **Changes:** the Sites `{#svg}` path check. **Breaking:** Sites.
- **Templates:** none found. No `{#svg}` path has the `assets/` prefix; the 36
  in Sites (15 files), 2 in PuzzleKit and 10 in PK apps are all bare. Scoped
  styles: 1 Sites fixture, none in PuzzleKit.

## Needs Cory's judgment

These need a decision, not just an approval. The recommended answer is the
proposal above.

1. **V2:** should `==` mean strict equality in templates (recommended), or
   should the core reject it and Sites rewrite 35 uses in 21 files?
2. **V10:** the merged whitespace rule (recommended, both hosts change), or one
   host's rule wholesale?
3. **V14:** is "filled" dynamic, meaning the content rendered something
   (recommended), or static, meaning content was authored?

The formatter judgment items are on D174.

## Alternatives considered

- **V1: keep block headers plain**, so a pipe in a header is a compile error
  in both hosts. This is smaller, but Sites needs list filtering in loops,
  and `{#let}` only moves the chain to another line.
- **V4: make `?.` mandatory in the core**, with PuzzleKit left as it is. That
  keeps a crash in PuzzleKit for any author who forgets `?.`, and it turns
  every existing Sites path into non-core syntax.
- **V5: unify on Sites through runtime helpers.** That costs work on every
  render. Helpers in development builds only are not an option, because
  production would then behave differently from development.
- **V7: count code points in PuzzleKit's `.length`.** That needs a helper on
  every `.length` access, for results that differ only outside the BMP.
- **V12: Sites' "render nothing" for non-integer bounds.** Both behaviors are
  safe; the tie-break keeps the published one.
- **V16: one folder per family** (`components/Frame/Wrapper.pzl`). That gives
  `<Frame>` two possible homes (`Frame.pzl` or a file in `Frame/`) and breaks
  the flat-folder rule.
- **Leave everything host-defined.** That contradicts D172's rule: a
  same-spelling, different-meaning case must get a new spelling or be made
  identical. Host-defined is kept here only where the difference is inherent
  to the host (V5, V7, V15, V16, V17 and the V18 styles).

## Consequences

If approved, the build list is:

**PuzzleKit** ([[COMPONENT-CODEGEN]], the runtime, the shared parser):
- Codegen: the pipe in attribute, prop and header positions (V1); `==` emitted
  as `===` (V2); `null`/`undefined` literal comparisons lowered (V3);
  optional chaining for member access (V4); values-only scoping inside object
  literals (V8); a synthesized `data()` returning props for script-less
  components (V15); the merged whitespace pass and `<pre>`/`<textarea>`
  preservation (V10).
- Shared parser: exclusive-branch markers (V13).
- Runtime: text printing (V6), `setAttr` lists and objects (V9), the loop
  guard (V12, codegen plus `listRows`), and the slot-filled rule (V14).
- Measure bytes and render time against the D170 bench gates, especially for
  V4.
- Docs: [[DOC-SPEC-TEMPLATE]] §6 and §24; D168 and D141 rewritten in place;
  [[DOC-LANGUAGE-CORE]] turns each approved item from a known divergence into
  a core rule.

**Sites** (its own repo and cards):
- Evaluator: chains in block headers (V1) and value printing (V6).
- Renderer: whitespace (V10), raw-block escaping (V11), loop bounds (V12), the
  slot-filled rule (V14), the `{#svg}` prefix error (V18), and dotted-tag
  resolution (V16).
- The one starter-theme change here is whitespace (V10). Everything else
  found no affected template.

**Shared:** a conformance fixture for every approved item, run by both hosts.
This is the only real proof that a unified item is identical.

**Breaking-change count under the recommended answers:**
- PuzzleKit: 8 (V1, V2, V3, V6, V9, V10, V12, V14). Only V10 changes the
  output of existing templates, and there it fixes glued prose.
- Sites: 6 (V6, V10, V11, V12, V14, V18). Only V10 changes the output of
  existing templates. If V2 goes the other way (the core rejects `==`), Sites
  gains a seventh break: 35 uses in 21 files.
