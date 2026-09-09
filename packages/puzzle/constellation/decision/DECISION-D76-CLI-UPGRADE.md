---
name: 'D76 — Update notification + `puzzle upgrade` (v1.43)'
status: verified
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - FEATURE-V1-32-RELEASE-HARDENING
verified_at: '2026-08-24T18:51:21.850Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
notes:
  - kind: verified
    text: >-
      Executable-derived install context is now implemented as the card describes (it had been
      documented-but-cwd-first); verified at the release/0.7.0 merge — detection table,
      chdir-inertness, and global-from-inside-a-project stub tests all green.
    sha: c4e46b0daf84d3c06f8008d0bf9f823ec6f855cb
  - kind: verified
    text: Claims re-verified against the current Go compiler code; no drift found.
    sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
  - kind: gotcha
    text: >-
      The post-upgrade "find the binary npm just installed" step derives the platform package name
      in Go, and Node's spelling is not Go's: `runtime.GOOS` is `windows` where the package is
      `puzzle-win32-x64`, and `runtime.GOARCH` is `amd64` where the package is `-x64`. Both are
      translated in `platformPackageName()` (cmd/puzzle/upgrade.go). The arch half was handled from
      the start; the OS half only mattered once Windows binaries shipped in 0.7.0, and it was wrong
      until then. The file inside `bin/` differs too — `puzzle.exe` on Windows — hence
      `platformBinaryName()`. Still unhandled on Windows: the `node_modules/.bin/puzzle` fallback
      candidate is a shell script npm pairs with a `.cmd`, so exec'ing it fails and the candidate is
      simply skipped; the hoisted platform binary is tried first, so the common layouts still work.
  - kind: decision
    text: >-
      2026-09-09 — the passive notice was amended from cache-only to same-run. The original design
      shipped 0.1.0 as pure update-notifier: print from cache, refresh in the background for next
      time. In practice that meant a user only ever heard about a release after the 24h TTL expired
      AND they ran a command twice, which is not a notification. Now the TTL is 6h and a cold or
      stale cache is refreshed in the foreground under a 500 ms cap before printing; over the cap or
      on any error the old fire-and-forget refresh takes over and the stale answer returns
      immediately, so no command can be delayed further than the cap. The gates (CI /
      PUZZLE_NO_UPDATE_CHECK / non-TTY stdout) are unchanged and still evaluated before anything
      reaches the registry, and `puzzle upgrade` — which calls FetchLatest/WriteCache directly with
      its own 5s budget — is untouched.
code_refs:
  - compiler/cmd/puzzle/main.go
  - compiler/cmd/puzzle/upgrade.go
  - compiler/internal/dev/dev.go
  - compiler/internal/update/update.go
---

# D76 — Update notification + `puzzle upgrade` (v1.43)

`puzzle build` and `puzzle dev` print a one-line, cache-backed notice when a newer release is published, and `puzzle upgrade` performs the upgrade by driving the user's own package manager. See [[DOC-SPEC-BUILD]] §41 for the full contract.

## Context

The CLI ships as a Go binary inside npm platform packages (§35): users install `@magic-spells/puzzle` once and have no reason to ever look at the registry again. Nothing told them a new release existed, and "how do I update?" has a non-obvious answer that depends on how they installed (project dep vs global, npm vs pnpm/yarn/bun, `go install` fallback). Both problems predate the first public release — better to ship the answer with 0.1.0 than to teach it in an FAQ.

## Decision

**Notify on the run that asks, upgrade explicitly, and let the package manager do the installing.**

