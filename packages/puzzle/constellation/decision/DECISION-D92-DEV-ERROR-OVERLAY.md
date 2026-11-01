---
name: 'D92 — Dev build errors reach the browser: typed SSE events, retained state, in-page overlay'
status: verified
connections:
  - COMPONENT-DEV-SERVER
  - FILE-DEV-SERVER
  - DECISION-D27-FAST-DEV-REBUILDS
  - DECISION-D57-HMR-STATE-RELOAD
  - DOC-SPEC
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D92 — Dev build errors reach the browser: typed SSE events, retained state, in-page overlay

A failed `puzzle dev` build shows up in the page, not only in the terminal.
Dev server only (`compiler/internal/dev/dev.go`); `puzzle build` and prerender
are untouched.

## Decision

1. **Typed events on the one SSE channel.** Hub client channels carry a
   `hubMessage{event, payload}`: `reload`, `builderror`, `clear`.
   - Each client channel is buffered size 1 with a non-blocking send;
     `broadcast` drains the stale pending message, then sends (last write
     wins), so a `builderror` supersedes a pending `reload`.
   - Payloads are JSON-encoded — SSE `data:` can't hold raw newlines, and
     diagnostics are multi-line.
   - `builderror` bypasses the D27 reload coalescer and broadcasts immediately.
2. **Retained error state, replayed on connect.** The server (not the hub,
   which stays a stateless fan-out bus) owns a mutex-guarded `lastError`, set on
   failure and cleared on success, so a failed initial build and a tab refresh
   while broken still show the error. `serveSSE` **registers with the hub before
   reading `lastError`** — the other order can drop an event; this one can at
   worst duplicate a frame. Replay and live delivery share `writeSSEFrame`. The
   client shares one stream per origin across tabs (COMPONENT-DEV-SERVER), so a
   tab joining while broken asks the leader tab for the retained error.
3. **Error shell when there's no `dist/index.html`** (fresh clone + bad edit):
   if the index would 404 and an error is retained, serve a self-contained page
   with status **503** (scripted callers and health checks must not see a
   working app), the diagnostic HTML-escaped and rendered server-side, and the
   reload script injected so fixing the error reloads into the real app. The
   client adopts that server-rendered overlay node by id instead of stacking a
   second one. With no retained error, the 404 is unchanged.

Server shell and client overlay share one `buildErrorStyle` constant.

## Alternatives rejected

- **Keep a bare ping and poll a status endpoint** — more moving parts than
  widening the channel.
- **Retention on the hub** — conflates fan-out with state.
- **A static error page without the reload script** — needs a manual refresh
  after every fix.
