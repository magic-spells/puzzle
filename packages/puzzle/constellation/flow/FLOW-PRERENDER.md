---
name: Prerender flow
status: verified
triggers:
  - kind: manual
connections:
  - COMPONENT-SSG
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - FILE-SSG-RUNTIME
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-SERIALIZER
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-HEAD-TAGS
  - DECISION-D01-SPA-ONLY
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D117-STATIC-OUTPUT-HISTORY-HREFS
  - DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP
  - DECISION-D130-TAKEOVER-BUILD-DEFINE
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
  - DECISION-D142-HYBRID-ROUTE-SNAPSHOT
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D161-AUTO-FETCHING-FINDS
  - FLOW-BUILD
  - DOC-SPEC-BUILD
  - FEATURE-V1-33-SSG
  - FEATURE-V1-47-STATIC-PAGES
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Prerender flow

Puzzle has two prerender output modes on top of the plain SPA build
([[FLOW-BUILD]]):

- **`output: 'hybrid'`** emits content-complete HTML per route. The ordinary SPA
  bundle loads on every page and takes over the prerendered container at
  navigation zero; everything after that is a normal Puzzle app
  ([[DECISION-D67-SSG-STATIC-BUILD]]).
- **`output: 'static'`** emits true static pages — no router, no `app.js` — each
  carrying a small per-page module that mounts only its own components over the
  prerendered markup ([[DECISION-D81-STATIC-PAGES-MODE]]).

Neither is SSR and neither is hydration. There is no server, and no protocol for
reconciling a client tree against prerendered nodes: the runtime clears the
prerendered children and mounts a freshly rendered tree in one synchronous swap.
What is adopted is the *screen*, not the nodes — the enter animation is
suppressed and the chain is preloaded first, so the replacement is visually
identical. [[DECISION-D01-SPA-ONLY]] holds for the runtime in both modes.

1. **The output mode resolves before anything is bundled.** A `--static` /
   `--hybrid` flag that disagrees with `output` in the config is a hard error
   naming both; otherwise the non-empty side wins. A plain SPA build warns once
   per conventionally named route module (`app/**/routes.js|.ts`) in which it
   finds a literal `meta.description` / `canonical` / `socialImage` key, because
   those fields can only ever become tags at prerender time.
2. **Prerendering runs after the shell and public assets are in staging, and
   before the swap.** The shell is the injection template, so it must already be
   there; the swap must come after, so a prerender failure discards staging and
   leaves the last good `dist/` untouched. Reordering this breaks whole-build
   atomicity.
3. **Go generates a Node entry, bundles it, and runs it — Go never renders.**
   The entry imports the app's default export plus the prerender orchestrator,
   bundles for the Node platform into a scratch dir, and runs under `node`. The
   summary comes back on stdout after a sentinel, and only text after the *last*
   sentinel is read, so user logging inside models or `data()` is harmless. A
   missing `node`, a non-zero exit, a timeout, or a missing sentinel each fail
   the build with the subprocess's stderr surfaced.
4. **The prerender constructs exactly one unstarted memory Router and
   enumerates one entry per leaf.** One Router per build, not per page: route
   validation and matcher compilation happen once, and — the structural point —
   the prerenderer compiles no matchers of its own, so it cannot disagree with
   the live router about path shape ([[DECISION-D126-PATH-SHAPE-AND-OUTPUT-OWNERSHIP]]).
   Each entry carries its root-to-leaf chain and the top-level route's layout.
5. **Each eligible route assembles its chain with no DOM.** Views are
   instantiated and preloaded root-to-leaf — `created()` plus an awaited
   `data()`, never `mounted()`, never animations — then nested into keyed
   component nodes leaf-up with each instance pinned, mirroring what the router
   does on a real navigation. The layout preloads last and wraps the chain
   through its slot. This assembly module is shared verbatim with the browser
   static kernel, which is what stops a prerendered page and its client render
   from silently diverging.
6. **The node tree is serialized to HTML.** The serializer mirrors ViewManager
   semantics: components render inline with no wrapper element, slots expand
   through the shared expander, controlled form state becomes real HTML
   attributes, and framework directives (`key`, `island`, `ref`, `flip`,
   `@event`) are dropped. Placeholder and Portal nodes serialize to nothing.
   `<script>` and `<style>` are RAWTEXT, emitted byte-raw behind a breakout
   guard ([[DECISION-D113-SSG-RAWTEXT-RULE]]).
7. **The page is spliced into the shell against a plan compiled once per
   build.** The plan records byte offsets for the head region, the `<title>`
   span, every managed-tag span, the empty target element and `</body>`; a page
   is one ordered splice over those offsets rather than a rescan of the finished
   document ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]).
