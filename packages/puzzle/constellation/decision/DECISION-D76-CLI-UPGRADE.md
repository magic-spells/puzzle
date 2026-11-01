---
name: D76 — Update notification + puzzle upgrade
status: verified
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - TEST-CLI-COMMANDS
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - compiler/cmd/puzzle/main.go
  - compiler/cmd/puzzle/updatecheck.go
  - compiler/cmd/puzzle/upgrade.go
  - compiler/internal/dev/dev.go
  - compiler/internal/update/update.go
  - compiler/internal/update/spawn.go
---

# D76 — Update notification + `puzzle upgrade`

`puzzle build` and `puzzle dev` print a one-line, cache-backed notice when a newer release exists; `puzzle upgrade` upgrades by driving the user's own package manager. Full contract: [[DOC-SPEC-BUILD]] §41.

## Decision

**Notify from cache without ever waiting; refresh in a detached process; upgrade explicitly through the package manager.**

- **Passive check** (`update.CheckPassive`): read the cache file and print from it, or print nothing — never touches the network on the command's time. `printUpdateNotice` (`cmd/puzzle/main.go`) evaluates the gates first — `CI`, `PUZZLE_NO_UPDATE_CHECK`, non-TTY stdout — so a gated run neither reads nor spawns. `build` prints after its summary (`build -q` drops the notice); `dev` prints from `OnReady`, after the banner.
- **Refresh:** a cache older than 1h spawns a detached `puzzle update-check` (hidden subcommand; 3s fetch; writes the cache or a `failed_at` stamp; prints nothing; exits 0). Spawned via `os.Executable()` with null streams in its own session (`Setsid`, or `DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP` on Windows), `Start()` plus a reaper goroutine calling `Wait()` (otherwise long-lived `dev` accumulates zombies). Spawn failures are silent. The notice for a new release is therefore one run late — accepted.
- **Failure backoff:** while `now < failed_at + 15m` nothing spawns; a success clears the stamp. Without it an unreachable registry would spawn a doomed helper on every command.
- **Atomic cache writes** (temp file + rename; `renameWithRetry` absorbs the Windows sharing violation). Parallel builds each spawn a helper by design — no lock.
- The helper re-checks `CI`/`PUZZLE_NO_UPDATE_CHECK` itself (it is reachable from a shell) and never spawns a helper of its own.
- **`puzzle upgrade`** fetches synchronously (5s; failure is an error), then shells out to the exact command a careful user would type, so `package.json`, the lockfile and the exact-pinned platform packages stay consistent. The install context comes from **the running executable**, never the cwd — the CLI you invoked is the one upgraded. Success is verified: the installed version must equal the fetched target. `--check` reports without upgrading; `--yes` accepts the follow-up skill refresh (D78).

## Alternatives rejected


- **Bounded synchronous fetch before printing** — puts registry latency on the critical path of a fast build for a courtesy line; no cap value is defensible.
- **Goroutine refresh** — dies with `build` before the request completes.
- **Lock/single-flight around the refresh** — more code and state than the duplicate GET it prevents.
- **Self-replacing binary download** (rustup-style) — desyncs npm's ledger; the next `npm install` rolls it back.
- **Context from cwd** — a global shim run inside a project would upgrade the project and report success while the invoked CLI stayed stale.
- **Assuming global when no manifest records the install** — runs `npm install -g` against the machine for what is really an unrecorded local copy, then fails confirmation against the still-stale local one. A global install must be confirmed: the copy's `node_modules` has to be the root npm or pnpm itself calls global (`detectInstallContext`); otherwise the CLI refuses.
- **Logic in the `bin/puzzle.js` shim** — the shim stays a dumb forwarder.
- **Installing the `latest` dist-tag** — races the registry; the exact version makes verification meaningful.

## Gotchas

- **Registry Accept header:** `FetchLatest` requests `<registry>/@magic-spells/puzzle/latest` with `Accept: application/json`. npm answers **406** to the abbreviated `application/vnd.npm.install-v1+json` on version endpoints, and the passive path swallows errors, so a wrong header silently breaks every check. Verify fetch changes against `registry.npmjs.org`, not only the httptest double.
- Platform package names use Node's spelling (`windows` → `win32`, `amd64` → `x64`, `platformPackageNameFor`), and the binary is `puzzle.exe` on Windows (`platformBinaryNameFor`). On Windows the `node_modules/.bin/puzzle` fallback is a shell script and is skipped.
- In Go tests `os.Executable()` is the test binary; `executablePath` and `spawnRefresh` (`internal/update/spawn.go`) are the seams, and the fork-for-real test re-execs the test binary via a TestMain branch.
- A forked helper resolves its cache via `os.UserCacheDir()` from the environment — give it a fake HOME/XDG_CACHE_HOME/LocalAppData; the `update.CacheDir` package var does not reach a child.
- `Refresh()` honors `CI`, and GitHub Actions sets `CI=true`: tests of the body must clear both gates (`ungateRefresh`). Reproduce with `CI=true go test ./internal/update/...`.
- In concurrent-writer tests, only bytes that were read and fail to parse are a torn read; a failed open is the Windows race, not the bug.
