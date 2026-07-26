---
name: SPEC — template grammar, events, and composition
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
verified_at: '2026-07-25T05:53:18.357Z'
verified_sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
notes:
  - kind: verified
    text: >-
      Sections moved byte-for-byte from DOC-SPEC (scripted split, verified by SHA-identical section
      census); §N numbers unchanged
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
---

The frozen v1 contract for templates: the `@event` handler convention and its modifiers, the template grammar, DOM islands, inline SVG, composition markers and named slots, list keying, cached handlers, and compiler accessibility warnings. See [[DOC-SPEC]] for the section index and the rest of the contract.

## 5. Event handler convention

Three forms in templates, one rule each:

1. **Bare identifier** — `@click={ clearCompleted }` → the handler is invoked as `clearCompleted(event)`.
2. **Call expression** — `@click={ setFilter('all') }` or `@submit={ addTodo(event) }` → the compiler wraps the expression as `(event) => setFilter('all')`, evaluated **at event time** with `event` in scope. The handler receives exactly the arguments written in the template.
3. **Null-toggle ternary** — `@pointerdown:outside={ menuOpen ? closeMenu : null }` → each branch must itself be form 1, form 2, or `null`; the condition is evaluated against render data and a `null` branch detaches the listener while the element stays mounted (§47, D86). The grammar is deliberately narrow: `@click={ a + b }`, `@click={ (e) => close(e) }`, `@click={ this.close }`, and `@click={ handlers.close }` all remain positioned compile errors. A bare `@click={ null }` is legal and emits no handler.

`event` names the DOM event only when it is not otherwise bound. A `{#for}` item or counter named `event` shadows nothing — the loop variable wins, and the compiler emits the DOM event under an internal name instead.

```html
<form @submit={ addTodo(event) }>
<input @input={ updateNewTodoText(event) } />
<input type="checkbox" @change={ toggleTodo(todo) } />
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
```

```js
events = {
  addTodo: (event) => { event.preventDefault(); /* … */ },
  updateNewTodoText: (event) => { this.setData('newTodoText', event.target.value); },
  toggleTodo: (todo) => { todo.toggle(); },
  setFilter: (filter) => { this.setData('currentFilter', filter); },
  clearCompleted: () => { /* … */ },
};
```

The curried pattern from older examples (`toggleTodo: (todo) => () => { ... }`) is removed.

### Event modifiers (v1.7, D38)

A binding may carry `:modifier` suffixes — `@event:modifier[:modifier…]={ handler }` — that adjust dispatch declaratively. The handler value stays a plain function; the modifiers are encoded in the vnode key (`@keydown:enter:prevent`), so modifier-free bindings are unchanged.

| Modifier | Effect | Applies to |
| -------- | ------ | ---------- |
| `prevent` | `event.preventDefault()` | any event |
| `stop` | `event.stopPropagation()` | any event |
| `once` | handler fires **once ever** for this binding (the spent-marker survives per-patch handler swaps; it clears only when the binding is actually removed, so a later re-add starts fresh) | any event |
| `outside` | the listener attaches to **`document` (capture phase)** and the handler runs only when the event target is **outside** the bound element — declarative outside-dismiss for popovers/dropdowns; framework-owned cleanup on unmount (v1.52, D86 — full contract §47) | any event |
| `enter` `escape` `tab` `space` `up` `down` `left` `right` `backspace` `delete` | key filter — handler runs only when `event.key` matches (`Enter`/`Escape`/`Tab`/`' '`/`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Backspace`/`Delete`; `backspace`/`delete` added in v1.13, D45) | `keydown`/`keyup`/`keypress` only |

Modifiers stack, and **execution order is canonical regardless of written order**: outside-gate (v1.52) → key-gate → once-spend → `preventDefault` → `stopPropagation` → handler. The gates run first, so an inside event (for `outside`) or a non-matching key bails before `preventDefault` (native behavior preserved) and without spending `once`.

**Compile errors (not warnings):** unknown modifier, a key filter on a non-keyboard event, a duplicate modifier, more than one key filter, or any modifier on a **component callback prop** (component-tag `@name={...}`, D16).