8. **The two modes diverge at emission.**
   - *Hybrid* writes one directory-style `index.html` per static route (`/` →
     `index.html`, the bare catch-all → `404.html`), with the target element
     rebuilt as a marked container around the markup. A `prerender: false` route
     gets the untouched shell — a genuine SPA island, no head injection.
   - *Static* strips the shell's `app.js` script tag, marks the target with the
     static marker, and appends before `</body>`, as one splice at the shell's
     recorded offset: an inline JSON data island, a read-state envelope island
     when the prerender settled anything through the adapter (adapter-less or
     settled-nothing pages omit it — [[DECISION-D161-AUTO-FETCHING-FINDS]]),
     and a `<script type="module">` pointing at that page's generated entry.
     Slugs are assigned by walking the page list in order.
9. **Go post-checks the written output.** A route page may not overwrite a
   `public/` asset — case-folded, since the common collision is a hand-authored
   `public/404.html` against a catch-all route, and the only sanctioned overlap
   is `/` writing the shell back over itself. The prerender scratch directory is
   likewise a reserved name, then removed so it never ships.
10. **Static only: a second, browser-platform esbuild pass bundles the per-page
    entries** with splitting on, so shared components and the router-free view
    runtime factor into cached chunks. The app bundle and its map are deleted —
    `dist/` genuinely contains no `app.js`.
11. **Staging swaps atomically over `dist/`.**

## Hybrid at load: takeover, not hydration

The bundle is the ordinary SPA bundle, structurally unchanged. On load it wires
the context, runs `beforeMount`, and starts the router, which navigates against
the real URL. Three things then key off the container's marker *and* the
build-time takeover define ([[DECISION-D130-TAKEOVER-BUILD-DEFINE]]):

- The skeleton exemption is disabled, so the initial chain's preload is awaited.
  Otherwise a skeleton would be drawn over real prerendered content — a
  content-to-skeleton-to-content flash on every page load.
- Non-routed nested components are preloaded ahead of the swap, so they mount as
  already-loaded instances rather than through the fire-and-forget path, each
  with its enter animation suppressed. A newer navigation arriving mid-preload
  destroys all of them.
- Immediately before the mount, the prerendered child nodes and the marker are
  snapshotted, the container is cleared, and a restore callback is returned.

If the mount rejects, the app error view is offered the position first
([[DECISION-D145-ERROR-BOUNDARIES]]); only when no error view draws does the
restore callback put the exact prerendered nodes *and the marker* back
([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]). Restoring the marker is what lets
a later mount into that container take over again. The container is empty only
between the synchronous clear and the rejection microtask, never across a paint.

The define is probed inline at each branch with the absent-means-on idiom, so
test runners and third-party bundlers keep the path. Hoisting the probe into a
module-level constant breaks the fold silently.

## Static at load: `mountStatic`

The generated entry imports the kernel, this page's view and layout classes by
their compiled module stamps, and — only when those files exist — the models
registry, the formatters module and an adapter binding. Then, in order:

1. Resolve the target element; a missing one throws.
2. Zip the view classes back onto the serialized route snapshot to rebuild the
   chain, and build the frozen snapshot from it.
3. Build the context: a store over the models, the *throwing* router stub, and a
   formatter registry. `beforeMount` is deliberately not called — it ran at build
   time and its result rode in on the data island.
4. Rehydrate the data island into the store in replace mode, then hand the
   read-state envelope to `hydrateReadState` — records first is load-bearing,
   so an absence whose record actually rode the data island is dropped. Absent
   or empty is a silent cold start; either island corrupt is logged and the
   mount continues, the envelope without touching the records.
5. Assemble the chain through the same shared module the prerenderer used, with
   the same snapshot threaded into every preload. `data()` runs again here — but
   against the rehydrated store, which is what makes the client render match the
   markup already on screen.
6. Suppress enter animations, snapshot the prerendered children, clear, and mount
   the root directly into the *connected* container. Mounting into a detached
   fragment is not an option: `mounted()` hooks focus and measure by contract.
7. On rejection, destroy the instance and put the prerendered children back. A
   static page has no later patch and no remount, so this is the only recovery
   there is.

An unmarked target — a `prerender: false` page — skips the takeover path
entirely and mounts normally, enter animations and all.

Navigation is plain `<a>` full page loads against path-shaped files on disk. The
router stub throws on every navigation method and steers to links; its `url()`
hard-codes history-style encoding so hrefs match the file layout regardless of
what `routerMode` says ([[DECISION-D117-STATIC-OUTPUT-HISTORY-HREFS]]).

## What each mode embeds, and why

**Hybrid embeds nothing.** No data island, no serialized route, no payload. The
route snapshot exists only at build time, shadowed onto the shared memory
Router's `current` so route-aware markup — active-nav classes, `current.params`,
the link formatter — prerenders in the state the live router will render after
takeover ([[DECISION-D142-HYBRID-ROUTE-SNAPSHOT]]). Then it is thrown away; the
live router re-derives everything from the URL. Without it, every `current` read
rendered its nothing-is-current branch into the shipped HTML, which is exactly
what crawlers and no-JS visitors — hybrid's whole audience — would see. Hybrid
also transfers no adapter read state: the live app re-faults through the normal
D161 path after takeover.

