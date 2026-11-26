---
name: D13 — `puzzle dev` is watch + serve + live reload; `puzzle build` defaults to production
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D13 — `puzzle dev` and `puzzle build`

Enforced by [[DOC-SPEC-ANATOMY]] §11. The rest of the CLI is [[DECISION-D32-CLI-TOOLING]].

## Decision
- `puzzle dev` = watch + local server + SSE full-page live reload. SPA and hybrid apps get a history-API fallback; `output: 'static'` apps are served as real static pages ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]). The reload is state-preserving ([[DECISION-D57-HMR-STATE-RELOAD]]); there is no per-module hot swap. The fast rebuild path is [[DECISION-D27-FAST-DEV-REBUILDS]].
- `puzzle build` produces optimized production output by default; `--mode development` gives readable output.

## Alternatives rejected
- A separate `watch` command, or a `--production` opt-in flag — the common case should be the default.
