---
name: Dev-server API proxy (dev.proxy)
status: verified
verified_at: '2026-08-24T21:11:50.859Z'
connections:
  - COMPONENT-DEV-SERVER
  - FILE-DEV-SERVER
  - FILE-CONFIG
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D110-DEV-PROXY-PREFIX-VALIDATION
  - DOC-SPEC-BUILD
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-1-2
change: feature
---

# Dev-server API proxy (`dev.proxy`)

A dev-only reverse proxy so an app can use same-origin API paths (`apiURL: ''`)
with no CORS middleware and no dev/prod URL split. `puzzle dev` forwards each
configured prefix to its backend; everything else is served from `dist/`.

```js
// puzzle.config.js
export default { dev: { proxy: { '/api': 'http://localhost:3091' } } };
```

## Contract

- **Config** ([[FILE-CONFIG]]): each key is an absolute `/`-prefixed path, each
  target an absolute http(s) URL with a host. A `/` prefix and two prefixes that
  normalize to the same route are config errors
  ([[DECISION-D110-DEV-PROXY-PREFIX-VALIDATION]]). A trailing `/` on a prefix is
  normalized.
- **Routing** ([[FILE-DEV-SERVER]]): prefixes register on the mux (both `/api`
  and `/api/` forms, sorted) before the static catch-all, backed by
  `httputil.NewSingleHostReverseProxy`. Streaming responses (SSE) pass through.
- **No rewriting.** A wrapped director restores the browser's path, raw path and
  query byte-for-byte; only scheme, host and forwarding headers come from the
  target. A path carried by the target URL is ignored.
- **Backend down** → one log line (`proxy /api → … refused — is the backend
  running?`) and a 502 `puzzle dev: backend unavailable`.
- Config is read once at startup; edits need a restart, like every other key.
- **Dev only.** `puzzle build`, both prerender passes, and `puzzle preview`
  ignore `dev.*`.

Out, until a real app needs it: path rewriting, header injection, HTTPS
termination, production proxying ([[DECISION-D08-MINIMAL-CONFIG]]).
