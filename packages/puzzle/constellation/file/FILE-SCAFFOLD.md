---
name: app scaffolder
status: verified
path: compiler/internal/scaffold/scaffold.go
language: go
summary: Embedded starter templates, name validation, and JS/TS project config.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# scaffold.go

Backs `puzzle init` ([[COMPONENT-COMPILER-CLI]]): validates the app name (it becomes an npm package name) and the template, refuses a non-empty target, and copies an embedded template tree with `__APP_NAME__` substituted. Templates are real files under `templates/<name>/` (`default`, `todos`), embedded with `go:embed all:` so dotfiles ship. `--typescript` (D54) lays `templates/<name>-ts/` over the base tree: an overlay file replaces the base file at its path, and an overlay `x.ts` also drops the base `x.js`.

**Gotcha:** each template's `package.json` `@magic-spells/puzzle` range is embedded in the binary. A stale range ships a broken `puzzle init` and only a binary rebuild fixes it; `release:prep` fails when a range does not match the release version.
