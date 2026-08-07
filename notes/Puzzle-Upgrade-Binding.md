# Puzzle-Upgrade-Binding — migrating existing projects to 0.5.0

Two axes: **A. implicit two-way binding (D147)** and **B. composition markers, fallback
bodies, and Portal (D134 / D141 / D144)**.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit and upgrade projects that consume the Puzzle framework — **puzzle-pieces
first** — so that nothing changes behavior silently under the 0.5.0 compiler, and so the
code that *should* adopt handler-less binding, fallback bodies, or `<Portal>` does.

**Architecture:** Audit-first, compile-as-ground-truth. Both axes have the same shape: a
template that compiled one way before compiles another way now, with **no source change and
no error**. You find those by compiling every `.pzl` with the 0.5.0 single-file compiler and
grepping the output for the two tell-tale symbols — `__bind(` (axis A) and `PORTAL_TAG`
(axis B) — never by eyeballing templates.

- **Axis A.** The 0.5.0 compiler auto-binds qualifying `value=`/`checked=` attributes; an
  author `@input`/`@change` on the element suppresses synthesis entirely, so suppressed
  sites are byte-identical and safe. The risk class is a **handler-less, path-shaped**
  `value=`/`checked=` on a plain form control that was previously display-only — it
  silently starts writing back.
- **Axis B.** A project shipping its own `Portal` component keeps compiling, but the tag
  now means the framework's portal — children teleport to the app root. That is the only
  silent axis-B change; everything else is a compile error or purely additive.

**Tech stack:** Puzzle ≥ 0.5.0 (`feat/two-way-binding` branch of
`/Users/coryschulz/Code/@magic-spells/puzzle` until it merges/publishes); `pzlc`
(single-file compiler, built from that repo); ripgrep.

## Global Constraints — axis A (binding)

- **The contract (memorize this; it is the whole feature).** A `value=` or `checked=`
  auto-binds only when ALL hold: (1) plain `<input>`/`<textarea>`/`<select>` — NEVER a
  component tag; (2) the expression is exactly `ident` or `ident.ident` — any call,
  operator, bracket, `?.`, ternary, formatter pipe, deeper chain, or `this.` prefix
  means no bind; (3) no author `@input` or `@change` on the element (any modifiers —
  either one suppresses; other events like `@keydown:enter` do NOT suppress); (4) no
  static `readonly`/`disabled`; (5) `type` absent or a static classifiable string —
  dynamic `type={ }`, `radio`, `file`, `submit`, `button`, `reset`, `image`, `hidden`,
  and `<select multiple>` never bind; `checked` binds only with static
  `type="checkbox"`. Full contract: `constellation/decision/
  DECISION-D147-IMPLICIT-TWO-WAY-BINDING.md` and SPEC §6 in the framework repo.
- **Suppression is the safety net.** A site with an author `@input`/`@change` compiles
  byte-identically to pre-0.5.0. Never delete a handler that does anything beyond
  mirroring (trim, clamp, validation, timestamps, side effects, callback-prop calls).
- **Binding never crosses component boundaries.** `<Input value={ x } />` on a
  component tag is a plain prop (D16 stands). A piece that surfaces its value to the
  app does so via callback props — those pieces KEEP their internal handlers forever;
  that is the correct pattern, not legacy.
- **The layer-clobber trap (pieces-specific).** Inside a piece, `value={ value }` where
  `data()` derives `value` from `props.value` is a bare local bind: the synthesized
  write goes to the piece's LOCAL state, and the next props-driven `data()` commit
  reverts it (dev builds warn once per key: "a data() commit reverted the bound key").
  Any handler-less inner control on a prop-derived key is a bug under 0.5.0 — fix with
  a handler (usual) or a non-path escape.
- **Back-compat gate for modernization.** Pieces are copied into apps and compiled by
  the APP's compiler. A piece that deletes its mirror handler to rely on auto-binding
  is broken (one-way) under any pre-0.5.0 compiler. Deleting handlers in the registry
  is therefore gated on Cory's minimum-supported-puzzle decision for the registry.
  **Default for this plan: Tasks 1–4 (audit + escapes, both axes) land now; Tasks 5–6
  (modernization) land only if Cory approves the ≥ 0.5.0 floor.**
