---
name: 'D76 — Update notification + `puzzle upgrade` (v1.43)'
status: built
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
  - FEATURE-V1-32-RELEASE-HARDENING
---

# D76 — Update notification + `puzzle upgrade` (v1.43)

`puzzle build` and `puzzle dev` print a one-line, cache-backed notice when a newer release is published, and `puzzle upgrade` performs the upgrade by driving the user's own package manager. See [[DOC-SPEC]] §41 for the full contract.

## Context

The CLI ships as a Go binary inside npm platform packages (§35): users install `@magic-spells/puzzle` once and have no reason to ever look at the registry again. Nothing told them a new release existed, and "how do I update?" has a non-obvious answer that depends on how they installed (project dep vs global, npm vs pnpm/yarn/bun, `go install` fallback). Both problems predate the first public release — better to ship the answer with 0.1.0 than to teach it in an FAQ.

## Decision

**Notify passively, upgrade explicitly, and let the package manager do the installing.**

- The passive check is cache-first (update-notifier pattern): the notice always prints from the local cache, and a stale cache refreshes in a fire-and-forget goroutine. No command ever waits on the network, offline use is silent, and CI / piped output / `PUZZLE_NO_UPDATE_CHECK=1` skip the whole path including the fetch.
- `puzzle upgrade` never touches its own files. It detects the install context (project → lockfile-detected package manager with the dependency field preserved; global → `npm -g`/`pnpm -g`; otherwise `go install` instructions) and shells out to the exact command a careful user would have typed. package.json, the lockfile, and the exact-pinned platform binary packages therefore stay consistent by construction.
- The result is verified, not assumed: the installed package's version must equal the fetched target or the command fails.

## Alternatives rejected

- **Self-replacing binary download** (rustup/deno-style): desyncs npm's ledger — package.json and the lockfile would still pin the old version, and the next `npm install` would silently roll the binary back. Wrong ownership model for an npm-distributed tool.
- **Update logic in the `bin/puzzle.js` shim**: keeps the Go binary pure, but the shim is deliberately a dumb forwarder (§35) and Node-side logic there would run on every invocation for every user, TTY or not.
- **Blocking version check on every run**: adds registry latency to every build and fails ugly offline. The cache-first pattern costs at most one stale day.
- **A `latest` dist-tag install** instead of the exact fetched version: races the registry between check and install; the exact version makes the confirmation step meaningful.

## Consequences

Purely additive CLI surface; runtime, compiler, and template grammar are untouched. New `compiler/internal/update` package (registry fetch, 24h cache, minimal semver — stdlib only, no new Go dependencies); `compiler/cmd/puzzle/upgrade.go` (context detection, package-manager exec, confirmation); an `OnReady` hook on `dev.Options` so the notice lands after the ready banner; `ui.IsTerminal` helper. The passive path is the CLI's first background network call — gated to interactive TTY sessions and disableable, which is the privacy/CI posture the notice ships with. Tests cover semver ordering, cache staleness, registry fetch (httptest via `PUZZLE_REGISTRY`), lockfile/dep-field detection over fixture trees, and end-to-end upgrades against stub `npm`/`pnpm` binaries on PATH.
