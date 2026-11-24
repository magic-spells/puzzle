---
name: D76 — Update notification + puzzle upgrade
status: verified
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - TEST-CLI-COMMANDS
verified_at: '2026-11-23T21:17:35.592Z'
verified_sha: 6e9f34cfcf702663b2c22300ef8f3ffa3090a74d
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
- **`puzzle upgrade`** fetches the latest version synchronously (5s; failure is an error), then reports **two scopes** before it changes anything:
  - **The global CLI:** the running binary when it is the global install, else a puzzle package in the global `node_modules` that `npm root -g` or `pnpm root -g` reports. With none installed there is no global scope; the command never installs a global CLI.
  - **This project:** the nearest `package.json` at or above the cwd, no higher than the home folder, when it parses and its `dependencies` or `devDependencies` name the CLI. A nearer `package.json` that does not, or that does not parse, means no project, because npm's walk stops there too. (npm also stops at a `node_modules` with no `package.json`; this walk does not, since no ordinary layout has one.)
    - The package manager runs in that `package.json`'s folder, so a workspace member stays the project. Its manager comes from the first lockfile at or above it, and its version from the first `node_modules/@magic-spells/puzzle` at or above it, so a member without its own copy reads the root's. With nothing installed, the declared range stands in and the scope counts as behind.
    - Its full path is in the row, the question and the no-terminal hint, so the person sees where the package manager will run before it runs.

  The running binary's own install context comes from **the executable**, never the cwd (`detectInstallContext`):
  - A global binary is the global scope. A project binary is the project scope, and the cwd is not searched.
  - A workspace-hoisted or nested binary takes the project's place: its note names where that tree's dependency lives, so there is no project row and the cwd is not searched.
  - A source-build, runner-cache or unresolved binary is neither scope, so both scopes are looked up.
  - A binary that is neither scope prints `✨ puzzle <latest> available` and its note when it is behind, exits 0, and the scopes are still offered.

  Asking and upgrading:
  - On a TTY there is one question per scope that is behind, and every question comes before any install. `--yes` upgrades all of them. Without a TTY, only the scope the running binary is gets upgraded (none, for a binary that is neither), and every other scope that is behind gets the exact command to run.
  - Each upgrade shells out to the exact command a careful user would type, so `package.json`, the lockfile and the exact-pinned platform packages stay consistent.
  - Success is verified by reading the copy back from disk with the same lookup; it must equal the fetched target. A failed scope does not stop the other; each error names its scope, and the exit is non-zero.
  - A project upgrade that may have breaking changes (a new minor while the major is 0, else a new major: `update.Breaking`, the same rule the runtime version pair uses, [[DECISION-D202-CLI-RUNTIME-VERSION-PAIR]]) says so in its question, and afterwards points at "Upgrading across versions" in the installed `CHANGELOG.md` and at `npx puzzle check --fix`. The global CLI has no app code to migrate, so its question stays plain.
  - `--check` lists without upgrading. `--yes` also accepts the follow-up skill refresh (D78).

## Alternatives rejected


- **Bounded synchronous fetch before printing** — puts registry latency on the critical path of a fast build for a courtesy line; no cap value is defensible.
- **Goroutine refresh** — dies with `build` before the request completes.
- **Lock/single-flight around the refresh** — more code and state than the duplicate GET it prevents.
- **Self-replacing binary download** (rustup-style) — desyncs npm's ledger; the next `npm install` rolls it back.
- **The running binary's context from the cwd** — a global shim run inside a project would take the project for its own install, upgrade it, and report success while the invoked CLI stayed stale. The cwd only finds the project scope.
- **Assuming global when no manifest records the install** — runs `npm install -g` against the machine for what is really an unrecorded local copy, then fails confirmation against the still-stale local one. A global install must be confirmed: the copy's `node_modules` has to be the root npm or pnpm itself calls global (`detectInstallContext`); otherwise the CLI refuses.
- **Logic in the `bin/puzzle.js` shim** — the shim stays a dumb forwarder.
- **Installing the `latest` dist-tag** — races the registry; the exact version makes verification meaningful.
- **Upgrading only the running install** — leaves the other copy stale without a word: the app's dependency after a global upgrade, or the global CLI after `npx puzzle upgrade`. Both scopes are reported and offered.
- **Upgrading the running install without asking, and asking only about the other** — the person may want only one of them moved. One question per scope, the same for both, lets them choose.
- **Upgrading the other scope on a non-TTY** — a script named the install it ran, and moving a second one is a side effect it did not ask for. It gets the exact command instead; `--yes` upgrades both.
- **A second code path for the cwd project** — both scopes are `installContext`s, reported, asked about, upgraded and read back by the same code.
- **Walking past a `package.json` that does not declare the CLI** — `npm install` typed in that folder writes to the nearer file, so the walk would reach a project npm does not.
- **Upgrading a workspace member at the workspace root** — the member's `package.json` declares the dependency, so the package manager runs there. Only the lockfile and the installed copy may live at the root.
- **A path relative to the cwd in the row and the question** — in the project folder itself it prints as `.`, which reads as stray punctuation. The full path always says where the package manager will run.
- **`--ignore-scripts`, ownership checks or VCS-root detection on the project install** — the first breaks ordinary installs, and nothing in ordinary use needs the others. Showing the full path before anything runs is the safeguard.

## Gotchas

- **Registry Accept header:** `FetchLatest` requests `<registry>/@magic-spells/puzzle/latest` with `Accept: application/json`. npm answers **406** to the abbreviated `application/vnd.npm.install-v1+json` on version endpoints, and the passive path swallows errors, so a wrong header silently breaks every check. Verify fetch changes against `registry.npmjs.org`, not only the httptest double.
- Platform package names use Node's spelling (`windows` → `win32`, `amd64` → `x64`, `platformPackageNameFor`), and the binary is `puzzle.exe` on Windows (`platformBinaryNameFor`). On Windows the `node_modules/.bin/puzzle` fallback is a shell script and is skipped.
- In Go tests `os.Executable()` is the test binary; `executablePath` and `spawnRefresh` (`internal/update/spawn.go`) are the seams, and the fork-for-real test re-execs the test binary via a TestMain branch.
- A forked helper resolves its cache via `os.UserCacheDir()` from the environment — give it a fake HOME/XDG_CACHE_HOME/LocalAppData; the `update.CacheDir` package var does not reach a child.
- `Refresh()` honors `CI`, and GitHub Actions sets `CI=true`: tests of the body must clear both gates (`ungateRefresh`). Reproduce with `CI=true go test ./internal/update/...`.
- In concurrent-writer tests, only bytes that were read and fail to parse are a torn read; a failed open is the Windows race, not the bug.