- **The three no-syntax escapes** (to make a site deliberately one-way): keep/add an
  author `@input`/`@change`; use a non-path expression — `value={ String(x) }` is the
  idiom; or add static `readonly`. Add a one-line comment at every escape you write.
- **No grammar/tooling changes anywhere** (both axes). D147 is keyword-free, and
  `<Portal>` is an ordinary capitalized paired tag as far as a highlighter is concerned —
  the grammars deliberately do not special-case `Slot`/`Children`, so they need nothing for
  `Portal` either (see the comment in `puzzle-vscode/test/grammar.test.js`). Editor grammars
  (vscode/sublime/zed), puzzle-eslint, and puzzle-prettier need NOTHING. Do not "upgrade"
  them. Adding `<Portal>` to their *test fixtures* is optional polish, not migration.
- Repos and paths: framework `/Users/coryschulz/Code/@magic-spells/puzzle`; pieces
  `/Users/coryschulz/Code/@magic-spells/puzzle-pieces` (pieces live in
  `registry/ui/<piece>/<Piece>.pzl` + `registry/lib`; demo app in `demo/`). Each repo
  gets its own branch; commit per task; never commit to another repo from this one.

## Global Constraints — axis B (slots and Portal)

- **Markers are `<Children/>`, `<Slot/>`, `<Slot name="x"/>`, `<Portal>…</Portal>`.**
  Any lowercase spelling is a compile error that names its replacement — loud, so it is
  find-and-fix, not audit-for-silence.
- **A paired marker's body is fallback content**, rendered only when nothing fills the
  position. Pre-0.4.0 fallback bodies keep working: respell the tag, keep the body.
- **`Portal` is the one silent break.** Markers are matched before component resolution,
  so a consumer component named `Portal` (or `Children`/`Slot`) is swallowed — the tag
  compiles to a framework portal, the import goes unused, nothing errors. Rename the
  component. Same for a `PORTAL_TAG`/`SLOT_TAG` script binding.
- **Every other Portal misuse is a compile error whose message names the fix** —
  attributes, self-closing, inside an island, inside a fallback body, as a component root
  (wrap it: `<div style="display: contents">`). A marker inside another marker's fallback
  body is an error too.
- **Portaled content is absent from prerendered HTML** (SSG/static) and unmounts instead of
  fading in router overlap transitions. Never portal content that must be crawlable.
- **A `value=` inside a fallback body still auto-binds** (axis A applies everywhere) — it
  writes the owning component's state and vanishes when a caller fills the slot.
- **Repo state:** pieces, the site, pyramid-puzzle, and puzzle-music-demo are already on
  `^0.4.0` with capitalized markers, so axis B is mostly the reserved-name grep for them.
  In puzzle-pieces work from **`release/0.2.0`** — `main` is still pre-D134 (26 files with
  lowercase markers). The tarot pair never crossed 0.4.0 and needs the real migration.

## The triage decision tree (axis A — apply to every `value={`/`checked={` hit)

```
Is the tag a component (capitalized)?            → NO-OP (props never bind)
Is it <option value=…> or another non-control?   → NO-OP
Does the element carry author @input/@change?    → SUPPRESSED (safe today)
    …and is that handler a PURE mirror?          → candidate for Task 5 modernization
Handler-less. Does the compiled output gain __bind( for it?
    NO (expression doesn't classify)             → NO-OP (stays display-only)
    YES:
      Was this site ALREADY editable state the author mirrors elsewhere
      (e.g. a @keydown-committed edit buffer)?   → ESCAPE with String(x) + comment
      Is the bound key prop-derived inside a
      component/piece (layer-clobber trap)?      → add handler or ESCAPE + comment
      Is two-way writing what the site WANTS?    → BLESS: verify the write target is
                                                   the path you want written; test it
```

"Pure mirror" means the handler body is exactly one state write of the control's own
value — `this.setData('x', event.target.value)` or `rec.update({ x: event.target.value })`
— with no coercion, trimming, clamping, validation, side effects, or callback-prop calls.

