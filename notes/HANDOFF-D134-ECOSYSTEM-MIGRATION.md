# D134 ecosystem migration — handoff brief

**Release-gating for 0.4.0.** Read this whole file before scheduling the work;
about a quarter of it is a genuine API design decision, not a rename.

## What D134 changed

Decision card: `constellation/decision/DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS.md`
(status `built`, shipped in commit `926d412` on `fix/grok2-runtime`). SPEC §24 in
`constellation/doc/DOC-SPEC-TEMPLATE.md` carries the contract.

The composition markers are now **capitalized and self-closing only**:

| Spelling | Role |
|---|---|
| `<Children/>` | default marker — receives untagged call-site content |
| `<Slot/>` | router outlet (D30) |
| `<Slot name="x"/>` | named slot |
| `slot="x"` attribute | routes a direct child into a named slot (D53, unchanged) |

> Terminology: these are **capitalized markers**. Do not call this "PascalCase" —
> the framework owner rejected that wording, and it is wrong anyway (the rule is
> "the framework resolves capitalized tags", which also overturned D74's old
> "capitalized means an imported component" rule).

Three things are now **hard compile errors**, raised in
`compiler/internal/parser/parser.go:367-393`, matched *before* component
resolution so they can't be mistaken for a missing import:

```go
if name == "children" {
    return nil, errAt(p.file, pos, "the default marker is spelled <Children/> since v1.64 (D134)")
}
if name == "slot" {
    // with a name attr → steers to `<Slot name="…"/>`
    // bare → "use <Children/> for call-site content or <Slot/> for the router outlet"
}
if name == "Children" || name == "Slot" {
    if !selfClose {
        return nil, errAt(p.file, pos,
            "composition markers are self-closing — fallback content is not supported (D134)")
    }
}
```

`Slot.Children` was removed from the AST outright
(`compiler/internal/parser/ast.go`), so fallback bodies are now structurally
impossible rather than merely rejected. Downstream deletions followed in
`codegen`, `a11y.go`, `refs.go`, `plugin/scan.go`, and the runtime's
`expandChildList`.

**Every error message names its own replacement.** The compiler is the migration
guide; that is deliberate and should be said in the release notes.

## Scope: what actually needs migrating

Confirmed by sweeping every sibling repo under `/Users/coryschulz/Code/@magic-spells`.

### Not affected — do not spend time here

- **`puzzle-eslint`** — `src/` has zero references to slot or children.
- **`puzzle-prettier`** — its `children` identifiers in `src/index.js` are its own
  AST node arrays, unrelated to the markers.
  Both plugins vendor only the **section** splitter (`<script>` / `<style>` / view),
  which never parsed template tags. Nothing to do.
- **`puzzle-sublime`, `puzzle-vscode`, `puzzle-zed`** — none special-case these
  tags. They highlight capitalized tags generically, which is precisely why
  `<Slot/>` and `<Children/>` already highlight correctly today.
  `puzzle-sublime/README.md:30` already documents *"Capitalized component tags such
  as `<AlbumCard />` and `<Slot />`"*. The only cosmetic gap is that a lowercase
  `<slot>` still highlights as a plain HTML element rather than being flagged — the
  compiler catches it, so a grammar change is not worth it.
- **`_archive/`** — dead code, skip.

### Affected — 47 live `.pzl` files across 5 repos

| Repo | Files | Nature |
|---|---|---|
| `puzzle-pieces` | 26 (13 registry + 13 demo mirrors) | **Highest priority — this is distributed** |
| `magic-spells-puzzle-site` | 15 (13 components + 2 docs pages) | Includes docs that teach the old grammar |
| `puzzle-devtools` | 2 (`SplitPanel.pzl`, `Empty.pzl`) | Mechanical |
| `streakwave` | 3 (`Card`, `Empty`, `Dialog`) | Mechanical |
| `puzzle-music-demo` | 1 (`app/components/Button.pzl`) | Mechanical — one `<children/>` |

`puzzle-pieces` is the priority because `puzzle add` copies those registry
components verbatim into user applications. A stale registry means every
`puzzle add` on 0.4.0 installs a component that will not compile.

Regenerate the exact list at any time:

```bash
cd /Users/coryschulz/Code/@magic-spells
rg -l '<slot|<children' -g '*.pzl' -g '!node_modules' -g '!_archive/**' .
```

## Part 1 — the mechanical majority (~29 files)

Self-closing forms are a pure rename:

| Before | After |
|---|---|
| `<children/>` | `<Children/>` |
| `<slot/>` | `<Slot/>` — **but see the caveat below** |
| `<slot name="footer"/>` | `<Slot name="footer"/>` |

**Caveat on bare `<slot/>`:** in a *component*, the old bare `<slot/>` meant "the
call-site's untagged content" and must become **`<Children/>`**, not `<Slot/>`.
`<Slot/>` now means the router outlet exclusively. Getting this wrong compiles
cleanly and renders nothing — it is the one silent failure in this migration.
Rule of thumb: if the file is a route/layout view, `<Slot/>`; if it is a
component receiving call-site content, `<Children/>`.

Known bare-`<slot/>` sites needing the `<Children/>` reading include
`tarot-puzzle/src/TarotCarousel.js` (a doc comment) and its `docs/DESIGN.md` /
`docs/PUZZLE-FRICTION.md` prose.