```html
<input @keydown:enter={ addTodo(event) } @keydown:escape:prevent={ cancelEdit } />
<a @click:prevent:stop={ navigate('/home') }>Home</a>
<button @click:once={ claimReward }>Claim</button>
```

## 6. Template grammar (v1)

Supported:

- **Interpolation:** `{ expression }` with plain JS expressions. **Nullish display (D127):** `null` and `undefined` render as an empty string, never the literal words — `{ user.middleName }` on a null field renders nothing. `0`, `false`, `''`, `NaN`, and objects coerce exactly as `String` would (`??` semantics, not `||`, so a zero count and a false flag still render). This holds identically in a bare interpolation, a concatenated text run, a quoted attribute (`title="{ x }"`), and a brace-only attribute (`data-x={ x }`) — before D127 the first three rendered `"null"` while the last rendered empty. A **`undefined`** value additionally logs one development warning naming the expression, since it nearly always means a mistyped or renamed field; the warning and the name are both absent from production builds.
- **Expression boundary (contract):** template expressions are **lexed, not parsed** — the compiler tokenizes them (string/template/regex/comment-aware) and prefixes data identifiers, but has no expression grammar (§4: the Go compiler never parses JS). Consequences, by design and not bugs: (a) the only names in scope are `data()` fields, loop variables/counters, `event` (in handlers), and JS globals — an identifier imported or declared in `<script>` is **not** reachable (it compiles to a data read of the same name and evaluates `undefined`; since the pre-0.1.0 hardening pass the compiler emits a positioned **warning** when a template expression reads a name that `<script>` imports); (b) binding-introducing forms are unsupported in expressions — arrow functions, object literals at expression head (positioned compile error), and destructuring — because a lexer cannot see binding positions. The supported idiom is unchanged: compute in `data()`, render the result.
- **Formatters:** `{ value | formatter(args) }`, chainable (`{ text | trim | capitalize }`). Display-only; filtering/sorting belongs in `data()`. **Unknown-formatter guard (v1.12, D43):** a formatter name not in the runtime registry does **not** crash the render — the compiled call is guarded (`(__f["name"] || __f.__missing("name"))(…)` — bracket access, since registry keys are arbitrary strings), the value passes through unchanged, and one `console.error` per unknown name identifies it (with a did-you-mean suggestion when a close match exists). A compile-time check is impossible by design: custom formatters are registered at runtime (§2), and the compiler never parses JS (§4). **Built-in `link` (v1.46, D79):** `{ path | link }` converts a path-shaped route into the mode-appropriate href via `router.url()` (§9) — `href="{ '/collections/' + c.id | link }"` renders `/collections/1` in history mode (base-prefixed under a `routerBase`), `#/collections/1` in hash mode, and unchanged in memory mode. Registered by `PuzzleApp` at mount (after the router exists), **only if absent** — a user `link` in `config.formatters` wins. Fail-soft per formatter convention: nullish → `''`, non-strings coerced; strings not starting with `/` pass through untouched (external URLs, `mailto:`, bare `#anchor`). Not part of the D31 tree-shake manifest (it needs the live router; the scanner ignores the name like any custom formatter). **Calendar dates (D114):** a bare `YYYY-MM-DD` string is a calendar date — the date family (`date`/`time`/`datetime`/`timeago`/`in_timezone`) parses it as *local* midnight, so it displays as written in every timezone (the ES spec's UTC-midnight parse showed the previous day west of UTC); invalid components keep the fail-soft raw-value path, the `iso` preset returns the string unchanged (the ISO form of a calendar date is itself), and inputs carrying a time or zone are untouched.
- **Conditionals:** `{#if expr} … {:else} … {/if}`.
- **Conditional chaining (v1.9, D40):** `{#if a} … {:else if b} … {:else} … {/if}` — zero or more `{:else if expr}` clauses between the `{#if}` body and the optional trailing `{:else}`, which must be the **last** clause. `expr` is any JS expression, exactly like `{#if}`. Desugars at parse time to nested `{#if}` nodes (additive; codegen unchanged). Spelled `else if` (JS), not `elsif` — `{:elsif}`/`{:elseif}` get a did-you-mean compile error. Compile errors: an empty condition, `{:else if}` after `{:else}`, `{:else if}` outside `{#if}`, inside `{#unless}` or `{#case}` (see D36/D37), and inside attribute-value inline-ifs (the attribute mini-grammar stays flat `{#if}…{:else}` only).
- **Inverted conditional (v1.7, D36):** `{#unless expr} … {/unless}` renders the body when `expr` is **falsy**; an optional `{:else}` renders when `expr` is truthy. `expr` is any JS boolean expression, exactly like `{#if}`. Desugars at parse time to a negated `{#if}` (additive; codegen unchanged). `{:else if}` inside `{#unless}` is a positioned compile error suggesting an `{#if}` restructuring.
- **Multi-branch (v1.7, D37):** `{#case expr}` + one or more `{:when v1, v2, …}` clauses (top-level commas are **OR**) + optional trailing `{:else}` + `{/case}`. Matching is strict `===`, **first match wins, no fallthrough**; the case expression is evaluated exactly once. Compile errors: missing case expression, zero `{:when}` clauses, non-whitespace content before the first `{:when}`, a valueless `{:when}`, a `{:when}` after `{:else}`, `{:else if}` inside a case, a `{:when}` outside any case, and unclosed/mismatched closers. Named `{#case}` (not `{#switch}`) after Puzzle's Liquid heritage — no `break`/fallthrough semantics.
- **Loops:** `{#for item in items} … {/for}` and range form `{#for 1...n} … {/for}`. A trailing `, name` on either header binds the **loop counter** — `{#for item in items, i}` (0-based index) / `{#for 1...n, x}` (the current number) — in scope throughout the block like the item variable (v1.2, D29; additive, keying unchanged). Rows are keyed automatically — pk-aware since v1.26, with an explicit `key={ … }` override on the body root; see §28 (D58).
- **Attribute values:** interpolation and inline `{#if}` blocks inside attribute values, e.g. `class="base {#if done}line-through{/if}"`.
- **Bindings:** `value={ var }` (two-way on inputs), `checked={ expr }`, `disabled={ expr }`, and other dynamic attributes.
- **Events:** `@event={ … }` per section 5.
- **Components:** capitalized tags with props — `<UserProfile userId={selectedUserId} />` — imported in `<script>`.
- **Component children (default slot):** children written at a component's call site render at the child's `<children/>` marker (D16; spelled `<slot />` until v1.41 — D74, §24) — `<Card><p>body</p></Card>`. Guidance: **props for data, slots for markup** — pass `label="Save"` when it's a string, pass children when the caller supplies actual content.
- **Callback props:** `@name={ handler }` on a **component tag** passes the wrapped handler to the child as the prop `name`; the child receives it via `data(params, props)` and calls it like any function. DOM listeners belong to the child's own template — the event lands on the child's element first, the child's handler gates/shapes it, then invokes the parent's callback, which executes in the parent (D16).
- **Layout slot:** `<Slot/>` inside layout components renders the routed view.
- **DOM islands (v1.13, D44):** a bare static `island` attribute on a plain element makes its children browser-owned after mount — the template children render once as *seed content* and are never reconciled again, while the element's own attributes and listeners keep patching normally. See §17.
- **Element refs (v1.39, D72):** a static `ref="name"` on a plain element binds the live DOM node to `this.refs.name` — populated before `mounted()`, re-pointed on replacement, nulled on removal; the attribute never reaches the DOM. Static-string only (`ref={ expr }` is a positioned compile error — the expression boundary makes a braces form unimplementable); see §38 for the full contract and error set.
- **Comments (v1.37, D70):** `{## any text }` (inline, self-contained) and `{#comment} … {/comment}` (block; body discarded **raw** — interpolations, block tags, and malformed template code inside are ignored, so it can comment out broken markup; nested `{#comment}` blocks count). Both are erased at the lexer — no token, no vnode, nothing in the bundle — and are legal at any text position, including `<puzzle-skeleton>` bodies. Inline comments track `{`/`}` nesting depth with `\{`/`\}` escapes and are deliberately NOT string-aware (`{## don't }` is fine); a lone `}` needs `\}`. The block closer tolerates whitespace (`{/ comment }`); opener content after the keyword is ignored. HTML comments `<!-- -->` remain compile-time-stripped as always. Compile errors (positioned): unclosed `{##`, unterminated `{#comment}`, either spelling inside an attribute value, a stray `{/comment}`. Additive; comment-free templates compile byte-identically.

Deferred: `$emit`/event bus. (Named slots shipped in v1.21 — D53, §24; `<puzzle-skeleton>` auto-swapping shipped in v1.8 — D39, §16.)

## 17. DOM islands (v1.13)

The declarative "this subtree's DOM is owned by someone else" primitive. Shipped in v1.13 (D44); an additive template-grammar + runtime amendment. The motivating cases are always-on `contenteditable` surfaces (the Grimoire example's Notion-style block editor) and third-party DOM mounts (maps, charts, canvas wrappers) — anywhere the virtual DOM must stop asserting ownership below a boundary element.

```html
<div contenteditable="true" island
     @input={ syncText(event) }
     @keydown:enter:prevent={ splitBlock(event) }>{ block.text }</div>
```

**Semantics.**

- **Mount:** the island's template children render normally — they are the **seed content**, and the full template grammar (§6) is available in them.
- **Patch:** the element's own **attributes and listeners patch normally** (dynamic `class=`, `@event` handler swaps). Its **children are never reconciled** — the patcher carries the previously mounted child vnodes forward and leaves the child DOM untouched, no matter what the browser (or third-party code) has done to it.
- **Identity:** keyed islands move with their DOM subtree intact. A **tag or key change replaces the node and re-seeds from the template** — changing the key is the sanctioned "reset this island" lever.
- **The attribute never reaches the DOM** — `island` is a framework directive, stripped like `key`. Style hooks belong to the author's own classes.

**Compile errors (not warnings):** a dynamic value (`island={ expr }` — island-ness cannot toggle mid-life); `island` on a component tag (it is not a prop); a component tag or any composition marker (`<children/>`/`<slot name>`/`<Slot/>`) anywhere inside an island subtree (a live instance inside browser-owned DOM can be destroyed out from under the framework); `island` on the `<puzzle-view>` root (the view root is the navigation/animation boundary, D20/D28).

**One-way flow, stated plainly:** after mount, data flows **out of** an island (input events → store), never into it. Listeners on seeded children *inside* the island are wired at mount and never swapped (arrow-field handlers stay correct; call-expression arguments are frozen at mount-time values). Programmatic content changes — a block merge, a "clear" action — must update **both** the island's DOM (imperatively) and the store; the framework deliberately will not re-sync store → island. When store-driven re-rendering of the content is what you want, you don't want an island.

**What v1.13 deliberately does not add:** a controlled `contenteditable` binding (two-way `text=`). `value=` on inputs works because an input holds a flat string the browser never restructures; a contenteditable holds a DOM tree the browser rewrites during editing (paste, IME composition, spellcheck). No mainstream framework ships this binding; the island is the honest version of the feature.

## 18. Inline SVG assets: `{#svg}` (v1.14)

The Shopify-snippet ergonomic for icons: one SVG file on disk, referenced by name from any template, inlined at **compile time**. Shipped in v1.14 (D46); a parser + codegen + (small) runtime amendment. The motivating case is the global icon set — cart, account, open/close — simple shapes carrying `currentColor`, recolored by hover states on the parent `<button>`.

```html
<button class="group text-gray-500 hover:text-red-500" @click={ toggleCart }>
  <span class="inline-block size-5">{#svg 'icons/cart.svg'}</span>
</button>
```

**Grammar.** `{#svg '<path>'}` is the framework's first **void block tag** — self-contained, no `{/svg}` (a stray `{/svg}` is a dedicated compile error: *`{#svg}` is self-contained — remove the `{/svg}`*). The header is exactly one single- or double-quoted **static string literal**; a non-literal path is a compile error (inlining happens at compile time, the D44 static-only precedent), and anything after the path is a compile error — per-use attributes were deliberately rejected (see below). Legal anywhere an element is: inside `{#if}`/`{#for}`/`{#case}` bodies, inside islands, and inside `<puzzle-skeleton>` (§16).

**Resolution.** Paths resolve from the conventional **`app/assets/`** folder only — `'icons/cart.svg'` means `app/assets/icons/cart.svg`. Absolute, `./`, `../`, and directory-escaping paths are compile errors (portable src strings; relative-to-`.pzl` resolution can be added later without breaking anything). `app/assets/` is **compile-time only** — never copied to `dist/` (contrast `app/public/`, which is copied verbatim and never inlined). Missing file, missing `app/assets/` dir, or a malformed file are positioned compile errors (in the `.pzl` for path problems; in the `.svg` for file problems). Under `puzzle dev`, inlined files are registered as esbuild watch files: editing only the `.svg` rebuilds, and creating a previously-missing file recovers the build.

**Inlining semantics — the file is inert.** The compiler strips an optional XML prolog/DOCTYPE, requires a single `<svg …>` root (nested `<svg>` inside is fine — depth-counted), tokenizes **only the root open tag** to lift its attributes onto a vnode, and embeds everything inside as a **verbatim string**. File contents are never template-parsed: `{ expr }`, `{#blocks}`, components, and event handlers inside the file do nothing (literal `{` is fine — it's just text). At runtime the root `<svg>` is a real vnode (the differ places/removes it; created via the SVG-namespace path) whose string children are seeded once via `innerHTML` and then **island-owned (D44)**: never reconciled, zero diff cost per patch regardless of file size. The escape hatch is explicit: want a reactive or animated SVG? Paste the markup into the template directly — arbitrary SVG in templates has always compiled (no element whitelist, automatic `createElementNS` namespace propagation).

**Styling contract.** No per-use attributes on the tag — `{#svg 'path' class="…"}` was rejected as an incoherent mix of Liquid-tag and HTML-attribute syntax (Shopify's own `{% render %}` takes none). Style the icon the Shopify way: `currentColor` (and `width="100%" height="100%"` or a `viewBox`) in the file; color/hover classes on the parent; sizing via a wrapper `<span class="size-5">`, a `[&_svg]:size-5` child selector, or in-file dimensions. Liquid-style params (`{#svg 'path', class: '…'}`) remain a reserved, backwards-compatible future extension.

**Cost model, stated plainly:** each `{#svg}` use embeds its own copy of the string in the bundle — identical to hand-pasting, right for small icons. A huge SVG used many times belongs in `app/public/` as an `<img src>` instead.

**Tooling.** `pzlc` grew `--assets <dir>` (default: the nearest ancestor `app` directory's `assets/`). `puzzle init` scaffolds `app/assets/icons/heart.svg` and uses it in the default template's `Home.pzl`. Related but distinct: `import data from './x.json'` in `<script>` has always worked (esbuild's built-in JSON loader) — see DOC-PUZZLE-FILE.

## 24. Composition markers: `<children/>` + named slots (v1.21, amended v1.41)

Multi-region composition. Named slots shipped in v1.21 (D53); v1.41 (D74) retired the bare lowercase `<slot/>` and gave each spelling exactly one role: **`<children/>` is the default marker** (call-site children), **`<slot name>` is only ever a named slot** (`name` is now required), and **`<Slot/>` remains the router outlet** (D30). All three compile to the same marker vnode — the runtime kernel, ViewManager expansion, SSG serializer, and router are untouched, and templates already spelled `<Slot/>`/`<slot name>` compile **byte-identically**.

```html
<!-- Card.pzl -->
<puzzle-view class="card">
  <header><slot name="header">Untitled</slot></header>
  <div class="body"><children/></div>
  <footer><slot name="footer"/></footer>
</puzzle-view>

<!-- call site -->
<Card>
  <h2 slot="header">{ post.title }</h2>
  <p>{ post.excerpt }</p>            <!-- no slot attr → default content → <children/> -->
  <Button slot="footer" @click={ open }>Read</Button>
</Card>
```

- **`<children/>` — the default marker.** Renders the invocation's untagged direct children (or, in a routed view/layout, whatever fills the default bucket). Takes **no attributes** (any attribute is a positioned compile error; `ref` gets the render-target message, D72). MAY carry fallback children — `<children><p>Nothing here</p></children>` renders the fallback when the call site supplies nothing (v1.41 un-freezes D53's deferred default-fallback with the exact semantics named slots always had). One default marker per body, counting `<Slot/>` too.
- **`<Slot/>` — the router outlet.** The same marker, capitalized: the canonical spelling in routed shells/layouts (D30 fills it). Bare only — a `name` attribute is a compile error steering to lowercase `<slot name>`, and children remain rejected (no fallback; an index child route is the sanctioned empty-state). The compiler cannot tell a view from a component (same `.pzl` format), so `<Slot/>`-in-views vs `<children/>`-in-components is a documented convention over one mechanism, not an enforced split.
- **`<slot name="x">…fallback…</slot>` — named slots only.** `name` is **required**, static, non-empty, unique per template body; `name="default"` and `name="children"` are reserved (compile errors — the latter steers to `<children/>`). A nameless `<slot>`/`<slot/>` is a positioned compile error naming both replacements. Fallback uses the full template grammar and renders when the call site fills nothing for that name.
- **Call-site side (unchanged, D53):** a **static** `slot="x"` attribute on a **direct child** (element or component tag) of a component invocation routes it to that region; the attribute is stripped from the rendered output. Direct children without one form the default content.
- **Compile errors (unchanged, D53):** dynamic `slot={expr}` on a direct component child; a control-flow block at direct-child level containing top-level `slot`-attributed elements (put the condition inside the slotted element instead). Elsewhere, `slot` is the ordinary HTML global attribute and passes through.
- **Views/layouts (unchanged):** one marker type, one expansion pass — but the router only ever fills the DEFAULT bucket; a named slot in a routed view's template just renders its fallback.
- **Forwarding through a component (v1.38, D71 — respelled by v1.41):** a default marker placed INSIDE a component invocation forwards the enclosing template's default content through that component — `<Card><children/></Card>` in a layout hands the routed page to Card's default slot (`<Slot/>` works identically in that position — same node). The expansion walk substitutes the enclosing template's markers in call-site children before the inner component expands its own; a routed vnode's pinned instance rides along and mounts as usual. Only the default marker forwards: `<slot name="x">` inside a component invocation is a positioned compile error (no defined fill source — the router fills the default slot only), enforced through nested elements, control flow, and deeper invocations.
- Scoped slots (child data flowing back into parent-provided content) remain deferred.

## 28. List keying (v1.26)

How `{#for}` rows get their reconciliation keys. Shipped in v1.26 (D58); codegen + one ViewNode static, byte-identical emission for range-form loops and for `key` attributes outside loop roots.

- **Auto-key is primary-key-aware.** An item-form `{#for item in items}` body root gets a synthetic `key: ViewNode.keyOf(item)` (previously the hardcoded `item.id`). `ViewNode.keyOf` resolves at render time: a store record (a `PuzzleModel` instance) keys by its model's `primaryKey()` field — so `Puzzle.string().primary()` on `main_id` keys lists by `main_id` with no template change — and any other value keys by `.id` exactly as before. `keyOf` is internal surface (like `SLOT_TAG`): compiled output calls it; app code shouldn't.
- **Explicit key overrides.** A `key={ … }` attribute written on the `{#for}` body root (element or component, item or range form) **replaces** the synthetic key — the compiler skips its prepend; the author's expression is used verbatim (`keyOf` is not applied). This is the sanctioned escape hatch for non-record data with a different identity field. Keys must be stable and unique across the collection. (Previously an explicit key silently emitted a **duplicate** `key:` property alongside the synthetic one — that hazard is gone.)
- **Null keys warn.** When `keyOf` resolves `null`/`undefined` (no `.id`, unmodeled data), it warns once — naming the offending item shape — and returns null, so the list degrades to positional diffing **diagnosed** instead of silently. The existing duplicate-key warning (§ v1.23 review pass) is unchanged and covers the colliding-values case. Production builds already strip `console.*`; the warning is dev-only in effect.
- **Range form unchanged:** range/counter loops key by the generated number (unique by construction) with byte-identical emission to v1.25.

## 31. Cached event handlers (v1.29)

Every `@event` site whose handler is **data-independent** — the bare form `@click={ h }`, or the call form when its arguments reference nothing from the render scope beyond `event` (literals, `event`, `this.…`, and JS globals are all fine: they're evaluated at fire time *inside* the closure) — compiles to a per-instance cached closure (D62):

```js
'@click': ((this.__h ??= {})[3] ??= (event) => this.events.h(event))
```

instead of a fresh arrow per render. Handler *semantics* are unchanged (`this.events` lookup still happens at fire time); what changes is **identity** — the same function object is passed on every render of the instance. Consequences:

- **Component callback props now shallow-compare equal across parent re-renders.** A child whose props are all static, cached, or memoized (§32) no longer re-runs `data()` on every parent render — this restores §4's prop-reactivity rule (`data()` re-runs when props *change*), which fresh-closure callback props had made fire on phantom changes since v1.
- **DOM listeners at cached sites stop rebinding per patch** (`patchAttrs` sees an unchanged value). The `:once` spent flag is unaffected — it lives on the element, not the handler function.
- **Call forms that capture render data or loop variables** (`save(draft)`, `remove(card.id)`) still emit fresh closures, byte-identical to v1.28 — their captures genuinely change, and a component receiving such a prop still re-runs `data()` per parent render (correct: the prop really is new).

Site numbering is per-file and deterministic (`render()` and `renderSkeleton()` share the counter), so recompiling an unchanged file stays byte-stable. `this.__h` joins the emitted `__d`/`__f` as a reserved name on component instances.

## 43. Compiler accessibility warnings (v1.48)

The compiler emits **positioned, non-fatal warnings** (never errors) for five template accessibility mistakes, on the same out-of-band diagnostics channel as the script-import collision warning — generated JavaScript is byte-identical whether or not a template warns (D82).

- Rules: `<img>` without `alt`; `<input type="image">` without `alt` (only when `type` is statically `image`); `<iframe>` without `title`; `<a>` without `href`; a statically positive `tabindex`.
- `alt=""` is valid (decorative images) and never warns. An attribute counts as **present** when any static, valueless, dynamic (`alt={expr}`), or mixed attribute carries the name — the rules never guess about runtime values, and a dynamic `type`/`tabindex` never warns.
- Both the template and `<puzzle-skeleton>` are scanned, descending into `{#if}`/`{#for}`/`{#case}` bodies, component call-site children, and slot fallbacks.
- No suppression syntax, no warning IDs, no ARIA role matrix, no click/keyboard heuristics — five reliable rules over a rules engine. Additions are SPEC amendments.

## 47. The `outside` event modifier: `@event:outside` (v1.52)

`@click:outside={ close }` — a generic event modifier (§5 table, D86) for declarative outside-dismiss. Works on any event: `@pointerdown:outside` dismisses on press, `@focusin:outside` detects focus leaving a widget.

- **Placement semantics:** the listener attaches to **`document` in the capture phase**; the handler runs only when `el.contains(event.target)` is false for the element carrying the binding. Capture is load-bearing: an unrelated component's `stopPropagation()` cannot swallow the outside event, and the interaction that opens a panel cannot dismiss it in the same dispatch (a panel mounted synchronously mid-event attaches after document's capture phase has passed).
- **Gate order:** the outside-gate runs before every other modifier step (§5's canonical order) — an inside event spends no `once`, triggers no `preventDefault`.
- **Lifecycle:** the framework owns the document listener. It attaches when the bound element mounts and detaches on every removal shape (conditional toggle, keyed-row removal, subtree teardown, full view destroy) and on the inline-null toggle (`@pointerdown:outside={ open ? close : null }`). The idiomatic form puts the binding on the panel root inside `{#if open}`, so the listener's lifetime tracks the panel; the always-mounted alternative is the root-element binding with the null-toggle.
- `@click` and `@click:outside` on one element are independent bindings. Existing §5 compile errors are unchanged (`outside` on a component callback prop is rejected like every modifier).
- **Documented limitations:** events inside an `<iframe>` never reach the parent document; on touch, `pointerdown` fires at scroll-start — prefer `@click:outside` where scroll tolerance matters. The event choice is the author's.

