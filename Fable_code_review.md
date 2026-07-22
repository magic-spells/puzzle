# Fable Code Review — 2026-07-17

> **Status (2026-07-17):** ALL 15 findings fixed + verified. Quick fixes (1, 4, 6, 9, 10, 11, 12,
> 13, 14, 15) and medium fixes (2, 3, 5, 7) landed first (committed as "claude code-review
> updates"). Finding 8 (slot forwarding through components) implemented as **D69** (v1.36,
> written by Fable directly): expandNode now descends into component CALL-SITE children (the
> component's own template stays off-limits), so `<Card><slot/></Card>` in a layout forwards the
> routed page into Card's default slot — runtime + SSG (shared expandSlots). Named markers inside
> a component invocation are a positioned compile error (forwarding semantics deliberately
> unspecified); default-slot uniqueness still counts through invocation boundaries. 10 new vitest
> (incl. router e2e of the original bug + pinned-instance adoption) + 8 new Go parser cases.
> Suite: 719 vitest + all Go packages green. Constellation/SPEC truthing for D69 pending.

Full-codebase review (xhigh, workflow-backed): Go compiler + browser runtime, constellation excluded.
43 agents — 6 finders swept architecture → granular, 34 independent verifiers confirmed every finding
at its exact file:line before it was kept. 39 candidates → 38 verified → top 15 reported below.
All 15 are **CONFIRMED** (several reproduced by executing the actual code).

**Big picture:** the architecture itself held up — no structural findings against the
compiler → esbuild → runtime pipeline. The dominant theme is **fidelity drift between the three
render paths** (browser runtime, SSG prerenderer, SSG serializer): each reimplements pieces of the
same contract and they've diverged. Findings 1–5 are all instances of that theme; the rest are
core runtime/compiler correctness bugs.

Raw verifier evidence: `subagents/workflows/wf_bccbdc12-44a/journal.jsonl` (session dir).

---

## Findings (most severe first)

### SSG / static build (v1.33–34)

#### 1. `client-runtime/ssg/index.js:238` — build-time `this.route` has the wrong D47 shape
SSG builds `{ path, name, params, meta }` but the router contract (`router.js:809`) is
`{ path, route, params, chain }` — the `route` and `chain` keys views actually read are missing,
despite the comment claiming "D47 shape". Four finders independently hit this.

**Failure:** `puzzle build --static` on an app using the documented D47 idiom —
`this.route.chain[0].name` (examples/music AppLayout.pzl:110) or `this.route.route.name`
(examples/chirp) — throws `TypeError` during prerender and fails the whole build; with optional
chaining, silently wrong route-derived state (active nav tab, breadcrumbs) is baked into every page.

#### 2. `client-runtime/ssg/index.js:56` — one shared Store/ctx across all prerendered pages, no teardown
`buildContext` is called once and reused for the whole entries loop; no page's instances are
ever destroyed.

**Failure:** a view/layout seeding fixed-pk records in `created()`/`data()`
(`store.createRecord('setting', { id: 'theme' })`) works in the browser but throws
`[puzzle] duplicate primary key` on the second route at build time; without fixed pks, page A's
records leak into page B's serialized markup.

#### 3. `client-runtime/router/router.js:1284` — SSG takeover paints the skeleton over prerendered content
`#takeoverSSG` wipes the prerendered page, but the D39 skeleton exemption means the initial
route's preload isn't awaited — commit reaches `replaceChildren()` while `data()` is pending and
`#renderNow()` draws `renderSkeleton()` over the just-cleared content.

**Failure:** every static page load of a skeleton view with async `data()` flashes
content → skeleton → content (held ≥ `min-duration` ms under D52), defeating D67's
"takeover with no flash" guarantee — the static build looks strictly worse than the plain SPA.

#### 4. `client-runtime/ssg/serialize.js:153` — nested components get a route they never see in the browser
`serializeComponent` threads the route snapshot into EVERY nested component's `preload()`, but the
browser ViewManager mounts child components without a route (`viewManager.js:264`) — `this.route`
is documented/guaranteed null off-router.

**Failure:** a component probing `if (this.route)` (the documented off-router check) takes the
routed branch only at build time: either it reads deeper into the (also mis-shaped, see #1)
snapshot and fails the build, or it emits markup the browser render never produces — content
flash at takeover, wrong static HTML for crawlers.

#### 5. `client-runtime/ssg/serialize.js:79` — `value` serialized as a plain attribute for select/textarea
`serializeAttrs` emits controlled `value` as an HTML attribute for every element, but `<select>`
has no value attribute and `<textarea>` takes its value from text content. The browser path fixes
exactly this (property assignment + `reassertSelectValue`, `viewManager.js:343`) which serialize.js
claims to "mirror exactly" but doesn't.

**Failure:** prerendered `<select value={filter}>` shows the FIRST option; `<textarea value={draft}>`
renders empty — wrong form state for crawlers/no-JS, visible wrong-selection flash until takeover.

### Core runtime

#### 6. `client-runtime/model.js:237` — prototype pollution via `Object.assign(this, data)`
A `"__proto__"` own key in JSON-derived data (server response via loadAll/loadOne/_upsert, or a
corrupted persisted blob via _hydrateAll) triggers the `Object.prototype.__proto__` SETTER and
re-prototypes the record — all PuzzleModel methods severed. Passes every existing shape guard.
Object spread would be safe; `Object.assign`'s Set semantics is the pitfall.

**Failure:** `{"id": 1, "__proto__": {}}` → next `record.update(...)` throws
`record.update is not a function`.

#### 7. `client-runtime/views/viewManager.js:443` — controlled `value` never re-asserted against live DOM
`patchAttrs` compares `oldAttrs.value !== newAttrs.value` vnode-to-vnode instead of against
`el.value`.

**Failure:** `<input value={draft}>` bound via `@change`/`@keydown:enter` (not per-keystroke
`@input`): user types "abc" (DOM diverges from bound ''), reset action sets bound value back
to '' — '' === '' so setAttr is skipped and the input keeps showing "abc" while state says ''.
Vue/React force-sync the property every patch for exactly this.

#### 8. `client-runtime/views/viewManager.js:171` — slot forwarding through a component breaks
`expandNode` early-returns on component vnodes without descending into call-site children, so a
`<slot/>` marker written inside a component invocation (e.g. layout template `<Card><slot/></Card>`)
is never substituted — the raw SLOT_TAG vnode rides into Card's children and mounts as a literal
inert `<slot>` DOM element.

**Failure:** the routed view never mounts; the only diagnostic is the misleading
`#warnMissingSlots` warning. SSG's serializer even guards this exact case (returns '' for a stray
SLOT_TAG) while the browser path silently emits the bogus element.

#### 9. `compiler/internal/parser/slot.go:78` — duplicate default `<slot/>` markers: no error, shared vnodes
`walkSlots` rejects duplicate NAMED slots but lets two+ bare default `<slot/>` through (only
`node.Name != ""` entries go into `seen`); at runtime `expandNode` splices the SAME slotChildren
vnode objects into every marker (no clones on the default-bucket fast path).

**Failure:** one ViewNode mounted at two DOM positions — second mount overwrites `vnode.el`/
`vnode.component`, orphaning the first copy: patches update only the second, keyed moves/teardown
hit the wrong element, content visibly duplicates then desyncs. No compile error, no warning.

#### 10. `client-runtime/views/PuzzleView.js:153` — `memo()` compares deps with `===`, NaN never matches
`hit.deps.every((d, i) => d === deps[i])` — NaN !== NaN, so a NaN dep permanently misses the cache,
the factory re-runs every render, returns a NEW object, and the child's shallowEqual fails every
time — the exact request-per-render regression D62/D64 shipped to prevent. React's useMemo uses
`Object.is` for precisely this reason.

**Failure:** `this.memo('stats', [avg], ...)` where `avg = total/count` is NaN for an empty list →
child `data()` re-runs (and re-fetches) on every parent render.

### Compiler

#### 11. `compiler/internal/codegen/codegen.go:606` — range `{#for}` bounds spliced without parens
Emits `to - from + 1` by textual substitution; any composite `from` (additive or lower-precedence)
computes the wrong `Array.from` length. Same un-parenthesized splice at line 612
(`from + " + __i"`) yields wrong loop values for `||`/ternary bounds.

**Failure:** `{#for start + 1...end, n}` → `__d.end - __d.start + 1 + 1` → two extra iterations
(pager renders page links past the last page); `{#for start - 2...end}` renders 4 too few.

#### 12. `compiler/internal/plugin/scan.go:101` — formatter manifest never scans `<puzzle-skeleton>`
The scan parses only the template section (`parser.ParseTemplate`), never `parser.ParseSkeleton`,
while codegen emits formatter calls in `renderSkeleton()` too (codegen.go:275). Same gap at
scan.go:127.

**Failure:** a builtin used ONLY in a skeleton (`{ createdAt | date('long') }`) is absent from the
bundled manifest — skeleton shows the raw ISO timestamp and logs `[puzzle] unknown formatter "date"`,
violating the scan's own stated invariant.

### Router

#### 13. `client-runtime/router/router.js:643` — same-path no-op guard misses on trailing slash
`push()` compares byte-identically against `#state.path`, but the D67 trailing-slash amendment
normalizes only inside `#match` (line 1587). On a static-hosted directory URL (`/docs/`),
`#state.path` keeps the slash.

**Failure:** clicking the already-active `<a href="/docs">` nav link pushes a duplicate history
entry, re-runs the whole chain's `data()`, scrolls to top — every click; Back must walk N
duplicate entries.

#### 14. `client-runtime/router/router.js:656` — `#runPendingPush` bypasses the same-path no-op guard
The commit-window-deferred push is re-dispatched via `#navigate` directly, dropping the
`path === this.#state.path` check that `push()` applies.

**Failure:** a `mounted()`/`viewWillShow` hook pushing the very path being committed (auth guard
normalizing to `/login` while landing on `/login`): deferred into `#pendingPush`, then re-run as a
full params-only navigation — every chain level's `data()` re-runs and a duplicate history entry
is pushed; a direct post-commit `push()` would have been a no-op.

### Formatters

#### 15. `client-runtime/formatters/builtins.js:161` — keyless `sort` is lexicographic
No-key branch falls through to bare `Array.prototype.sort()` (string coercion). Verifier executed
the module: `sort([2,10,1])` → `[1,10,2]`.

**Failure:** `{ scores | sort | join(', ') }` renders "1, 10, 2" — silently wrong for any numeric
list (prices, counts, versions). Keyed branch (line 155) has the same issue for mixed
numeric-strings.

---

## Below the cap (confirmed but lower impact — not detailed above)

23 further verified findings didn't make the top 15, including: DST-sensitive date re-parsing in
`builtins.js` (zone-less ISO rebuild parsed in local zone), surrogate-splitting `truncate`
(lone high surrogate → U+FFFD), missing Content-Type handling, non-ASCII identifiers mis-scanned
in template expressions (`expr.go` is byte/ASCII-oriented), a theoretical data race on the shared
`spaces` indent buffer in `codegen.go:1152` (only if codegen ever runs concurrently), null-key
diagnostics, `beforeMount` facade missing `storage` passthrough in SSG's `buildContext`
(ssg/index.js:163 drops `config.storage`), and all pure cleanup/duplication items (e.g. duplicated
hash-base link handling at router.js:1722–1732). Full list with evidence in the workflow journal.

**Refuted (1):** "SSG preloads chain levels sequentially where the router parallelizes" —
structurally true but intentional/harmless at build time.

---

## Suggested fix order

1. **SSG fidelity bundle** (findings 1–5) — fix together before publishing anything about
   `--static`; they're all "the static build doesn't keep D67's promises yet".
2. **Silent-failure runtime bugs** (6, 8, 9) — sneakiest of the rest; fail without diagnostics.
3. **Quick correctness one-liners** (10, 11, 12, 13, 14, 15, 7).
