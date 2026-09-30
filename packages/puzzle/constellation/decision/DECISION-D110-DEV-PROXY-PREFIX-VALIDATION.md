---
name: D110 — dev.proxy rejects a root prefix and duplicate routes at config load
status: verified
connections:
  - COMPONENT-DEV-SERVER
  - FILE-CONFIG
  - FILE-DEV-SERVER
  - FEATURE-DEV-PROXY
  - DECISION-D08-MINIMAL-CONFIG
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D110 — `dev.proxy` rejects a root prefix and duplicate routes at config load

`dev.proxy` forwards matching path prefixes to a backend so an app can use
same-origin paths in dev. `config.validate` rejects, with the offending prefix
named:

- a key without a leading `/`, and a target that isn't an absolute URL;
- **`/` (root proxy)** — the backend would receive `index.html`, `app.js` and
  the reload stream, leaving the dev server nothing of its own. The feature's
  shape is "carve out what the backend owns"; `/` inverts it.
- **Two keys naming the same route after trailing-slash trim** (`/api` and
  `/api/`) — previously a `http.ServeMux` duplicate-pattern panic.

All `dev.proxy` rules live in the loader, so a malformed `dev.proxy` also fails
`puzzle build` even though build ignores `dev.*` — a config file is valid or
not regardless of which command reads it.

`handler()` in `dev.go` keeps its own guards (empty → `/`, a `registered` set
that skips repeats) as defense in depth: `newServer` is constructible directly
in tests and `Serve` is fail-soft on config errors, and a mux panic is
unrecoverable.

## Alternatives

- **Normalize `/` into a working root proxy** — makes a broken setup "work".
- **Reject `/` in the dev path instead of `validate`** — `Serve` is fail-soft on
  config errors, so dev would degrade (Tailwind off too) instead of halting.
- **Deduplicate silently** — deterministic but arbitrary.

Path rewriting, header injection and production proxying are out of scope (D8).
