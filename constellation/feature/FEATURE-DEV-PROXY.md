---
name: "Dev-server API proxy (puzzle.config.js dev.proxy)"
status: verified
verified_at: '2026-07-22T09:00:00.000Z'
connections:
  - COMPONENT-DEV-SERVER
  - FILE-DEV-SERVER
  - FILE-CONFIG
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D03-SCRIPTS-REAL-JS
notes:
  - kind: state
    text: >-
      Found by the habit-lab test app (2026-07-22): the first Puzzle app with a
      live backend had to hand-roll CORS middleware and use an absolute apiURL
      because puzzle dev cannot forward /api/* to another port.
---

# Dev-server API proxy (`dev.proxy`)

## Intent

Every real app has a backend, and today every one of them must (a) write CORS
middleware and (b) hard-code an absolute `apiURL` that differs between dev and
prod. A dev-only reverse proxy removes both: the app uses same-origin paths
(`apiURL: ''`), and `puzzle dev` forwards matching prefixes to the backend.

```js
// puzzle.config.js
export default {
  styles: { use: ['tailwindcss'] },
  dev: {
    proxy: { '/api': 'http://localhost:3091' },
  },
};
```

## Design

Two small changes, both in the compiler:

**1. Config surface (`compiler/internal/config/config.go`)** — add a `Dev` block to
`Config` (`config.go:36-43`) and `rawConfig` (`config.go:92-102`):
`Dev struct { Proxy map[string]string }`. No new JS parsing is needed: the config is
already read by shelling out to node and JSON-round-tripping the full default export
(`readConfigViaNode`, `config.go:156-204`), so a `dev:` key survives today and is
simply ignored. Validate target URLs in `validate()` (`config.go:208-268`) — must
parse as absolute http(s) URLs; keys must start with `/`.

**2. Handler chain (`compiler/internal/dev/dev.go`)** — the hook is
`(*server).handler()` (`dev.go:397-402`). Register each proxy prefix on the mux
**before** the catch-all `/` static handler, backed by
`httputil.NewSingleHostReverseProxy(target)`. Go's `ServeMux` longest-prefix
matching means `/api/` naturally wins over `/`, so the SPA history fallback in
`serveStatic` (`dev.go:447-448`) never swallows proxied paths. Thread the map
through `newServer` (`dev.go:393-395`); the config is already loaded in `Serve` at
`dev.go:155`.

Register both `/api` and `/api/` forms (mux semantics), strip nothing — forward the
path verbatim so backend routes match what the browser sent.

## Behavior details

- **SSE/WebSocket**: `ReverseProxy` handles streaming responses (incl. SSE)
  natively; fine for dev.
- **Errors**: default `ReverseProxy` 502s when the backend is down — add an
  `ErrorHandler` that logs one friendly line ("proxy /api → :3091 refused — is the
  backend running?") instead of a Go stack.
- **Config reload**: config is read once at startup; mid-session edits already
  print "restart to apply" (`dev.go:126-129`, `320-329`) — proxy inherits that,
  no new machinery.
- **Prod is untouched**: this is dev-server-only. `puzzle build` output and the
  SSG path ignore `dev.*` entirely. Apps still choose their prod `apiURL` strategy
  (same-origin deploy or absolute URL).

## Scope

**In:** config field + validation, mux wiring, error handler, `puzzle doctor`/docs
mention, DOC-USER-GUIDE section ("Backends in dev").
**Out:** path rewriting (`/api` → `/v2`), header injection, HTTPS termination,
prod proxying — YAGNI until a real app needs them (keep D08 minimal-config
discipline).

## Test plan

- Unit: config validation (bad URL, non-`/` prefix → clear errors).
- Integration (Go httptest): dev server + stub backend — `/api/x` forwarded with
  method/body/headers, `/` still serves the SPA shell, unknown non-file path still
  falls back to index.html, backend-down → 502 + friendly log.
- Manual: habit-lab with `apiURL: ''` + proxy config, CORS middleware deleted —
  full Sync Lab pass (its 10 scenarios are the regression suite for this).
