---
name: Puzzle glossary
status: built
connections:
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - DOC-PUZZLE-FILE
  - DOC-DATASTORE
  - DOC-ROUTER
  - DOC-TEMPLATE-SYNTAX
  - DOC-COMPILATION-FLOW
---

# Puzzle glossary

Current terms. [[DOC-SPEC]] is authoritative.

**adapter** — The opt-in server sync capability (`@magic-spells/puzzle/adapter`)
plus each model's per-verb fetch functions or `endpoint` shorthand.

**app root** — The directory holding `app/`, `puzzle.config.js` and
`package.json`.

**collection key / record key** — Store subscription identities for a whole
model type or one primary-keyed record.

**component** — A reusable `.pzl` class rendered inline. It has props and
call-site children; its `<puzzle-view>` section renders no wrapper element. A
tag is a component when its first character is not `a`–`z`; a dotted tag
(`<Frame.Wrapper>`) names a family member.

**controlled property** — `value`, `checked`, `selected`, `disabled` and the
like, set as DOM properties and compared against the live DOM. On a plain form
control a path-shaped `value=`/`checked=` is two-way; an author
`@input`/`@change` replaces the synthesized write-back.

**data layer** — The values returned by the latest successful `data()`;
replaced on refresh, below the local layer.

**default children** — Content inside a component invocation, placed by the
child with `<Children/>`.

**development-state transfer** — The one-shot snapshot/restore `puzzle dev`
uses across full reloads for store records and JSON-safe local view data. Not
per-module hot replacement.

**function** — A display transform a template calls by name, value first:
`{ currency(price) }`, `{ truncate(title, 40) }`. The library is 19 standard
functions plus PuzzleKit's `link` and `timeago`, tree-shaken to what templates
call; apps register their own under the `formatters` config key. Never call
one a filter or a pipe.

**island** — A host element whose children belong to the browser or a
third-party library after mount; its own attributes and listeners still patch.

**layout** — A routed view wrapping a route chain; `<Slot/>` marks the outlet.

**list block** — The persistent per-key row state behind an item-form
`{#for}`; an unchanged row returns its cached vnode subtree.

**local layer** — Persistent component state set by `setData()`; overrides
same-named data-layer values and renders without rerunning `data()`.

**model / record** — A `PuzzleModel` subclass defines schema and behavior; a
record is its stable instance, stored by type and primary key.

**morph** — Optional shared-element transitions keyed by `data-puzzle-morph*`
attributes, complementing router transitions.

**named slot** — `<Slot name="…"/>` in a component, filled by a call-site child
with a static `slot="…"`; renders its fallback body or nothing when unfilled.

**navigation token** — Monotonic router identity that stops stale loads or
transitions from committing over a newer navigation.

**prerender** — Build-time execution and serialization of routes to HTML;
never request-time SSR or hydration. `output: 'hybrid'` ships the pages plus
the SPA, which takes over at navigation zero; `output: 'static'` ships pages
with no router or `app.js`, each woken by a per-page `mountStatic` module.

**PuzzleApp / PuzzleView / PuzzleModel** — The app owner (config, context,
router startup, lifecycle, teardown); the plain base class for views, layouts
and components; the base class for schema-backed records.

**render revision** — A record's last notification sequence, compared when a
record is passed as a prop, so a child refreshes on that record's mutations.

**router outlet** — Bare `<Slot/>`, where a routed child mounts.

**scoped styles** — `<style scoped>`, wrapped in native `@scope` and anchored
by a compiler-generated root attribute.

**skeleton** — Optional first-load placeholder in `<puzzle-skeleton>`, with an
optional minimum duration.

**snippet** — `<Snippet fits="name" params…>` at a call site: a parameterized
body the component stamps per item through its own markers.

**store** — Per-app record registry, query and subscription engine, and
persistence owner; with the adapter capability, it also fetches and syncs.

**ViewNode / ViewManager** — The virtual node, and the runtime that mounts,
diffs, patches, composes and destroys ViewNode trees.

**write sync** — Explicit `save()` and `delete()` on a record of an
adapter-backed app; `destroy()` only removes locally. Local writes validate
first; reads upsert authoritative server data.
