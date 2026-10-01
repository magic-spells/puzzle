---
name: D76 — Update notification + puzzle upgrade
status: verified
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - TEST-CLI-COMMANDS
verified_at: '2026-08-24T18:51:21.850Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
code_refs:
  - compiler/cmd/puzzle/main.go
  - compiler/cmd/puzzle/updatecheck.go
  - compiler/cmd/puzzle/upgrade.go
  - compiler/internal/dev/dev.go
  - compiler/internal/update/update.go
  - compiler/internal/update/spawn.go
---

# D76 — Update notification + `puzzle upgrade`

`puzzle build` and `puzzle dev` print a one-line, cache-backed notice when a
newer release exists; `puzzle upgrade` upgrades by driving the user's own
package manager. Full contract: [[DOC-SPEC-BUILD]] §41.

## Decision

**Notify from cache without ever waiting; refresh in a detached process;
upgrade explicitly through the package manager.**

- **Passive check** (`CheckPassive`): read the cache file and print from it, or
  print nothing. Never touches the network on the command's time. Gates — `CI`,
  `PUZZLE_NO_UPDATE_CHECK`, non-TTY stdout — are evaluated first in
  `printUpdateNotice`, so a gated run neither reads nor spawns. `dev` prints from
  `OnReady`, after the banner.
- **Refresh:** a cache older than 1h spawns a detached `puzzle update-check`
  (hidden cobra subcommand; 3s fetch; writes the cache or a `failed_at` stamp;
  prints nothing; exits 0). Spawned via `os.Executable()` with null streams, its
  own session (`Setsid`, or `DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP` on
  Windows), `Start()` plus a reaper goroutine calling `Wait()` (otherwise
  long-lived `dev` accumulates zombies). Spawn failures are silent. `build` and
  `dev` share this one mechanism. The notice for a new release is therefore one
  run late — accepted.
- **Failure backoff:** while `now < failed_at + 15m` nothing spawns; a success
  clears the stamp. Without it, an unreachable registry would spawn a doomed
  helper every command.
- **Atomic cache writes** (temp file + rename; `renameWithRetry` absorbs the
  Windows sharing violation). Parallel builds each spawn a helper by design — no
  lock.
- The helper re-checks `CI`/`PUZZLE_NO_UPDATE_CHECK` itself (it is reachable
  from a shell) and never spawns a helper of its own.
- **`puzzle upgrade`** fetches synchronously (5s; failure is an error), then
  shells out to the exact command a careful user would type, so `package.json`,
  the lockfile and the exact-pinned platform packages stay consistent. The
  install context comes from **the running executable**, never the cwd — the CLI
  you invoked is the one upgraded; a surrounding project is never touched.
  Success is verified: the installed version must equal the fetched target.

## Alternatives

- **Bounded synchronous fetch (e.g. 500ms) before printing** — tried and
  reverted: puts registry latency on the critical path of a ~70ms build for a
  courtesy line, and the cap has no defensible value.
- **Goroutine refresh** — dies with `build` before the request completes.
- **Lock/single-flight around the refresh** — more code and state than the
  duplicate GET it prevents.
- **Self-replacing binary download** (rustup-style) — desyncs npm's ledger; the
  next `npm install` rolls it back.
- **Context from cwd** — a global shim run inside a project would upgrade the
  project and report success while the invoked CLI stayed stale.
- **Logic in the `bin/puzzle.js` shim** — the shim stays a dumb forwarder.
- **Installing the `latest` dist-tag** — races the registry; the exact version
  makes verification meaningful.

## Gotchas

- **Registry Accept header:** `FetchLatest` requests
  `<registry>/@magic-spells/puzzle/latest` with `Accept: application/json`. npm
  serves the abbreviated `application/vnd.npm.install-v1+json` only for
  packuments and answers **406** on version endpoints — that header once broke
  every check silently (the passive path swallows errors). The test registry
  406s install-v1 on version endpoints; still verify fetch changes against
  `registry.npmjs.org` itself, not only the httptest double.
- Platform package names use Node's spelling, not Go's: `windows` → `win32`,
  `amd64` → `x64` (`platformPackageNameFor`), and the binary is `puzzle.exe` on
  Windows (`platformBinaryNameFor`). On Windows the
  `node_modules/.bin/puzzle` fallback is a shell script and is skipped; the
  hoisted platform binary is tried first.
- In Go tests `os.Executable()` is the test binary; `executablePath` and
  `spawnRefresh` (`internal/update/spawn.go`) are the seams, and the fork-for-real
  test re-execs the test binary via a TestMain branch.
- A forked helper resolves its cache via `os.UserCacheDir()` from the
  environment — give it a fake HOME/XDG_CACHE_HOME/LocalAppData; the
  `update.CacheDir` package var does not reach a child.
- `Refresh()` honors `CI`, and GitHub Actions sets `CI=true`: tests of the body
  must clear both gates (`ungateRefresh`). Reproduce with
  `CI=true go test ./internal/update/...`.
- In concurrent-writer tests, only bytes that were read and fail to parse are a
  torn read; a failed open is the Windows race, not the bug.
