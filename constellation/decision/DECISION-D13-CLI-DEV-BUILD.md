---
name: "D13 — CLI v1 is `puzzle dev` + `puzzle build`; build defaults to production"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
---

# D13 — CLI v1 is `puzzle dev` + `puzzle build`; build defaults to production

Settled; enforced by [[DOC-SPEC]] §11. v1's CLI is just `puzzle dev` (watch + static server + SSE live reload) and `puzzle build` (production by default).

## Context
The prototype had a `watch` command and inverted the production/development default behind a `--production` flag.

## Decision
- `dev` replaces the prototype's `watch` — watch + static server with history fallback + SSE full-page live reload (no HMR in v1).
- `build` produces optimized output by default with `--mode development` as the override (the prototype had this inverted behind a `--production` flag).

## Alternatives rejected
- `init`/`generate`/`add`/`doctor`/`info` are deferred (later landed in v1.4, [[DECISION-D32-CLI-TOOLING]]).
