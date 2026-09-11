---
name: "D44 — DOM islands: the `island` attribute (v1.13)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
notes:
  - kind: gotcha
    text: >-
      The "sanctioned escape hatch for third-party DOM" framing over-prescribes. Islands are for
      libraries that RESTRUCTURE or own children (clone/reparent/rewrap/rewrite: contenteditable,
      Swiper-style loop clones, map/canvas mounts). A library that only DECORATES framework-owned
      nodes (foreign attrs, inline transforms, injected siblings) should NOT be islanded — the
      freeze kills data-reactive children for nothing, and the patcher already tolerates decoration
      (declared-attrs-only diffing, .el-anchored reconciliation). Proven by
      @magic-spells/tarot-puzzle (sibling repo): reactive slot-children slides, no island, tarot's
      MutationObserver consumes the patcher's mutations as its refresh signal. Decision rule +
      shared-subtree conditions: [[DOC-THIRD-PARTY-DOM]].
  - kind: state
    text: >-
      Island-ness joined (tag, key) as node identity in sameNode(): two conditional branches sharing
      tag+key but disagreeing about `island` now REPLACE rather than patch — in both directions. The
      parser already rejected dynamic island={expr}, but cross-branch flips were reachable and
      patched stale carried-forward seed vnodes against DOM the island's owner had rewritten,
      leaving currentTree pointing at detached nodes permanently. SPEC §17's Identity bullet carries
      the contract wording.
  - kind: state
    text: >-
      2026-09-11 (0.8.0, D170) — the freeze saves allocation too, but only for a STATIC seed. An
      island element's children array is a compiler cache site — `(this.__c[n] ??= [ … ])` at view
      level, `(s.c[n] ??= [ … ])` inside a loop row — at ANY size, with no three-vnode threshold,
      because a seed that is rebuilt and thrown away is pure waste however small it is. The seed
      must still be fully static, and THIS CARD is why: `??=` is per view instance (or per row),
      while the Identity & reset rule above re-seeds an island from the template on a key change,
      and a hide/show remount does the same. A cached DYNAMIC seed would hand every later mount the
      FIRST render's values — `<div island key={reset}><b>{seed}</b></div>` would show the old seed
      forever. A static seed is identical on every mount, so caching it is exact. Winning the
      dynamic case back needs the RUNTIME to own the seed's lifetime: emit it as a per-render thunk
      (`() => [ … ]`) the runtime evaluates at mount only, one closure per render instead of N
      vnodes, re-seeding correctly on remount. Deferred, not built. Cost as measured on
      `examples/stress` `islands/shell-renders/20000`, whose seed is a `{#for}` over plain objects:
      island child vnodes per shell render stays at 20,000, with islandViolations 0.
code_refs:
  - client-runtime/views/viewManager.js
---

# D44 — DOM islands: the `island` attribute (v1.13)

A static `island` attribute on a plain element makes its **children browser-/component-owned after mount**: the template seeds them once, the patcher never reconciles them again. The element's own attributes and listeners keep patching normally. The sanctioned escape hatch for `contenteditable` surfaces and third-party DOM (maps, charts, canvas overlays). See [[DOC-SPEC-TEMPLATE]] §17.

## Context

The Grimoire example (a Notion-style block editor) needs per-block always-on `contenteditable` elements. A VDOM that reconciles text children fights the browser for ownership of an editing surface: every store echo risks clobbering caret and composition state, and browser-inserted structure desyncs the vnode tree from reality. The same ownership problem appears whenever third-party code owns a subtree (Mapbox/Leaflet mounts, D3 charts). v1 had only an implicit workaround — leave the element's template children empty and seed via `mounted()` — which breaks silently the moment someone interpolates text inside.

React refuses to manage `contenteditable` children (warning + `suppressContentEditableWarning`); Vue/Svelte likewise ship no editing binding. Notion itself renders many small **uncontrolled** contenteditables and syncs input events to its own model. The framework-shaped gap is not an editor — it's the declarative "this subtree's DOM is owned by someone else" primitive.