## The triage decision tree (axis B — apply to every marker and `Portal` identifier)

```
Lowercase <children>/<slot>/<portal>?     → respell (it will not compile otherwise)
Paired marker with a body?                → NO-OP, that is fallback content now
Component/import/file named Portal,
  Children, or Slot?                      → SILENT BREAK — rename it
Overlay clipped by an ancestor
  (overflow, transform, stacking)?        → Portal adoption candidate (Task 6, gated)
```

---

### Task 1: Build the 0.5.0 `pzlc` and baseline the pieces repo

**Files:**
- Create: `/tmp/pzlc-050` (built binary; outside both repos)
- Repo state: new branch `chore/d147-binding-audit` in puzzle-pieces

- [ ] **Step 1: Build the single-file compiler from the framework checkout**

```bash
cd /Users/coryschulz/Code/@magic-spells/puzzle
git rev-parse --abbrev-ref HEAD   # note it; feat/two-way-binding or later — must contain D147
go build -o /tmp/pzlc-050 ./compiler/cmd/pzlc
/tmp/pzlc-050 --help | head -3    # sanity: it runs
```

- [ ] **Step 2: Prove the binary synthesizes binds** (guards against building a stale branch)

```bash
cd /tmp && cat > bindprobe.pzl <<'EOF'
<puzzle-view>
  <input value={ draft } />
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class BindProbe extends PuzzleView {
  data() { return { draft: '' }; }
}
</script>
EOF
/tmp/pzlc-050 --mode view bindprobe.pzl bindprobe.out.js
grep "__bind(null, 'draft', 'v')" bindprobe.out.js   # MUST match; abort if not
```

- [ ] **Step 2b: Prove the binary knows `<Portal>`** (same guard, axis B)

```bash
cd /tmp && cat > portalprobe.pzl <<'EOF'
<puzzle-view>
  <div><Portal><p>overlay</p></Portal></div>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class PortalProbe extends PuzzleView {}
</script>
EOF
/tmp/pzlc-050 --mode view portalprobe.pzl portalprobe.out.js
grep "PORTAL_TAG" portalprobe.out.js                 # MUST match; abort if not
```

- [ ] **Step 3: Branch the pieces repo**

```bash
cd /Users/coryschulz/Code/@magic-spells/puzzle-pieces
git status --porcelain      # expect clean; STOP and report if not
git checkout -b chore/d147-binding-audit
```

- [ ] **Step 4: Commit nothing yet** — this task produces the tool and the branch only.

### Task 2: Ground-truth audit of every piece

**Files:**
- Create: `notes/d147-audit.md` in puzzle-pieces (the inventory — this file IS the
  deliverable reviewers check later tasks against)

- [ ] **Step 1: Collect the textual hits**

```bash
cd /Users/coryschulz/Code/@magic-spells/puzzle-pieces
rg -n 'value=\{|checked=\{' registry demo -g '*.pzl'
```

- [ ] **Step 2: Compile every `.pzl` and grep for synthesized binds** (ground truth —
  the classifier, not your eyes, decides)

```bash
mkdir -p /tmp/pieces-compiled && cd /Users/coryschulz/Code/@magic-spells/puzzle-pieces
for f in $(rg --files registry demo -g '*.pzl'); do
  out="/tmp/pieces-compiled/$(echo "$f" | tr '/' '_').js"
  /tmp/pzlc-050 --mode component "$f" "$out" 2>>/tmp/pieces-compile-errors.txt \
    || echo "COMPILE-FAIL $f" >> /tmp/pieces-compile-errors.txt
done
rg -l "__bind\(" /tmp/pieces-compiled/
cat /tmp/pieces-compile-errors.txt
```

  Note: pieces that only compile as views/layouts may need `--mode view`; retry
  failures with the other mode before recording them. A `bind:value`-style attr
  anywhere now fails with "attribute namespaces are reserved" — record those as
  findings too (there should be none).