**Static embeds three things, in two places.** The store's serialized state goes
into an inline JSON island anchored at a fixed shell offset (a `</body>` inside a
raw script block used to steal a scanned anchor), memoized across pages because
one build-time seed shared by every route is the common case. The adapter read
state the prerender settled — loaded keys and negative-cache absences — rides a
second envelope island beside it, so the client kernel adopts the build's reads
instead of re-faulting on first render ([[DECISION-D161-AUTO-FETCHING-FINDS]]);
a page that settled nothing carries no envelope. The route snapshot travels as
plain JSON baked into the generated per-page module, not the HTML. All are
necessary because a static page has no router to re-derive its identity from
and no `beforeMount` at runtime.

## Head ownership

The framework owns marker-bearing tags and the `<title>` element **inside the
shell's head region, and nowhere else** ([[DECISION-D84-HEAD-MANAGEMENT]],
[[DECISION-D151-SHELL-HEAD-OWNERSHIP]]). Fields resolve leaf-to-root with null
suppression; a resolving field replaces its first same-identity marker in place,
duplicates collapse, a field that no longer resolves has its markers removed, and
unmarked fields append before `</head>`.

Ownership is structural rather than conventional: the splice cannot reach past
`</head>`, so a `<svg><title>` or a marker-shaped attribute in view output stays
byte-identical. This is build-time only — there is no runtime head sync
([[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]]).

A shell with no `</head>` degrades to "through the first `</title>`"; with
neither anchor, managed tags warn and are skipped rather than throwing, and the
page still ships.

## What is skipped, and what fails the build

Skipped with a warning, build continues: dynamic `:param` routes; leaves under a
catch-all (unreachable); and, in hybrid only, routes shadowed by an earlier
first-match-wins pattern. A `:` or `*` inside a larger segment is literal text
and prerenders normally. No catch-all at all warns that no `404.html` will exist.

Hard build failures: a target selector that is not a `#id`, or a target that is
missing from the shell or not empty; hybrid combined with any `routerMode` (a
hash or memory router boots at `/` and would render the home route over every
deep-linked page); any route's `data()` rejecting, named by route — a tracked
fault the settle loop cannot satisfy fails the same way; a route path
escaping the output directory; a RAWTEXT breakout; a `public/` asset colliding
with generated output or a reserved scratch name; and — static only — a rendered
route whose view or layout is a hand-written class carrying no compiled module
stamp (two routes normalizing to one output file is warn-and-skip, not a
failure — see the invariants below).

Warn-only divergences worth knowing: a hybrid route with a `guard` still ships
its markup publicly (a guard is a router gate, not a secrecy boundary —
`prerender: false` is the opt-out); static drops guards, `routerMode`, `storage`
and any function-shaped config that cannot cross the build-to-client boundary.

## Invariants that break silently

- **The two markers are not interchangeable.** The router adopts the hybrid
  marker; the static writer emits a different one precisely so the router — if
  it ever entered the graph — would never try. Swapping them yields double
  mounting or no takeover, with no error either way.
- **Hybrid HTML served against a plain-SPA bundle appends instead of
  replacing.** With the takeover define folded off, the clear is an empty
  method, so the fresh mount lands alongside the prerendered content — a
  visually duplicated page and no diagnostic. Both prerender modes emit their
  own bundle alongside their own HTML, so bundle and markup always ship
  together; the property that any bundle works against any markup is
  deliberately gone.
- **Slug assignment must precede any reuse decision.** Slugs are order-dependent
  because the collision counter walks the page list, so a subset render must
  still enumerate and claim for every page a full render would. Skip that and
  surviving pages' module URLs renumber under pages nobody re-rendered.
- **A catch-all's children must not consume a compiled-entry index.** One
  phantom index shifts every later leaf's shadow attribution by one — which
  inverts the skip, emitting the shadowed page and dropping the reachable one.
- **Two routes writing one file behave oppositely per mode.** Hybrid keeps both
  live in the router and lets the last claimant's HTML win; static refuses the
  second, and the emitted page belongs to the first route in reachable order.
- **Non-routed nested components see a null route at build time**, matching the
  browser. A component probing for a route renders its off-router branch into
  the HTML — correct, and surprising if you expected the route to be ambient.
- **The route snapshot's path is normalized in exactly one place.** Bypassing it
  makes a non-ASCII route's path differ between prerender and takeover.
- **`prerender: false` means different things per mode.** Hybrid writes the
  untouched shell with no head injection. Static writes an empty *unmarked*
  target but still builds the page context, so the build-time hook still runs and
  its store snapshot still becomes that page's island.
- **Portals and placeholders emit nothing**, so portaled markup is invisible to
  crawlers and to no-JS visitors in both modes.
