---
name: "D14 — The v1 milestone is the todos app, end-to-end"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - TEST-TODOS-INTEGRATION
  - DOC-BUILD-PLAN
  - DOC-SPEC
---

# D14 — The v1 milestone is the todos app, end-to-end

Settled (SPEC preamble; build plan). Every scope decision is tested against one question: does the todos example compile and run?

## Context
v1 scope needed a single concrete yardstick to decide what ships and what defers.

## Decision
- Every scope decision is tested against one question: does the todos example compile and run?
- Features not needed for that are deferred (see [[DOC-SPEC]] "Deferred features").
- Phase ordering follows from it: runtime kernel first (proven via a hand-written compiled fixture of `Home.pzl`), compiler second (its correct output is defined by that fixture), dev tooling third.
