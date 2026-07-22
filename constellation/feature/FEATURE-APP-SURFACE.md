---
name: App-level surface (settings, computed, global events, lifecycle hooks, event bus, utils, devtools)
status: verified
connections:
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D66-APP-LIFECYCLE-HOOKS
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
verified_at: '2026-07-14T17:04:48.129Z'
verified_sha: 1600ce7f34f7a486f9fdb2d4b20c5d986f70a48c
notes:
  - kind: verified
    text: >-
      Umbrella resolved at 1600ce7 by the D66 triage: app lifecycle hooks admitted and shipped as
      v1.31 (SPEC §34); settings/computed/methods, global keyboard events, $events, ctx.utils,
      devtools re-rejected with rationale in the DECISION card. Last planned feature card — backlog
      empty.
    sha: 1600ce7f34f7a486f9fdb2d4b20c5d986f70a48c
---

# App-level surface

**Resolved by the D66 triage (v1.31).** This umbrella card grouped the deferred
app-level features from the SPEC cut list because they all amend the same two
frozen surfaces ([[DECISION-D08-MINIMAL-CONFIG]]'s config object and the
3-service `this.ctx`). Its stated first job was triage — pick the members with
proven demand, re-reject the rest — and that triage is now done:

- **Admitted & shipped: app lifecycle hooks** — `beforeMount(app)` (awaited,
  pre-navigation-#0 — the sanctioned home for store seeding), `mounted(app)`,
  and `beforeUnmount(app)` as optional config fields. See
  [[DECISION-D66-APP-LIFECYCLE-HOOKS]] and [[DOC-SPEC]] §34. Demand evidence:
  ten examples used `app.mount().then(seed)` (first `data()` saw an empty
  store), and music hand-rolled a `seedReady` promise awaited by six views —
  both idioms retired in the v1.31 sweep.
- **Re-rejected: everything else** — app-level `settings`/`computed`/`methods`
  (module constants / singleton store records cover), global `events` incl.
  keyboard-shortcut strings (all observed key handling is correctly
  view-scoped; D38 covers in-template), the `$events` bus (the music app
  proves singleton store records ARE the bus — the card's open question,
  answered), `ctx.utils` (the 3-service ctx is a selling point), and the
  devtools hook (`window.__PUZZLE_APP__` covers dev introspection, D57).
  Full rationale in the D60 card. Reopen any member only with a real consumer.

## Original intent (kept for the record)

Cross-cutting app concerns (a global keyboard shortcut, an app-ready hook,
cross-view signaling without a store record) had no sanctioned home; each
admission was to be weighed against D8's minimalism principle — a feature, not
an accident. The hooks admission holds that line: three optional functions on
the existing config literal, no new services, ctx untouched.