- [ ] **Step 3: Write the inventory** — `notes/d147-audit.md`, one row per hit from
  Step 1: `file:line | expression | element+type | author handlers on the element |
  __bind in compiled output? | verdict (from the decision tree) | action`. EVERY row
  gets a verdict; no row may say "probably".

- [ ] **Step 4: Cross-check the two watch-lists against the inventory:**
  the **clobber list** (every piece whose inner control binds a prop-derived key —
  DatePicker, Calendar, QuantityInput, InputOtp, Rating, DataTable and friends are the
  likely suspects) and the **buffer list** (any control whose value a
  `@keydown`/`@blur`/button handler commits — these silently become live-bound; the
  framework repo's `examples/music/Playlist.pzl` was exactly this shape). A `__bind(` can come from inside a
  fallback body — still a real bind, so give it a row like any other.

- [ ] **Step 5: Composition sweep (axis B)** — three greps, recorded at the bottom of the
  same inventory file. Every hit is fix-now, not defer.

```bash
rg -n '<children|</children>|<slot|</slot>|<portal|</portal>' registry demo -g '*.pzl'   # respell
rg -n '(Portal|Children|Slot)\.pzl' registry demo                                       # rename
rg -n 'PORTAL_TAG|SLOT_TAG' registry demo -g '*.pzl'                                     # rename
```

- [ ] **Step 6: Commit**

```bash
git add notes/d147-audit.md
git commit -m "audit: binding + composition inventory for every registry piece"
```

### Task 3: Fix every unintended new bind and every reserved-name collision

**Files:**
- Modify: each piece the inventory marked ESCAPE or add-handler (exact list comes from
  Task 2 — the inventory is the spec for this task)

- [ ] **Step 1:** For each ESCAPE row: apply `value={ String(x) }` (or static
  `readonly` where the control is genuinely read-only), plus a one-line comment naming
  why: `<!-- non-path expr: committed by @keydown:enter, not live-bound (D147) -->`.
- [ ] **Step 2:** For each clobber-trap row where the piece SHOULD be interactive:
  keep/add the author `@input`/`@change` handler that routes through the piece's
  callback prop (the D16 pattern) — do not leave a bind writing a prop-derived local.
- [ ] **Step 3: Recompile the changed pieces and re-grep** — each fixed file must now
  show NO `__bind(` in its compiled output:

```bash
for f in <changed files>; do /tmp/pzlc-050 --mode component "$f" /tmp/recheck.js && rg -c "__bind\(" /tmp/recheck.js || echo "CLEAN $f"; done
```

- [ ] **Step 4: Axis-B fixes.** Respell lowercase markers; rename any component or script
  binding that collides with `Portal`/`Children`/`Slot`/`PORTAL_TAG`/`SLOT_TAG` at its
  definition, imports, and invocations. Grep the old name afterward — expect zero.

- [ ] **Step 5:** Update the inventory rows to `done`, commit:

```bash
git add registry notes/d147-audit.md
git commit -m "fix: escape unintended D147 binds; rename reserved-tag collisions for D144"
```

### Task 4: Verify against the demo app in a real browser

- [ ] **Step 1:** Point the demo at the 0.5.0 framework (symlink or `file:` dep — check
  `demo/package.json` for how it links `@magic-spells/puzzle` today and mirror it), and
  build/dev the demo with the 0.5.0 CLI (`go build -o /tmp/puzzle-050
  ./compiler/cmd/puzzle` in the framework repo if a CLI is needed).
- [ ] **Step 2:** Click through every form-bearing piece demo: typing keeps the caret
  mid-word, values propagate exactly as before the upgrade, and the dev console shows
  **zero** `[puzzle] a data() commit reverted the bound key` warnings — that warning is
  the clobber canary; any occurrence is a missed Task 3 row, go back.
- [ ] **Step 3: Composition pass.** Open every piece with a fallback body both ways — slot
  empty (stock chrome shows) and slot filled (caller's content wins). Then check
  `[data-puzzle-portal]`: absent with no portals open, gone again after closing every
  overlay. A lingering outlet with children is a framework teardown leak — report it.
- [ ] **Step 4:** Run whatever test suite the pieces repo has (check `package.json`
  scripts; run all of them). Commit any test updates with the reason in the message.

### Task 5: Modernization pass A — implicit binding — GATED on Cory approving a ≥ 0.5.0 registry floor

Do NOT start this task without the explicit go-ahead recorded in the PR/thread.

- [ ] **Step 1:** From the inventory's "pure mirror" rows only: delete the mirror
  handler and its `events` entry, leaving the bare `value={ x }`/`checked={ x }` bind.
  Only genuinely internal-local state qualifies — anything surfacing through a callback
  prop keeps its handler (see Global Constraints).
- [ ] **Step 2:** Recompile each modernized piece; its output MUST now contain the
  expected `__bind(` line. Re-run Task 4's browser pass on those pieces.
- [ ] **Step 3:** Bump the registry's documented minimum puzzle version (README +
  wherever `registry.json` records compatibility), noting: "pieces rely on implicit
  two-way binding (D147); requires @magic-spells/puzzle ≥ 0.5.0."
- [ ] **Step 4: Commit** — `feat: adopt implicit binding in internal-state pieces;
  registry floor puzzle >= 0.5.0`. Consuming apps pick pieces up via
  `puzzle add piece <name> --overwrite` (their `pieces.lock` hashes update on copy).

### Task 6: Modernization pass B — adopt `<Portal>` in overlay pieces — SAME GATE

Same version-floor approval as Task 5 (a portal is a hard compile error under any pre-0.5.0
compiler). Only for panels actually clipped or mispositioned by an ancestor today.

- [ ] **Step 1:** Pick candidates from real clipping in the demo, not intuition — a
  dropdown that has never been clipped does not need teleporting.
- [ ] **Step 2: Wrap, don't root** — `<div style="display: contents"><Portal>…</Portal></div>`
  when the overlay is the whole template. Do not invent another workaround.
- [ ] **Step 3:** Delete any hand-rolled `contains()` dismiss guard that existed to
  compensate for the old DOM position — `@event:outside` counts portaled content as inside.
  Verify clicking inside the panel does not dismiss it.
- [ ] **Step 4:** Check styling — portaled children lose ancestor selectors, inherited
  custom properties, and container queries. Look at each adopted piece, light and dark.
- [ ] **Step 5: Commit** — `feat: portal overlay panels out of ancestor stacking contexts`,
  listing the pieces.

### Task 7: Repeat the audit for the other consumer repos

Same method (Tasks 1–4; Tasks 5–6 optional per repo), one branch per repo: the **puzzle
site**, **pyramid-puzzle**, **tarot** (wrapper + example), **puzzle-music-demo**. Notes:
(a) apps compile with THEIR installed puzzle, so land each branch with the version bump;
(b) highest-yield axis-A targets are search boxes, filters, and edit-in-place fields
committed by key handlers; (c) axis B is nearly free for the repos already on `^0.4.0` —
just the reserved-name grep; (d) the tarot pair is the real migration — `tarot-puzzle-example`
pins `^1.0.0`, a version that has never existed, so settle what it resolves against first;
(e) the site's docs views hold marker syntax inside JS **string literals** — prose, not
templates. Do not "fix" them.

---

## Reviewer checklist (per repo)

**Axis A — binding**

- Every `rg 'value=\{|checked=\{'` hit appears in the inventory with a verdict.
- Zero unexplained `__bind(` in compiled output vs. the inventory's BLESS rows.
- No deleted handler that did more than mirror; no piece binding a prop-derived key.
- Browser pass done with zero clobber-canary warnings; suites green.
- Task 5 only present if the version-floor approval is on record.

**Axis B — slots and Portal**

- Zero lowercase `<children>`/`<slot>`/`<portal>`; zero components named `Portal`,
  `Children`, or `Slot` (checked at file name, import, and invocation).
- Every `PORTAL_TAG` in compiled output traces to a `<Portal>` someone meant to write.
- Fallback bodies verified in the browser both ways: empty slot shows chrome, filled slot
  replaces it.
- Task 6 only present if the version-floor approval is on record.
