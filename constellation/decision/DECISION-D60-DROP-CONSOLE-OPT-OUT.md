---
name: 'D60 — build.dropConsole: production console-strip becomes opt-out'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D12-TAILWIND-FIRST
---

# D60 — build.dropConsole: production console-strip becomes opt-out

## Context

The round-1 correctness pass made production builds set esbuild
`Drop: api.DropConsole` unconditionally (~570 B gzip saved on examples/todos;
framework advisory warnings became dev-mode-only by design). A later external
review (Codex, 2026-07-14) flagged the sharp edge: esbuild's drop:console
removes the ENTIRE call expression, so a user app's `console.log(sideEffect())`
loses the side effect too — and the stripping applies to user code, not just
framework diagnostics, with no way out.

## Decision

`puzzle.config.js` gains a `build` block with one key:

```js
export default { build: { dropConsole: false } }
```

- Absent key / no config file → UNCHANGED default: production strips console
  (the size win and all existing apps keep their behavior).
- `dropConsole: false` → user console calls survive production builds.
- Dev builds never drop console, regardless of the setting.
- Non-boolean values are rejected at config load with a message naming
  `build.dropConsole` (same posture as the styles.use validation).

Config is loaded ONCE per `Build()` (hoisted out of runTailwind — one node
invocation per build), which as a side effect surfaces a malformed config
BEFORE the stale-dist prune instead of after.

## Alternatives

- **Flip the default to keep console** — rejected for now: silently changing
  every existing app's production output (and un-earning the measured size win)
  for a footgun that only bites side-effectful console arguments. Revisit at
  npm-publish time if user feedback warrants.
- **CLI flag (`puzzle build --keep-console`)** — rejected: this is app
  configuration, not a per-invocation choice; puzzle.config.js is the home for
  it (D12), and a flag would drift from CI scripts.
- **Remove stripping entirely** (Codex's proposal) — rejected: the framework's
  own warn-once diagnostics are deliberately dev-only, and the default is a
  real bundle-size win; an escape hatch answers the criticism without paying
  that cost.

## Consequences

- First occupant of the `build` block in puzzle.config.js — future build
  toggles have a home. Unknown keys inside `build` stay ignored (permissive,
  matching top-level posture).
- Apps that rely on production console output (client-side error reporting via
  console hooks, etc.) now have a sanctioned path.
- CLAUDE.md / card claims that "production drops console.* by design" must say
  "by default" — see the COMPONENT-ESBUILD-PLUGIN card notes.
