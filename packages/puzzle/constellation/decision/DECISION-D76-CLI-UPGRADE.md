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
  - kind: gotcha
    text: >-
      Two traps in the detached refresh, both discovered building it. (1) `os.Executable()` inside a
      Go test is the TEST binary, so a self-re-exec cannot be tested without a seam —
      `executablePath` and `spawnRefresh` in internal/update/spawn.go exist for that, and the
      fork-for-real test re-executes the test binary in a TestMain branch to get a parent that dies
      immediately. (2) The helper resolves its cache through `os.UserCacheDir()`, which reads the
      environment, so the only way to keep a genuinely forked helper out of the developer's own
      ~/Library/Caches/puzzle is to hand the child a fake HOME/XDG_CACHE_HOME/LocalAppData.
      `update.CacheDir` is a package var and does NOT reach a child process.
  - kind: decision
    text: >-
      2026-09-09 — Cory chose "check in the background, print next run" over the 500 ms synchronous
      wait. Two attempts at making the notice same-run had shipped on this branch that day (a 6h TTL
      with a bounded foreground fetch, then a 15-minute failure backoff to bound its worst case);
      both were reverted in favor of never waiting at all. The reasoning: a courtesy line must not
      be on the critical path of `puzzle build`, and any cap is a number with no defensible value
      once the build itself is ~70 ms. The design that replaced them keeps the fire-and-forget shape
      the notice always had and fixes its one real defect — a goroutine cannot outlive `build` — by
      making the refresh a detached `puzzle update-check` process instead. TTL 1h (a refresh is now
      free, so it can be frequent), the failure backoff kept, cache writes made atomic because two
      parallel builds each spawn a helper. Accepted cost, stated plainly: the notice for a brand-new
      release arrives one run late.
  - kind: gotcha
    text: >-
      Two MORE traps in the detached refresh, these invisible until CI runs it. (1) `Refresh()`
      honors CI / PUZZLE_NO_UPDATE_CHECK by design — the subcommand is reachable from a shell — and
      GitHub Actions exports `CI=true`, so any test that calls `Refresh()` and then reads the cache
      passes locally and fails on every runner: the helper correctly no-ops and the test reads a file
      nothing was ever going to write. Tests of the BODY must clear both gates first
      (`ungateRefresh` in update_test.go); `TestRefreshHonorsGates` clears both and then sets one,
      because otherwise the PUZZLE_NO_UPDATE_CHECK subtest passes on the ambient CI gate and proves
      nothing. Reproduce with `CI=true go test ./internal/update/...`. (2) The atomic temp+rename
      write is not atomic-and-always-successful on Windows: replacing a file another process holds
      open is a sharing violation, not the silent success unix gives, so the concurrent-writers test
      failed on windows-latest only. `renameWithRetry` (5 attempts, 20 ms apart) absorbs it — nothing
      waits on the write, so the 80 ms worst case is spent inside the detached helper. The matching
      test rule: only bytes that were successfully READ and do not parse are a torn read; an open
      that fails is the race, not the bug.
    sha: a793214ac3a76b0b9f06099da8636e493fac48ca
code_refs:
  - compiler/cmd/puzzle/main.go
  - compiler/cmd/puzzle/updatecheck.go
  - compiler/cmd/puzzle/upgrade.go
  - compiler/internal/dev/dev.go
  - compiler/internal/update/update.go
  - compiler/internal/update/spawn.go
---

# D76 — Update notification + `puzzle upgrade` (v1.43)

`puzzle build` and `puzzle dev` print a one-line, cache-backed notice when a newer release is published, and `puzzle upgrade` performs the upgrade by driving the user's own package manager. See [[DOC-SPEC-BUILD]] §41 for the full contract.

## Context

The CLI ships as a Go binary inside npm platform packages (§35): users install `@magic-spells/puzzle` once and have no reason to ever look at the registry again. Nothing told them a new release existed, and "how do I update?" has a non-obvious answer that depends on how they installed (project dep vs global, npm vs pnpm/yarn/bun, `go install` fallback). Both problems predate the first public release — better to ship the answer with 0.1.0 than to teach it in an FAQ.

## Decision

**Notify from cache without ever waiting, refresh in the background, upgrade explicitly and let the package manager do the installing.**

