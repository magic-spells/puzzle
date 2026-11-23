---
name: app scaffolder
status: verified
path: compiler/internal/scaffold/scaffold.go
language: go
summary: Embedded starter templates, name validation, and JS/TS project config.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
notes:
  - kind: gotcha
    text: >-
      The starters are dark only: `index.html` sets `color-scheme` to `dark` and `data-theme="dark"`
      on `<html>` (the puzzle-pieces style attribute), so pieces added later stay dark in either OS
      scheme. A template `@theme` token that shares a name with a puzzle-pieces token must mean what
      pieces means by it: the printed `@import './pieces.css';` goes above the template's `@theme`,
      and the last declaration wins. The default template declares only `accent` and `accent-2`,
      which pieces does not use.
    sha: b3321107
---

# scaffold.go

Backs `puzzle init` ([[COMPONENT-COMPILER-CLI]]): validates the app name (it becomes an npm package name) and the template, refuses a non-empty target, and copies an embedded template tree with `__APP_NAME__` substituted. Templates are real files under `templates/<name>/` (`default`, `todos`), embedded with `go:embed all:` so dotfiles ship. `--typescript` (D54) lays `templates/<name>-ts/` over the base tree: an overlay file replaces the base file at its path, and an overlay `x.ts` also drops the base `x.js`.

**Gotcha:** each template's `package.json` `@magic-spells/puzzle` range and `engines.node` (D200) are embedded in the binary. A stale range ships a broken `puzzle init` and only a binary rebuild fixes it; `release:prep` fails when a range does not match the release version.
