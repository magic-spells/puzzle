---
name: >-
  D92 — Dev build errors reach the browser: typed SSE events, retained state, in-page overlay
  (v1.55)
status: verified
connections:
  - COMPONENT-DEV-SERVER
  - FILE-DEV-SERVER
  - DECISION-D27-FAST-DEV-REBUILDS
  - DECISION-D57-HMR-STATE-RELOAD
  - DOC-SPEC
verified_at: '2026-08-16T04:35:01.948Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

A failed `puzzle dev` build now shows up **in the page**, not only in the terminal. The reload channel carries typed events, the server retains the current error so late-connecting clients see it, and a first-ever failed build serves a self-healing error shell instead of a bare 404.

## Context

`rebuild` logged the failure to stderr and returned. The browser kept being served the last good `dist/`, with no signal that anything had failed — a developer whose terminal was not visible saw an app that simply "didn't change." Vite, Next, Nuxt, and SvelteKit all overlay build errors in the page; failing silently was the outlier.

The compiler already produces the hard part. Positioned `.pzl` diagnostics and esbuild's messages are high quality; they just never left the terminal.

## Decision

Three layers, each closing a distinct hole.

**1. Typed events over the existing SSE channel.** The hub's client channels carried `struct{}` — a bare ping meaning "reload." They now carry a `hubMessage{event, payload}`, so the same connection delivers `reload`, `builderror`, and `clear`.

- **Last-write-wins on a full buffer.** Each client channel is buffered size 1 and the send is non-blocking so a slow client never blocks a rebuild. The original `default:` branch dropped the **new** message, which is backwards once messages carry meaning: a `builderror` arriving behind a pending `reload` must supersede it, not be discarded. `broadcast` now drains the stale pending message and then sends.
- **The payload is JSON-encoded.** SSE `data:` fields cannot contain raw newlines — a bare newline ends the field and a blank line ends the event — and build diagnostics are inherently multi-line. `json.Marshal` puts any diagnostic on one safely parseable line; the client `JSON.parse`s it.
- **`builderror` is never coalesced.** The D27 reload coalescer exists because one `.pzl` edit triggers both an esbuild rebuild and a Tailwind rescan; errors bypass it and broadcast immediately.

**2. Retained error state, replayed on connect.** The hub is a fan-out bus with size-1 buffers and no retention, so a client that connects *after* a failure would never learn about it. Two real failure modes followed: a failed **initial** build broadcasts to zero clients (the listener is not even bound yet), and **refreshing the tab** while the build is still broken made the overlay vanish — a refresh appearing to "fix" the error is worse than never showing it.

`server` now owns a mutex-guarded `lastError`, set at both failure branches and cleared on success. `serveSSE` **registers with the hub before reading it**, so a build transition racing the connection can at worst deliver a duplicate frame (harmless, self-correcting) rather than fall between the two and be missed entirely. `writeSSEFrame` is shared by replay and live delivery so the two framings cannot drift apart.

**3. An error shell when there is no `dist/index.html`.** Retention still cannot help a first-ever failed build: with no shell on disk the response is a 404, no `EventSource` connects, and the developer sees "404 page not found" instead of a positioned diagnostic. This is not exotic — `dist/` is gitignored, so a fresh clone plus one bad edit reproduces it.

When `serveIndex` would 404 **and** an error is retained, it serves a self-contained shell instead:
- **503**, not 200 — the app genuinely is not built, and scripted callers should not be told otherwise.
- The diagnostic is **HTML-escaped** and rendered server-side, so the page is useful in the instant before the `EventSource` opens (and so template markup inside an error cannot break the page).
- The reload script is injected, making it **self-healing**: fix the error, the rebuild's coalesced `reload` fires over the already-open connection, and the page reloads into the real app with no manual refresh.
- The client script **adopts the server-rendered overlay node by id** rather than drawing its own, so the SSE replay does not stack a second overlay on top of the server-rendered one.
- With no retained error, the 404 path is byte-identical to before.

## Consequences

- The dev loop's worst failure mode — a silently stale app — is gone in all three shapes: mid-session failure, refresh-while-broken, and first-run failure.
- `broadcast` gained an argument, so `reloadCoalescer.fire` is now `func(hubMessage)`; the coalescer constructs the `reload` message itself.
- Server shell and client overlay share one `buildErrorStyle` constant, so they cannot drift visually.
- Dev-server only. `puzzle build` and both prerender paths are untouched, matching how `dev.proxy` is scoped.

## Alternatives rejected

- **Keeping the bare ping and inferring failure client-side** (e.g. polling a status endpoint) — more moving parts than widening a channel that already exists.
- **Retaining state on the hub** rather than the server — the hub is a stateless fan-out bus with size-1 buffers; retention is a different concern and conflating them would make the coalescing semantics harder to reason about.
- **Reading the retained error before hub registration** — the ordering that can drop an event. Registering first can only duplicate one.
- **Sending the payload raw across `data:`** — corrupts the stream on the first multi-line diagnostic, which is essentially every real one.
- **Serving the error shell with 200** — misleads health checks and scripted callers into thinking the dev server is serving a working app.
- **A static error page with no reload script** — requires a manual refresh after every fix, which is meaningfully worse than self-healing.
