---
name: D110 — `dev.proxy` rejects a root prefix and duplicate routes at config load
status: verified
connections:
  - COMPONENT-DEV-SERVER
  - FILE-CONFIG
  - FILE-DEV-SERVER
  - FEATURE-DEV-PROXY
  - DECISION-D08-MINIMAL-CONFIG
verified_at: '2026-07-24T23:35:06.404Z'
verified_sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
notes:
  - kind: verified
    text: >-
      Verified at merged main: config.validate sorts prefixes, rejects a root proxy and a
      duplicate-after-trim route, and dev.handler() keeps the registered-set guard as defense in
      depth. Both suites green.
    sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
---

`dev.proxy` now rejects two prefix shapes at config load: `/` (the root proxy)
and two keys that name the same route after trailing-slash normalization. Both
were previously accepted — the first as a documented feature, the second by
crashing the dev server.

## Context

[[FEATURE-DEV-PROXY]] forwards matching request prefixes to a backend so an app
can use same-origin paths (`apiURL: ''`) in dev without CORS middleware. Two
prefix shapes were wrong in different ways:

**A duplicate route panicked.** `handler()` normalizes each key with
`strings.TrimRight(prefix, "/")`, so `'/api'` and `'/api/'` both become `/api`
and `mux.Handle("/api", …)` ran twice. `http.ServeMux` panics on a repeat
pattern, nothing on the `Serve` path recovers, and `puzzle dev` died with a Go
stack trace instead of a config error. `validate` accepted both keys — it only
checked the leading `/` and the target URL.

**A root proxy was accepted and documented.** `handler()` carried a deliberate
`rootProxied` flag: a `/` prefix registered the proxy and then SKIPPED the
static handler entirely, so the backend received every request — `index.html`,
`app.js`, `styles.css`, the live-reload stream. The dev server was left with
nothing of its own to serve while still rebuilding into a `dist/` nobody read.

## Decision

Both are config errors, named at load with the offending prefix.

- **Root proxy → rejected.** This is not a configuration of the feature; it is
  the absence of one. The feature's whole shape is "carve out the paths my
  backend owns, the dev server keeps the rest," and `/` inverts that. Nothing in
  the repo used it, no example exercised it, and any app that wrote it got a dev
  server serving someone else's `app.js`. The error names the prefix and points
  at `/api` as the shape the author meant.
- **Duplicate-after-normalization → rejected.** A trailing slash is not
  significant, so two keys naming one route are a mistake with no sensible
  resolution — picking one silently would be a guess. The message names both.

Validation lives in `config.validate` alongside the existing leading-slash and
target-URL checks, so all four `dev.proxy` rules fail the same way in the same
place. This means `puzzle build` also rejects a malformed `dev.proxy` even
though it ignores `dev.*` — matching how the pre-existing checks already behave.
A config file is valid or it is not; which command read it does not change that.

The `handler()` guards (`prefix == ""` → `/`, and a `registered` set skipping a
repeat pattern) STAY as defense in depth. `newServer` is constructible directly
in tests and `Serve` is fail-soft on a config error, so a proxy map the loader
never validated can still reach the mux — and a ServeMux panic there is
unrecoverable.

## Alternatives rejected

- **Normalize `/` into a working root proxy.** Preserves a configuration whose
  only outcome is a broken dev server. Silently making a mistake work is worse
  than naming it.
- **Reject `/` in the dev path instead of `validate`.** Would make it the only
  `dev.proxy` rule enforced somewhere other than the loader, and `Serve` is
  fail-soft on config errors — so it would degrade dev (dropping Tailwind too,
  via `tailwindEnabled := cfgErr == nil`) rather than halt it.
- **Deduplicate silently.** Sorted order makes it deterministic but arbitrary;
  the author still has a config that does not say what they think it says.

## Consequences

- Removes documented behavior. [[FEATURE-DEV-PROXY]]'s handler-chain prose
  previously described the `/` prefix as supported; it is now a config error.
  **This card originally claimed the change was unpublished and therefore free.
  That was wrong**: `0.2.0` went to npm on 2026-07-24 carrying the working
  `rootProxied` path, and this change landed later the same day. So a released
  consumer *can* have `dev.proxy: { '/': … }` in a working config, and for them
  `puzzle dev` — and `puzzle build`, since the rule lives in the loader — starts
  failing on upgrade. It is a genuine breaking change and belongs in the `0.3.0`
  release notes, not in a footnote. The decision itself stands: the only outcome
  that config ever produced was a dev server with nothing of its own to serve.
- A `/` or duplicate prefix now fails `puzzle build` as well. Consistent with
  the existing `dev.proxy` checks, but it does mean a dev-only key can fail a
  production build.
- Path rewriting, header injection, and prod proxying remain out of scope
  ([[DECISION-D08-MINIMAL-CONFIG]]).