- **The passive check never touches the network on the command's own time.** `CheckPassive` reads the cache file and returns; the notice prints from whatever answer is recorded, or prints nothing. There is no timeout to tune and no bound to argue about, because there is nothing to wait for — a build costs exactly one small file read whatever the registry is doing.
- **A recorded answer older than one hour starts a detached refresh for the next run.** The TTL is short precisely because it is free: it decides only how many runs a newly published release stays unmentioned, never how long a command takes. The notice for a fresh release therefore appears on the run *after* the refresh lands — one run late by design.
- **The refresh is a separate process, not a goroutine.** `puzzle build` prints the notice as its last statement and exits in milliseconds; an in-process refresh dies with it, which is why the original background design never actually updated anything for `build` users. The CLI re-execs itself as `puzzle update-check` — a `Hidden: true` cobra subcommand that fetches with a 3 s budget, writes the cache or the failure stamp, prints nothing and exits 0 — started with `os.Executable()`, null standard streams, its own session (`Setsid`) or `DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP` on Windows, `Start()` + `Process.Release()` and never `Wait`. A spawn that fails is silent.
- **`dev` and `build` use the same mechanism.** A long-running `dev` *could* refresh in-process, but two paths would mean two behaviors to reason about and only one of them exercised by the fast test. One mechanism, one code path, one set of tests; the helper works everywhere, so uniformity is free. `dev` still prints from `OnReady`, after the ready banner.
- **A failed refresh backs off for 15 minutes.** The helper stamps `failed_at` into the cache file, leaving `latest`/`checked_at` alone, and while `now < failed_at + 15m` no helper is spawned at all; any success clears the stamp. Without it a failed fetch — which writes no `checked_at` — would leave the cache permanently stale and spawn a doomed process on every single command. With it an unreachable registry costs four short-lived processes an hour.
- **Cache writes are atomic** (temp file in the same directory, then rename). Two builds started at once each spawn a helper, so concurrent writers are the normal case; a reader must never catch a half-written file and conclude the cache is corrupt. Duplicating the helper is cheap — it is one GET — so nothing coordinates or locks.
- The gates (`CI`, `PUZZLE_NO_UPDATE_CHECK`, non-TTY stdout) are still evaluated in `printUpdateNotice` before anything else, so a gated invocation neither reads nor spawns. The helper re-evaluates `CI`/`PUZZLE_NO_UPDATE_CHECK` itself, because the subcommand is reachable from a shell.
- `puzzle upgrade` never touches its own files. It detects the install context and shells out to the exact command a careful user would have typed. package.json, the lockfile, and the exact-pinned platform binary packages therefore stay consistent by construction. It fetches synchronously with its own 5 s budget — there a failure *is* an error, unlike the passive path.
- **The install context is a property of the running executable, not of the current directory.** `puzzle upgrade` upgrades the CLI you invoked — resolved from `os.Executable()` — and nothing else. A project you happen to be standing in is never upgraded as a side effect; bumping a project's dependency is `npm install`'s job, and the CLI does not duplicate it. See [[DOC-SPEC-BUILD]] §41 for the resolution rules (pnpm-global, project, global, manual).
- The result is verified, not assumed: the installed package's version must equal the fetched target or the command fails. Because the checked, upgraded, and reported install are the same one, that confirmation is meaningful — it cannot pass by reading a package the command never wrote.

## Alternatives rejected

