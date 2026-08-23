# Puzzle DevTools

A Chrome DevTools extension for [Puzzle](https://github.com/magic-spells/puzzle) apps:
the live view tree, store records, the subscription graph, and routing — read out of a
running dev build.

Puzzle ships a **dev-only runtime bridge**; this extension ships the page hook that
bridge registers into. There are no production bytes on either side: a production build
compiles the bridge away entirely, and a page with no bridge simply reports
"No Puzzle app detected".

**Requires Puzzle 0.6.0+** running a **development** build (`puzzle dev`). The bridge
is compiled out of production bundles, so a production page correctly reports no app.

## The panels

| Panel | What it shows |
| ----- | ------------- |
| **Connection** | Handshake state, framework/protocol versions, the last route commit, and a live ring of recent protocol messages. |
| **Views** | Elements-style master/detail over the live component tree. Expand/collapse per node, hover to highlight the view on the page, per-row `log:view` (binds `$p`), and a re-render pulse on rows a `flush` notified. Selecting a row inspects it: params, props, the view's store subscriptions, and **the two state layers side by side** — the `data()` model layer and the `setData()` local layer, which is the split the panel exists for. |
| **Store** | Record types with counts, a compact table of the active type (pk first, `_synced` as a badge), and a detail card that edits primitive fields through `edit:record` — applied by the runtime with the app's real `record.update()`, so §20 validation failures come back and render inline. An open card also keeps a per-flush change history (`field: old → new`). |
| **Subscriptions** | The store's reverse index as a panel: subscription keys grouped into collections (`todo`) and records (`todo t2`), and for the selected key, **every view that re-renders when it changes** — the blast radius of a write. Click a subscriber to land on it in Views. Subscriptions a **prepared, uncommitted** `data()` run added are marked `pending` rather than counted as ordinary listeners — during an open navigation a reused ancestor really is subscribed to both routes' keys, and the mark is what keeps that from reading as a leak. This is the panel other frameworks structurally cannot build: it is a lookup, not an inference. |
| **Router** | The live route card — pathname, route pattern, params, the frozen query snapshot — over the matched chain root→leaf, and a navigation history feed rebuilt from the event ring. |
| **Performance** | Record a session and see what it cost. **Wasted renders lead** — passes where the framework re-ran a view, re-diffed its tree and changed no DOM at all, which is the one number here that is unambiguously a bug. Under the totals: a sortable per-view table (renders, wasted, DOM mutations, render/patch/data ms) with a re-render heatmap scaled to the busiest view, hatching on views that are mostly waste, and a loud section for `recursive-loop` / `runaway-rerender` detections. Click a row to land on that view in Views. |

No panel polls — with one deliberate exception. The bridge writes monotonic counters into
the panel's own store (`connection.viewSeq` / `flushSeq` / `perfSeq`, `pview.pulseAt`); a
subscribed `data()` sees them move and schedules its own debounced request. A page with no
Puzzle app never gets a request at all.

The exception is the Performance panel, which polls `snapshot:profile` once a second
**while recording** and not otherwise. There is deliberately no per-render event: the page
hook buffers 500 messages before the panel attaches and the panel's ring holds 200, so a
render firehose would overrun both and evict the events every other panel depends on.
Counters are kept in the runtime and pulled. The only thing pushed is `perf-warning`,
which is rare and urgent.

## Architecture

```
  INSPECTED PAGE                          EXTENSION                       DEVTOOLS
 ┌───────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐
 │ MAIN world                │  │ ISOLATED world           │  │ devtools.html        │
 │                           │  │                          │  │  └ devtools.js       │
 │  Puzzle runtime bridge    │  │  content-script.js       │  │     panels.create()   │
 │   client-runtime/         │  │                          │  │                      │
 │   devtools.js  (D100)     │  │   window.postMessage     │  │ panel.html           │
 │        │                  │  │        ▲   │             │  │  ├ panel-glue.js     │
 │        │ emit / onRequest │  │        │   ▼             │  │  │   port + theme    │
 │        ▼                  │  │   chrome.runtime port    │  │  └ panel/app.js      │
 │  __PUZZLE_DEVTOOLS_HOOK__ │◄─┼──►  'puzzle-devtools-    │  │      the Puzzle      │
 │   page-hook.js            │  │      page'               │  │      panel app       │
 └───────────────────────────┘  └────────────┬─────────────┘  └───────────┬──────────┘
                                             │                            │
                                             ▼                            ▼
                                   ┌─────────────────────────────────────────────┐
                                   │ background.js (MV3 service worker)          │
                                   │ pairs ports by tab id, routes both ways     │
                                   └─────────────────────────────────────────────┘
```

Each hop, and why it exists:

| File                | World / context     | Job |
| ------------------- | ------------------- | --- |
| `page-hook.js`      | page, MAIN world    | Installs `window.__PUZZLE_DEVTOOLS_HOOK__` at `document_start`. Buffers up to 500 events until the panel attaches, then streams. Relays requests to the bridge's handler and posts the answer back. |
| `content-script.js` | page, ISOLATED      | Dumb relay: `window.postMessage` ↔ `chrome.runtime` port. Reconnects when the service worker is recycled. |
| `background.js`     | service worker      | Pairs a content-script port (`sender.tab.id`) with a panel port (`puzzle-devtools-panel:<tabId>`) and routes between them. Stateless — the maps are rebuilt from live ports. |
| `devtools.js`       | devtools page       | `chrome.devtools.panels.create('Puzzle', …, 'panel.html')`. |
| `panel-glue.js`     | panel page          | The only file that touches `chrome.*`: connects the port, correlates requests by id (5s timeout), applies `data-theme` from `chrome.devtools.panels.themeName`. |
| `panel/`            | panel page          | The panel UI — itself a Puzzle app. Protocol events land in its store as records; views are ordinary reactive Puzzle views. |
| `protocol/`         | shared              | Message-type names and `PROTOCOL_VERSION`, the single source in this repo. |

The MAIN-world hook is unavoidable: a content script in the isolated world cannot see
page globals, and the runtime bridge cannot see extension APIs. `window.postMessage` is
the only channel they share.

### The hook contract

This repo owns the shape of `window.__PUZZLE_DEVTOOLS_HOOK__`; the framework bridge
consumes it.

```js
window.__PUZZLE_DEVTOOLS_HOOK__ = {
  hookVersion: 1,        // shape of THIS object
  protocolVersion: 1,    // wire protocol it expects
  emit(message),         // runtime → extension; buffered until the panel attaches
  onRequest(handler),    // handler(message) => payload; returns an unsubscribe fn
};
```

`handler` is called synchronously and is expected to be **total** — the framework
returns `{ error }` rather than throwing. A throw is handled anyway (it becomes an
`{ id, error }` answer), and a returned promise is awaited.

### Wire protocol

Every message, both directions, is:

```js
{ puzzle: 1, v: 1, type, payload }
```

Protocol **v1**. The authority is the framework spec —
[`constellation/doc/DOC-SPEC.md` §55, "The DevTools bridge and wire protocol"](https://github.com/magic-spells/puzzle)
— and `protocol/constants.js` transcribes it. `tests/protocol.test.js` asserts the name
lists literally, so a rename upstream breaks this repo's suite instead of silently
breaking the panel.

Events (runtime → extension): `hello` · `app-mounted` · `app-unmounted` ·
`view-mounted` · `view-destroyed` · `flush` · `route-commit` · `perf-warning`

Requests (extension → runtime): `snapshot:views` · `inspect:view` ·
`snapshot:records` · `snapshot:subscriptions` · `snapshot:route` · `edit:record` ·
`highlight:view` · `log:view` · `log:record` · `perf:start` · `perf:stop` ·
`snapshot:profile`

Versions are exchanged in `hello`. A protocol version outside
`SUPPORTED_PROTOCOL_VERSIONS` puts the panel in an explicit mismatch state rather than
misrendering.

**The message set grows additively, without a version bump.** Both ends already tolerate
names they do not know — an unrecognized event falls through to the event ring, an
unrecognized request comes back as a per-call `{ error }` — so a newer panel still renders
everything an older runtime sends. That is why the profiler messages above are v1: bumping
would have put every already-published app into the hard mismatch state and blanked all
six panels, to buy nothing. A runtime with no profiler simply reports the failure inside
the Performance panel and leaves the rest working.

## Development setup

```bash
npm install
```

That is the whole setup. `@magic-spells/puzzle` comes from npm, and its `puzzle` shim
lands at `node_modules/.bin/puzzle` — which is what compiles the panel. Nothing outside
this repo is required.

To build the panel against an **unpublished framework checkout** instead (developing the
bridge and the panel together), point `PUZZLE_BIN` at a compiler you built:

```bash
cd /path/to/puzzle/compiler && go build -o ../puzzle ./cmd/puzzle
PUZZLE_BIN=/path/to/puzzle/puzzle npm run build
```

## Build

```bash
npm run build          # panel + dist-extension/
npm run build:zip      # ... and puzzle-devtools-<version>.zip
node scripts/build.mjs --dev   # unminified panel with a sourcemap
```

`scripts/build.mjs`:

1. runs the puzzle compiler's `build` in `panel/`, producing
   `panel/dist/{app.js,styles.css}`;
2. assembles `dist-extension/` = everything in `extension/` plus the panel bundle under
   `dist-extension/panel/`, matching the `src`/`href` paths in `panel.html`;
3. verifies every file the manifest and `panel.html` reference actually exists — Chrome
   reports those as vague load failures, so they are caught here;
4. with `--zip`, packs the directory.

### Load it in Chrome

1. `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `dist-extension/`
4. Open DevTools on a page running a Puzzle **dev** build → the **Puzzle** panel

Reloading the extension requires reloading inspected pages too: the page hook is
injected at `document_start` and a live page never gets a second chance.

## Fixture page

`test/fixture-page/index.html` is the permanent protocol test double: an inline script
that plays the runtime bridge — same envelope, same event order, same response shapes as
`client-runtime/devtools.js` — with canned data. It exercises the whole pipe without a
framework app, which is what keeps the suite honest about protocol shapes.

```bash
npm run serve:fixture     # http://localhost:5177/
```

Serve it over http, not `file://`: content scripts are not injected into `file://` pages
unless the user grants file access.

What it does on load:

- waits for `__PUZZLE_DEVTOOLS_HOOK__`, reports what it found in the page;
- emits `hello` → `app-mounted`, registers its request handler, then replays one
  `view-mounted` per live view;
- emits a `flush` every 2s with rotating keys, and one `route-commit` at 5s;
- answers all twelve request types — `snapshot:views` returns a **six-node, three-level**
  tree rebuilt from a flat parent-linked list (so views added at runtime appear in it),
  `snapshot:records` two types of five-plus fields each including a boolean and a number,
  and unknown types come back as `{ error }`;
- **validates `edit:record`** before applying it, the way §20 does: an empty required
  string answers `{ error: 'text cannot be empty' }`, a primary-key change and an
  out-of-range number are refused, and a patch that fails anywhere is applied nowhere;
- **profiles on demand**: `perf:start` begins accumulating a canned per-view cost every
  500ms (deterministic, no `Math.random`, so sort order and heat buckets are reproducible),
  `snapshot:profile` reports it as a pure read, and `perf:stop` freezes the counters
  without discarding them. FixtureRow #3 is the pathological view — 24 renders per tick,
  21 of them wasted — so the panel's default sort has an unambiguous top row. Flushes that
  land during a recording become the report's store-side timeline;
- offers buttons to emit each event on demand, two that fire the loop detector
  (`runaway-rerender` and `recursive-loop`, counting up on repeat rather than duplicating),
  and a box that `highlight:view` outlines.

Expected panel behavior: the Connection view flips from "No Puzzle app detected" to
"Puzzle app connected", the message list fills, and **Probe snapshot:views** answers
"1 root(s), 6 view(s)". The **Views** panel shows the tree with FixtureRow #3's
`completed` differing between the two state layers; the **Store** panel lists `todo` and
`user`, and typing an empty `text` into a todo and pressing Apply renders the validation
message inline.

## Tests

```bash
npx vitest run
```

| Suite                  | Covers |
| ---------------------- | ------ |
| `protocol.test.js`     | Type names match SPEC §55 literally; the constants duplicated into the classic scripts agree with `protocol/constants.js`; manifest shape. |
| `page-hook.test.js`    | Buffering, ordered replay, the 500-event cap, request/response id correlation, error paths, same-window filtering. |
| `panel-glue.test.js`   | Port naming, envelope construction, id correlation under out-of-order answers, the request timeout, `{ error }`-result unwrapping, status events. |
| `background.test.js`   | Port pairing by tab id, both routing directions, the replayed `listening` control, stale-port replacement, rejection of malformed ports. |
| `fixture-page.test.js` | The real page hook driving the real fixture script: the event stream, every request's response shape, the `edit:record` validation paths, and the profiler (report shape, accumulation, stop-keeps-counters, pushed warnings and their dedupe-by-count). |
| `panel-app.test.js`    | The compiled panel bundle booting against a stub bridge that reproduces panel-glue's `{ error }`-to-rejection contract: the shell (connection states, view tracking, the event ring), **Views** (tree render, indentation, expand/collapse, selection → both state layers, subscriptions group, flush pulse, debounced re-snapshot, highlight/log requests, arrow keys), **Store** (type list, table shape, detail card, edit success, validation error, change history), **Subscriptions** (rail grouping, subscriber lists, cross-tab hand-off), **Router** (card, chain, history feed), and **Performance** (record/stop, the polling window opening and closing with it, the wasted-renders headline, column sorting, heat scaling, pushed warnings, the cross-link, and session reset on navigation). Skipped when `panel/dist/app.js` has not been built. |
| `values.test.js`       | The pure projection helpers with no DOM: view-kind derivation, module-label redundancy rules, subscription-key parsing (the `type id` **space** separator — a colon regression fails here), the record differ, history capping, and the profiler projections (formatting, waste ratios, relative heat buckets, the tiebreak that stops a once-a-second table from reshuffling, and the warning merge). |

There is no Chrome automation; loading the unpacked extension is a manual smoke test.

## Layout

```
extension/          the extension package (copied verbatim into dist-extension/)
panel/              the panel UI — a Puzzle app (app/, puzzle.config.js)
protocol/           message names + PROTOCOL_VERSION
scripts/            build.mjs, serve-fixture.mjs, make-icons.mjs
test/fixture-page/  the synthetic bridge
tests/              vitest suites
```

## License

MIT
