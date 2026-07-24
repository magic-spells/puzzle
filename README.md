# Puzzle DevTools

A Chrome DevTools extension for [Puzzle](https://github.com/magic-spells/puzzle) apps:
the live view tree, store records, the subscription graph, and routing — read out of a
running dev build.

Puzzle ships a **dev-only runtime bridge**; this extension ships the page hook that
bridge registers into. There are no production bytes on either side: a production build
compiles the bridge away entirely, and a page with no bridge simply reports
"No Puzzle app detected".

> **Status: v1 panels.** The transport, the protocol plumbing, and all three panels —
> Connection, Views and Store — are built and tested. `snapshot:subscriptions` and
> `snapshot:route` are answered by the bridge but not yet surfaced in a panel.

## The panels

| Panel | What it shows |
| ----- | ------------- |
| **Connection** | Handshake state, framework/protocol versions, the last route commit, and a live ring of recent protocol messages. |
| **Views** | Elements-style master/detail over the live component tree. Expand/collapse per node, hover to highlight the view on the page, per-row `log:view` (binds `$p`), and a re-render pulse on rows a `flush` notified. Selecting a row inspects it: params, props, and **the two state layers side by side** — the `data()` model layer and the `setData()` local layer, which is the split the panel exists for. |
| **Store** | Record types with counts, a compact table of the active type (pk first, `_synced` as a badge), and a detail card that edits primitive fields through `edit:record` — applied by the runtime with the app's real `record.update()`, so §20 validation failures come back and render inline. |

Neither panel polls. The bridge writes monotonic counters into the panel's own store
(`connection.viewSeq` / `connection.flushSeq`, `pview.pulseAt`); a subscribed `data()`
sees them move and schedules its own debounced request. A page with no Puzzle app never
gets a request at all.

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
`view-mounted` · `view-destroyed` · `flush` · `route-commit`

Requests (extension → runtime): `snapshot:views` · `inspect:view` ·
`snapshot:records` · `snapshot:subscriptions` · `snapshot:route` · `edit:record` ·
`highlight:view` · `log:view` · `log:record`

Versions are exchanged in `hello`. A protocol version outside
`SUPPORTED_PROTOCOL_VERSIONS` puts the panel in an explicit mismatch state rather than
misrendering.

## Development setup

The framework is not published at the version this extension needs, so the panel is
built against a **sibling checkout**:

```
Code/@magic-spells/
  puzzle/            ← framework checkout (provides the runtime AND the compiler binary)
  puzzle-devtools/   ← this repo
```

```bash
npm install
```

`package.json` depends on `"@magic-spells/puzzle": "file:../puzzle"`, which npm resolves
to a symlink at `node_modules/@magic-spells/puzzle`. If your npm version chokes on it,
create the link by hand — the build only needs the directory to exist:

```bash
mkdir -p node_modules/@magic-spells
ln -s ../../../puzzle node_modules/@magic-spells/puzzle
```

The compiler is invoked as a **binary**, not through the `puzzle` npm shim: that shim
resolves per-platform packages which are unpublished at 0.2.0.

```bash
export PUZZLE_BIN=/path/to/puzzle/puzzle    # defaults to ../puzzle/puzzle
```

## Build

```bash
npm run build          # panel + dist-extension/
npm run build:zip      # ... and puzzle-devtools-<version>.zip
node scripts/build.mjs --dev   # unminified panel with a sourcemap
```

`scripts/build.mjs`:

1. runs `$PUZZLE_BIN build` in `panel/`, producing `panel/dist/{app.js,styles.css}`;
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
`client-runtime/devtools.js` — with canned data. It is the end-to-end target while the
framework bridge is still in flight.

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
- answers all nine request types — `snapshot:views` returns a **six-node, three-level**
  tree rebuilt from a flat parent-linked list (so views added at runtime appear in it),
  `snapshot:records` two types of five-plus fields each including a boolean and a number,
  and unknown types come back as `{ error }`;
- **validates `edit:record`** before applying it, the way §20 does: an empty required
  string answers `{ error: 'text cannot be empty' }`, a primary-key change and an
  out-of-range number are refused, and a patch that fails anywhere is applied nowhere;
- offers buttons to emit each event on demand, and a box that `highlight:view` outlines.

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
| `fixture-page.test.js` | The real page hook driving the real fixture script: the event stream, every request's response shape, and the `edit:record` validation paths. |
| `panel-app.test.js`    | The compiled panel bundle booting against a stub bridge that reproduces panel-glue's `{ error }`-to-rejection contract. Three suites: the shell (connection states, view tracking, the event ring), the **Views** panel (tree render, indentation, expand/collapse, selection → both state layers, flush pulse, debounced re-snapshot, highlight/log requests, arrow keys), and the **Store** panel (type list, table shape, detail card, edit success, validation error, flush-driven re-snapshot). Skipped when `panel/dist/app.js` has not been built. |

There is no Chrome automation in this phase; loading the unpacked extension is a manual
smoke test.

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
