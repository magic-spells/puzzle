---
name: development style watcher
status: verified
path: compiler/internal/styles/watch.go
language: go
summary: Warm Tailwind child process and lifecycle management.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# watch.go

`TailwindWatcher`: one long-lived `tailwindcss --watch` child per `puzzle dev` session (D27) instead of a one-shot spawn per rebuild ([[COMPONENT-DEV-SERVER]]). The child rewrites a private output file; the dev loop watches that file and recomposes `dist/styles.css`. It is killed on context cancel or `Stop()`; `Done()` closes when the process exits for any reason, so the dev loop can fall back to one-shot composition instead of serving stale CSS.

**Gotcha:** the watcher holds an unfed stdin pipe open for the child's lifetime. Tailwind v4's `--watch` exits when its stdin reaches EOF, and a detached child would otherwise inherit `/dev/null` and quit after its first build.
