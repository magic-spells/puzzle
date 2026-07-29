# Puzzle-Upgrade-Binding — migrating existing projects to D147 implicit two-way binding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit and upgrade projects that consume the Puzzle framework — **puzzle-pieces
first** — so that nothing changes behavior silently under the 0.5.0 compiler, and so the
code that *should* adopt handler-less binding does.

**Architecture:** Audit-first, compile-as-ground-truth. The 0.5.0 compiler auto-binds
qualifying `value=`/`checked=` attributes; an author `@input`/`@change` on the element
suppresses synthesis entirely, so suppressed sites are byte-identical and safe. The only
risk class is a **handler-less, path-shaped** `value=`/`checked=` on a plain form control
that was previously display-only — it silently starts writing back. You find those by
compiling every `.pzl` with the 0.5.0 single-file compiler and grepping the output for
`__bind(` — never by eyeballing templates.

**Tech stack:** Puzzle ≥ 0.5.0 (`feat/two-way-binding` branch of
`/Users/coryschulz/Code/@magic-spells/puzzle` until it merges/publishes); `pzlc`
(single-file compiler, built from that repo); ripgrep.

## Global Constraints

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
  **Default for this plan: Tasks 1–4 (audit + escapes) land now; Task 5
  (modernization) lands only if Cory approves the ≥ 0.5.0 floor.**
- **The three no-syntax escapes** (to make a site deliberately one-way): keep/add an
  author `@input`/`@change`; use a non-path expression — `value={ String(x) }` is the
  idiom; or add static `readonly`. Add a one-line comment at every escape you write.
- **No grammar/tooling changes anywhere.** D147 is keyword-free: editor grammars
  (vscode/sublime/zed), puzzle-eslint, and puzzle-prettier need NOTHING. Do not
  "upgrade" them.
- Repos and paths: framework `/Users/coryschulz/Code/@magic-spells/puzzle`; pieces
  `/Users/coryschulz/Code/@magic-spells/puzzle-pieces` (pieces live in
  `registry/ui/<piece>/<Piece>.pzl` + `registry/lib`; demo app in `demo/`). Each repo
  gets its own branch; commit per task; never commit to another repo from this one.

## The triage decision tree (apply to every `value={`/`checked={` hit)

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
  framework repo's `examples/music/Playlist.pzl` was exactly this shape).

- [ ] **Step 5: Commit**

```bash
git add notes/d147-audit.md
git commit -m "audit: D147 implicit-binding inventory for every registry piece"
```

### Task 3: Fix every unintended new bind

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

- [ ] **Step 4:** Update the inventory rows to `done`, commit:

```bash
git add registry notes/d147-audit.md
git commit -m "fix: escape unintended D147 binds; keep prop-driven pieces handler-owned"
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
- [ ] **Step 3:** Run whatever test suite the pieces repo has (check `package.json`
  scripts; run all of them). Commit any test updates with the reason in the message.

### Task 5: Modernization pass — GATED on Cory approving a ≥ 0.5.0 registry floor

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

### Task 6: Repeat the audit for the other consumer repos

Same method (Tasks 1–4; Task 5 thinking optional per repo), one branch per repo, in
this order of value: the **puzzle site**, **pyramid-puzzle**, **tarot** (wrapper +
example app), **puzzle-music-demo**. For each repo record the same inventory file. Two
notes: (a) apps compile with THEIR installed puzzle — nothing changes until they bump
to 0.5.0, so land these branches with the version bump; (b) the highest-yield targets
are search boxes, filters, and edit-in-place fields committed by key handlers — the
buffer pattern again.

---

## Reviewer checklist (per repo)

- Every `rg 'value=\{|checked=\{'` hit appears in the inventory with a verdict.
- Zero unexplained `__bind(` in compiled output vs. the inventory's BLESS rows.
- No deleted handler that did more than mirror; no piece binding a prop-derived key.
- Browser pass done with zero clobber-canary warnings; suites green.
- Task 5 only present if the version-floor approval is on record.