## Decision

`island` is a **bare static attribute** on a **plain element** (never a component tag):

```html
<div contenteditable="true" island @input={ syncText(event) }>{ block.text }</div>
```

**Runtime semantics (ViewManager):**

- **Mount is unchanged:** the island's template children mount normally — the template is the *seed* content (interpolations, `{#if}`/`{#for}`/`{#case}`, text — the full grammar).
- **Patch:** the element's **attributes and listeners patch normally** (dynamic `class=`, `@keydown:…` handler swaps, etc.). Its **children are never reconciled**: the patcher **carries the old vnode children forward onto the new vnode** (`newVnode.children = oldVnode.children`) and returns without touching child DOM. Carrying the mounted children (rather than keeping the fresh unpatched ones) keeps teardown and later patches honest — the vnodes that hold live `el` links stay in the tree.
- **Identity & reset:** `sameNode` (tag + key) is unaffected. A keyed island moves with its DOM subtree intact; a tag or key change replaces the node and **re-seeds from the template** — changing the key is the sanctioned "reset this island" lever.
- **Teardown:** unchanged — `unmount` walks the carried children (compile-time checks guarantee no component instances live inside, below).
- **The attribute never reaches the DOM:** `setAttr`/`removeAttr` skip `island` exactly like `key`. It is a framework directive, not markup.

**Compile-time validation (parser/codegen, positioned errors — the D38 fail-fast style):**

1. `island={ expr }` (dynamic value) — error: `island` must be a static attribute. Toggling island-ness mid-life would resume patching against DOM the browser has restructured; there is no sane semantics.
2. `island` on a **component tag** — error: it is not a prop; put it on a plain element inside the component.
3. A **component tag or `<slot/>`/`<Slot/>` anywhere inside an island subtree** — error. A live component instance inside browser-owned DOM can be destroyed out from under the framework (a user Backspace deletes its root), and its props could never update; a slot would splice parent-owned vnodes into an unreconciled subtree.
4. `island` on the `<puzzle-view>` section root — error: the view root is the navigation/animation boundary (D20/D28), not an ownable subtree.

**Documented (not errors):** listeners on *seeded children inside* an island are wired at mount and never swapped — arrow-field handlers stay correct (they close over the instance), but call-expression args are frozen at mount-time values. Listeners on the island element **itself** patch normally. Programmatic text changes to an island (e.g. a block merge) must update **both** the DOM (imperatively) and the store — the framework will not sync store → island DOM after mount; that one-way flow is the entire point.

## Alternatives rejected

- **A controlled contenteditable binding** (`text={…}` two-way, analogous to `value=` on inputs). `value=` works because inputs hold a flat string the browser never restructures; contenteditable holds a DOM tree the browser rewrites during editing (paste, IME composition, spellcheck). Every mainstream framework looked at this and walked away; a "supported" binding would promise what the platform can't keep.
- **Keep the empty-children convention** (seed in `mounted()`, interpolate nothing). Works but is implicit and fragile — interpolating `{ block.text }` inside half-works, then breaks mid-edit with no diagnostic. The directive makes intent declarative, enables the template-as-seed ergonomics, and gives the compiler a place to enforce the component/slot exclusions.
- **A runtime-only flag with no compile checks.** Components inside islands *appear* to work (they self-render via their own ViewManager) until the user's first destructive edit orphans the instance. Fail fast at compile time instead.
- **Emitting the attribute into the DOM** (`data-puzzle-island` for CSS hooks). `key` set the precedent: directives are stripped; style hooks belong to the author's own classes.

## Consequences

- The Grimoire example's editor becomes ~100 lines of app-level caret code on top of a sound primitive, instead of a fight with the patcher.
- Golden fixtures and existing examples are untouched (no island anywhere in them) — the amendment is additive; island-free templates compile and patch byte-identically.
- Skeleton bodies (§16) may contain islands (same grammar) but it's pointless — a skeleton is replaced wholesale by the real render (tag-level replace re-seeds anyway).
