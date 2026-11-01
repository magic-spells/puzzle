---
name: literal date-argument check
status: verified
path: compiler/internal/codegen/presets.go
language: go
summary: >-
  Positioned compile warning for a string-literal date/time/datetime preset the library does not
  know, or a string-literal in_timezone zone that cannot be a zone id.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D174-FUNCTION-LIBRARY
  - TEST-COMPILER-CODEGEN
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# presets.go

`checkLiteralArgs` (called from `markup.go`): a positioned compile **warning** for a
string-literal argument the date functions cannot honor
([[DECISION-D174-FUNCTION-LIBRARY]]) — an unknown `date`/`time`/`datetime` preset
(it names `short`, `medium`, `long`, `iso`), a retired preset name such as
`date(v, 'time')` (steers to `time(v)`), or an `in_timezone` zone that cannot be an
IANA name or UTC offset.

Why it exists: at run time an unknown preset silently renders the default and an
unknown zone renders unshifted, so `time(v, 'shrot')` would ship unnoticed. It is a
warning, not an error, because an app may register its own function under any of
those names. A dynamic argument stays the runtime's development error.
`presets_test.go` covers every position the language reaches, handler arguments
included.
