---
name: literal date-argument check
status: built
path: compiler/internal/codegen/presets.go
language: go
summary: >-
  Positioned compile warning for a string-literal date/time/datetime preset the library does not
  know, or a string-literal in_timezone zone that cannot be a zone id.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D174-STANDARD-FORMATTERS
  - TEST-COMPILER-CODEGEN
---

Source binding for the owning component card. Behavioral intent stays in [[COMPONENT-CODEGEN]] and [[DECISION-D174-STANDARD-FORMATTERS]] (dates: an unknown preset); this card anchors that plan to `compiler/internal/codegen/presets.go`.

At run time an unknown preset renders the function's default and an unknown zone renders the date unshifted, so a typo such as `time(v, 'shrot')` would ship unnoticed. When the argument is a string literal the compiler knows the answer: `checkLiteralArgs` reports a positioned compile **warning** that names the valid presets (`short`, `medium`, `long`, `iso`), says to call `time(value)` for a retired preset name such as `date(v, 'time')`, or rejects a zone that cannot be an IANA name or a UTC offset (a space, an empty string, a leading digit). It is a warning, not an error, because an app may register its own function under any of those names. A dynamic argument stays the runtime's development error. `presets_test.go` covers every position the language reaches, handler arguments included.