- **A bounded synchronous fetch before printing** (a 500 ms cap on a cold or stale cache, falling back to a background refresh past the cap): the direct attempt at "tell me about the release on the run that asks". It was tried, and it is the wrong trade. It makes `build` — the command in every CI-adjacent script and every watch loop — pay registry latency for a courtesy line nothing depends on, and the cap is a number with no good value: low enough to be invisible and it rarely beats the network, high enough to usually succeed and half a second is on the critical path of a 70 ms build. Worse, the failure modes are the ones that hurt most: a captive-portal or blackholing network burns the entire cap on every miss, and the fallback that was supposed to rescue the case never lands for a process that exits immediately after. The 15-minute failure backoff bounded the damage but did not change the shape of it. Refreshing out of band removes the question entirely — there is no cap to tune when nothing waits.
- **An unbounded blocking version check on every run**: adds full registry latency to every build and fails ugly offline. Rejected for the same reason as the bounded version, only more so.
- **A goroutine for the background refresh, as the notice originally shipped**: correct for `dev`, useless for `build` — the process exits long before the request completes, so `build` users' caches only ever advanced when they happened to run `dev`. That is what made the notice arrive two conditions late and prompted the whole revision. The detached helper is that same fire-and-forget design with the one flaw fixed.
- **Keeping the goroutine for `dev` and the helper for `build`**: two mechanisms for one behavior, with the goroutine path exercised only by whoever leaves a dev server running. The helper works in a long-lived process too, so there is nothing to buy.
- **A 24-hour TTL** (the original): sensible when a refresh was something to be economical with. Now that a refresh costs the command nothing, an hour is affordable and cuts the "release published, still unmentioned" window by a factor of 24.
- **A lock or single-flight around the refresh** so two parallel builds cannot both spawn one: the thing being guarded is a single small GET and a rename. The lock would be more code, more failure modes and more state on disk than the duplication it prevents; an atomic cache write is the whole of what concurrency actually requires here.
- **Self-replacing binary download** (rustup/deno-style): desyncs npm's ledger — package.json and the lockfile would still pin the old version, and the next `npm install` would silently roll the binary back. Wrong ownership model for an npm-distributed tool.
- **Deriving the install context from cwd** (walk up to the first `package.json` listing the package): plausible, since inside a Puzzle project the CLI usually *is* the project's local one — but only usually. Type `puzzle` in a project and hit a global shim and the two diverge: the command compares the global binary's version against the registry, runs the package manager against the project, and confirms success by reading the project's package.json. It can then report an upgrade for a package it never wrote, while the CLI that was actually stale stays stale and re-offers the same upgrade forever. Keying off the executable makes that class of mismatch unrepresentable.
- **Upgrading both the CLI and the surrounding project's dependency**: two installs with independent lifecycles and one confirmation step between them. The project dependency is npm's to manage.
- **Update logic in the `bin/puzzle.js` shim**: keeps the Go binary pure, but the shim is deliberately a dumb forwarder (§35) and Node-side logic there would run on every invocation for every user, TTY or not.
- **A `latest` dist-tag install** instead of the exact fetched version: races the registry between check and install; the exact version makes the confirmation step meaningful.

## Consequences

Purely additive CLI surface; runtime, compiler, and template grammar are untouched. `compiler/internal/update` holds the registry fetch, the 1h cache (atomic temp-file + rename writes, a 15-minute failure backoff), the detached-spawn seam (`spawn.go` plus build-tagged `spawn_unix.go` / `spawn_windows.go`), and the minimal semver — stdlib only, no new Go dependencies. `compiler/cmd/puzzle/updatecheck.go` registers the hidden `update-check` subcommand; `compiler/cmd/puzzle/upgrade.go` holds context detection, package-manager exec and confirmation; `dev.Options.OnReady` lands the notice after the ready banner; `ui.IsTerminal` gates it.

The visible cost is that the notice is one run late — a release published in the last hour is announced by the run after the one that noticed. That is the trade taken deliberately: no `puzzle build` anywhere ever waits on the registry, and there is no timeout on the passive path to tune, breach, or explain. The visible artifact is a second short-lived `puzzle` process appearing for a fraction of a second every hour or so; it is detached and null-streamed, so it cannot write over a prompt or be killed by a Ctrl-C aimed at the build.

The passive path is still the CLI's only unprompted network call — gated to interactive TTY sessions and disableable — and the gates are evaluated before `CheckPassive`, so a gated invocation neither reads the cache nor spawns anything. The helper re-checks `CI`/`PUZZLE_NO_UPDATE_CHECK` itself, since the subcommand is reachable from a shell, and refuses to spawn a helper of its own.

Tests cover semver ordering; cache staleness against the 1h TTL; the fresh-cache path making no request and no spawn; a stale cache spawning exactly one refresh, returning in microseconds and leaving the cache untouched; an absent cache spawning one refresh and answering nothing; the backoff window suppressing the spawn and an expired window restoring it; the helper body against an httptest registry (success writes the cache and clears `failed_at`, failure stamps `failed_at` and leaves `latest`/`checked_at` alone, either gate makes it a no-op); an old-format file without `failed_at` still loading; concurrent writers never producing a torn read or a stray temp file; registry fetch via `PUZZLE_REGISTRY`; lockfile/dep-field detection over fixture trees; and end-to-end upgrades against stub `npm`/`pnpm` binaries on PATH. One test forks for real: it builds the CLI, has a process spawn the helper and exit at once, and watches the cache file appear afterwards — the only check that would catch a detach that silently kills the child with its parent.
