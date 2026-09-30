---
name: D13 — `puzzle dev` is watch + serve + live reload; `puzzle build` defaults to production
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
---

# D13 — `puzzle dev` and `puzzle build`

Enforced by [[DOC-SPEC-ANATOMY]] §11. The rest of the CLI is [[DECISION-D32-CLI-TOOLING]].

## Decision
- `puzzle dev` = watch + static server with history-API fallback + SSE full-page live reload. The reload is state-preserving ([[DECISION-D57-HMR-STATE-RELOAD]]); there is no per-module hot swap. The fast rebuild path is [[DECISION-D27-FAST-DEV-REBUILDS]].
- `puzzle build` produces optimized production output by default; `--mode development` gives readable output.

## Alternatives rejected
- A `watch` command, and a `--production` opt-in flag (the prototype) — the common case should be the default.