## Part 2 — the design problem: 18 files, 6 components, no mechanical answer

D134 removed fallback bodies. **It also explicitly deferred the is-slot-filled
probe** (card lines 71 and 106: *"is-slot-filled probe … deferred until real
demand"*). Real demand turns out to already exist in the ecosystem.

Six components rely on slot fallback content, each triplicated across
`puzzle-pieces/registry`, `puzzle-pieces/demo`, and `magic-spells-puzzle-site` —
18 files, but only **6 distinct fixes**:

| Component | Pattern |
|---|---|
| `HoverCard` | `<slot name="trigger">{ label }</slot>` |
| `Popover` | `<slot name="trigger">{ label }</slot>` |
| `Popconfirm` | `<slot name="trigger">{ triggerLabel }</slot>` |
| `DropdownMenu` | multi-line: `<span>{ label }</span>` + a chevron `<svg>` |
| `EmojiPicker` | multi-line trigger chrome |
| `EmojiPickerSimple` | multi-line trigger chrome |

A naive rename to `<Slot name="trigger"/>` renders **nothing** when the caller
does not fill the slot — every one of these components loses its trigger and
becomes unclickable. This is a silent runtime regression, not a compile error.

### Recommended replacement pattern

D134 says default content is *"the owning component's concern."* The clean way to
honor that without the deferred probe is to make the **prop** the explicit opt-in
for the default chrome:

```html
<!-- before (D134 rejects this) -->
<slot name="trigger">{ label }</slot>

<!-- after -->
{#if label}
  { label }
{:else}
  <Slot name="trigger"/>
{/if}
```

And for the multi-line cases (`DropdownMenu`, both emoji pickers):

```html
{#if label}
  <span>{ label }</span>
  <svg class="size-4 shrink-0 transition-[rotate] {#if open}rotate-180{/if}"
       viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4 6l4 4 4-4z" />
  </svg>
{:else}
  <Slot name="trigger"/>
{/if}
```

Why this works: it keeps the same two-way behavior callers already depend on
(pass `label` for the stock trigger, or fill the slot for a custom one), it needs
no new framework feature, and it makes the either/or contract explicit in the
template instead of implicit in slot-emptiness. The one behavior change is that
passing **both** `label` and a filled `trigger` slot now shows the label rather
than the slot — previously the slot won. That combination is nonsensical and
appears nowhere in the ecosystem, but it belongs in the component READMEs.

### The alternative, if the owner prefers it

Un-defer the is-slot-filled probe and add it to the framework, then these
components keep their current shape. That is a **new public API surface** on top
of a breaking release and needs its own decision card. My read: not worth it —
the prop-opt-in pattern above is simpler, ships today, and D134 already reasoned
its way to deferring the probe. But this is the framework owner's call, and it
should be made before an agent touches the 18 files, because the two paths
produce completely different diffs.

## Part 3 — documentation

`magic-spells-puzzle-site` teaches the old grammar in prose and code samples:

- `app/views/docs/puzzle/Templates.pzl` — lines 183, 232-233, 238, 289-290.
  Line 183 is a full `Card.pzl` sample using `<slot name="header">Untitled</slot>`;
  line 289 is literally `<slot name="…">fallback</slot>`, documenting a feature
  that no longer exists.
- `app/views/docs/puzzle/Components.pzl` — line 252.

These are **string constants holding sample markup**, so they will not fail the
build — they will silently keep teaching a grammar the compiler rejects. They need
rewriting, and the fallback documentation needs replacing with the prop-opt-in
pattern from Part 2.

## Execution plan

Run per-repo; each is independent and safe to parallelize across agents, one repo
per agent. **Do not** let an agent sweep `constellation/decision/` in any repo —
decision-card bodies are history and legitimately contain the old spellings.

1. **`puzzle-pieces` first.** 13 registry components + their 13 demo mirrors.
   Keep the two copies byte-identical for the shared components — the demo exists
   to prove the registry compiles. Then rebuild the demo against the 0.4.0 binary
   and confirm every affected component still renders and its trigger still works.
2. **`magic-spells-puzzle-site`.** Same 6 trigger components, plus the 7 mechanical
   ones, plus the docs rewrite in Part 3.
3. **`puzzle-devtools`, `streakwave`, `puzzle-music-demo`.** Mechanical; batch them.
4. **`tarot-puzzle` doc comments** — prose only, no compile impact, low priority.

For each repo, the acceptance check is a real build with the 0.4.0 binary, not a
grep. The repo-root `./puzzle` binary in this checkout builds examples; point it
at each sibling app.

## Verification

```bash
# per affected repo
<path-to-0.4.0-puzzle> build          # must exit 0
rg '<slot|<children' -g '*.pzl' .     # must return nothing outside decision cards
```

Then, in this repo:

```bash
npx vitest run && (cd compiler && go test ./...)
```

## Constellation obligations

- D134 is `status: built`. After PR #39 merges, re-read it against the merged code
  and `set_verified` at the merged SHA.
- If the is-slot-filled probe is chosen instead of the prop-opt-in pattern, that
  needs a **new decision card** (next free number after D138 is **D139**) and a
  `DOC-DECISIONS.md` entry — do not amend D134's body, which is history.
- `puzzle-pieces` has its own `constellation/` plan. If its component contracts
  change shape, its cards need the same treatment there.
