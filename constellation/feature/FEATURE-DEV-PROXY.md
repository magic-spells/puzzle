---
name: "Dev-server API proxy (puzzle.config.js dev.proxy)"
status: verified
verified_at: '2026-07-23T16:30:48.345Z'
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
verified_sha: 93ebefacfc0dcd35ea787a1f09b56aa308bea4f9
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

## As built

Two small pieces, both in the compiler:

**1. Config surface ([[FILE-CONFIG]])** — `Config`/`rawConfig` carry a
`Dev struct { Proxy map[string]string }` block. No new JS parsing was needed: the
config is already read by shelling out to node and JSON-round-tripping the full
default export, so the `dev:` key rides along. `validate()` requires each key to
be an absolute `/`-prefixed path and each target to parse as an absolute http(s)
URL with a host, both rejected with messages naming the offender.

**2. Handler chain ([[FILE-DEV-SERVER]])** — `Serve` loads the config once and
threads `cfg.Dev.Proxy` into `newServer`; `(*server).handler()` registers each
prefix on the mux before the catch-all static handler, backed by
`httputil.NewSingleHostReverseProxy`. Prefixes register in both `/api` and
`/api/` forms (ServeMux treats exact and subtree patterns separately), sorted
for deterministic order; a trailing-`/` prefix is normalized, and a `/` prefix
proxies the root and replaces the static handler entirely. The default director
would prepend a path carried by the target URL, so a wrapped director restores
the browser's path/rawPath/query byte-for-byte — `dev.proxy` has no rewrite
semantics; only scheme, host, and forwarding headers come from the target.

## Behavior details

- **SSE/WebSocket**: `ReverseProxy` handles streaming responses (incl. SSE)
  natively; fine for dev.
- **Errors**: an `ErrorHandler` logs one friendly line ("proxy /api →
  http://localhost:3091 refused — is the backend running?") and answers
  502 "puzzle dev: backend unavailable" instead of a Go stack.
- **Config reload**: config is read once at startup; mid-session edits already
  print "restart to apply" — proxy inherits that, no new machinery.
- **Prod is untouched**: this is dev-server-only. `puzzle build` output and the
  SSG path ignore `dev.*` entirely. Apps still choose their prod `apiURL` strategy
  (same-origin deploy or absolute URL).

## Scope

**Out (unchanged):** path rewriting (`/api` → `/v2`), header injection, HTTPS
termination, prod proxying — YAGNI until a real app needs them (keep D08
minimal-config discipline).