- The passive check is cache-backed but not cache-only. A cache younger than **6 hours** answers by itself — the common case, and free. When it is missing or stale the CLI fetches in the **foreground under a 500 ms cap**, writes the cache, and prints the notice **in the same run**, so a release published since the last check is seen the first time the user runs `puzzle dev` rather than on some later invocation. Past the cap — or on any error — the fire-and-forget refresh (3 s) takes over for a later run and the command answers from whatever the stale cache held. A slow or unreachable registry therefore costs half a second at most, offline use stays silent, and CI / piped output / `PUZZLE_NO_UPDATE_CHECK=1` still skip the whole path including the fetch.
- The cap is safe where the notice is printed. `puzzle build` prints it after the summary, immediately before exit. `puzzle dev` prints it from `OnReady`, which fires *after* the ready banner and with the listener already accepting in its own goroutine — the bounded fetch delays neither the banner nor the first request.
- `puzzle upgrade` never touches its own files. It detects the install context and shells out to the exact command a careful user would have typed. package.json, the lockfile, and the exact-pinned platform binary packages therefore stay consistent by construction.
- **The install context is a property of the running executable, not of the current directory.** `puzzle upgrade` upgrades the CLI you invoked — resolved from `os.Executable()` — and nothing else. A project you happen to be standing in is never upgraded as a side effect; bumping a project's dependency is `npm install`'s job, and the CLI does not duplicate it. See [[DOC-SPEC-BUILD]] §41 for the resolution rules (pnpm-global, project, global, manual).
- The result is verified, not assumed: the installed package's version must equal the fetched target or the command fails. Because the checked, upgraded, and reported install are the same one, that confirmation is meaningful — it cannot pass by reading a package the command never wrote.

## Alternatives rejected

- **Self-replacing binary download** (rustup/deno-style): desyncs npm's ledger — package.json and the lockfile would still pin the old version, and the next `npm install` would silently roll the binary back. Wrong ownership model for an npm-distributed tool.
- **Deriving the install context from cwd** (walk up to the first `package.json` listing the package): plausible, since inside a Puzzle project the CLI usually *is* the project's local one — but only usually. Type `puzzle` in a project and hit a global shim and the two diverge: the command compares the global binary's version against the registry, runs the package manager against the project, and confirms success by reading the project's package.json. It can then report an upgrade for a package it never wrote, while the CLI that was actually stale stays stale and re-offers the same upgrade forever. Keying off the executable makes that class of mismatch unrepresentable.
- **Upgrading both the CLI and the surrounding project's dependency**: two installs with independent lifecycles and one confirmation step between them. The project dependency is npm's to manage.
- **Update logic in the `bin/puzzle.js` shim**: keeps the Go binary pure, but the shim is deliberately a dumb forwarder (§35) and Node-side logic there would run on every invocation for every user, TTY or not.
- **A purely passive, cache-only notice** (the original update-notifier pattern): the notice prints only from cache and a stale cache refreshes in the background for *next* time. Nothing ever waits on the network, which is the appeal — but it makes the notice arrive two conditions late. After a release a user had to wait out the TTL *and then run the command twice* before anything was said, and a `puzzle dev` left running for days never re-checked at all. The point of the notice is to be seen; a bounded foreground fetch buys that for a worst case of 500 ms on the ~one run in six hours that misses the cache, with the fire-and-forget refresh still there as the fallback whenever the cap is hit.
- **An unbounded blocking version check on every run**: adds full registry latency to every build and fails ugly offline. The cap plus the 6h cache keeps the cost bounded and rare instead.
- **A `latest` dist-tag install** instead of the exact fetched version: races the registry between check and install; the exact version makes the confirmation step meaningful.

## Consequences

Purely additive CLI surface; runtime, compiler, and template grammar are untouched. New `compiler/internal/update` package (registry fetch, a 6h cache with a bounded foreground refresh and an async fallback, minimal semver — stdlib only, no new Go dependencies); `compiler/cmd/puzzle/upgrade.go` (context detection, package-manager exec, confirmation); an `OnReady` hook on `dev.Options` so the notice lands after the ready banner; `ui.IsTerminal` helper. The passive path is the CLI's only unprompted network call — gated to interactive TTY sessions and disableable, which is the privacy/CI posture the notice ships with; the gates are evaluated before `CheckPassive`, so a gated invocation still touches nothing. Tests cover semver ordering, cache staleness, the fresh-cache path making no request at all, the stale-cache same-run refresh, the over-the-cap fallback (bounded elapsed time plus an eventual async cache write), registry fetch (httptest via `PUZZLE_REGISTRY`), lockfile/dep-field detection over fixture trees, and end-to-end upgrades against stub `npm`/`pnpm` binaries on PATH.
