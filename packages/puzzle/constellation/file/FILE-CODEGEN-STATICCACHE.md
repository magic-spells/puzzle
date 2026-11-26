---
name: static subtree cache sites
status: verified
path: compiler/internal/codegen/staticcache.go
language: go
summary: Detects maximal fully-static subtrees and emits them as per-owner build-once cache sites.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# staticcache.go

Build-once static subtrees ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]): a maximal
fully-static subtree of three or more vnodes is emitted as
`(this.__c[n] ??= …)` (or `s.c[n]` inside a row) and returned by reference, so the
patcher's identity short-circuit skips it.

- **Static** = static attributes (including `ref`, `key`, `island`, `flip`), D62
  cacheable handlers, literal text, static element children. A controlled form
  value, component, marker, snippet, portal or control flow makes it dynamic.
- A static `island`'s children are cached at any size; a dynamic island seed is
  never cached, because the cache is per instance while an island re-seeds on
  remount (D44) — a cached seed would show the first render's values forever.
- **Excluded bodies:** snippet bodies and non-lowered loop bodies (range loops,
  `.map` fallbacks) — they own no row scope, so one slot would be shared by every
  iteration.
