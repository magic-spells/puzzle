---
name: playground WASM compiler entry
status: verified
path: compiler/cmd/pzl-wasm/main.go
language: go
summary: >-
  js/wasm-only parser+codegen bridge exposed through global JavaScript functions, with the pinned
  worker protocol and its input guards.
connections:
  - COMPONENT-PLAYGROUND-COMPILER
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/pzl-wasm/main.go`.

The file's package comment is the normative text for two contracts nothing else states: the Phase 2 worker request/response envelope, and the failure model (recover, the source-size and nesting guards, and the wrapper's duty to respawn a dead instance).
