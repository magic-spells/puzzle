---
name: Compiler CLI
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - FILE-CLI
  - FILE-CLI-ADD
  - FILE-SCAFFOLD
  - FILE-GENERATE
  - FILE-PIECES
  - FILE-PZLC
verified_at: '2026-07-22T19:43:05.365Z'
verified_sha: 1c2f4b6fef8106cbf3d0a433bfb6186ef89fcc73
---

# Compiler CLI

Cobra command surface shipped by the platform binary:

- `puzzle build [dir] [--mode] [--static]` runs the production/development or
  static build and prints raw/gzip output plus prerender summaries.
- `puzzle dev [dir] --port` starts [[COMPONENT-DEV-SERVER]].
- `puzzle init <name>` embeds `default` and `todos` app trees, with optional
  TypeScript editor config. On a TTY it prompts for whatever was not given —
  missing name, then template, then TypeScript y/N (D77; explicit flags are
  never re-asked); non-TTY input never prompts and never hangs. Targets are
  npm-name validated and must be empty.
- `puzzle generate` / `g` creates component/view/layout/model stubs. `.pzl`
  templates compile in tests, and model generation prints registry wiring
  instead of rewriting user JavaScript.
- `puzzle add tailwind` writes missing canonical files or prints the exact
  integration snippet when user-owned config already exists.
- `puzzle add piece` resolves local/HTTPS registries, transitive dependencies,
  did-you-mean names, all-or-nothing overwrite checks, theme/dependency next
  steps, and sha256 `pieces.lock` entries.
- `puzzle add skills` (alias `skill`; D78) installs the embedded agent skill
  (`skills/puzzle/`, `go:embed`) into detected `~/.claude`/`~/.codex`/`~/.cursor`
  config dirs: huh checkbox multi-select on a TTY with all targets pre-selected,
  silent install-to-all on non-TTY, pieces-style all-or-nothing `--overwrite`
  pre-flight, friendly no-op when nothing is detected.
- `puzzle doctor`, `puzzle info`, and `puzzle --version` provide diagnostics and
  environment/project metadata.
- `puzzle upgrade` (D76) checks the npm registry and upgrades via the user's
  own package manager — project installs get the lockfile-detected manager with
  the dependency field preserved, global installs get `npm -g`/`pnpm -g`,
  `go install` users get instructions; the installed version is confirmed
  afterward. `--check` only reports. `build`/`dev` additionally print a passive
  cache-first update notice (`internal/update`: 24h cache under the user cache
  dir, background refresh, TTY-only, skipped under `CI` or
  `PUZZLE_NO_UPDATE_CHECK`, registry overridable via `PUZZLE_REGISTRY`).

The D3 boundary holds: add/generate never parse or rewrite user JavaScript and
never install npm dependencies. Piece registries are untrusted: target/file/lib/
theme paths reject absolute or parent traversal, resolved destinations cannot
escape the app through symlinks, and local fetches cannot escape the registry
root through symlinks.

Each command self-registers from its own file. Filesystem writes use atomic
helpers where a partial artifact would be harmful. Shared terminal output
handles TTY color, build tables, concise errors, and an ldflags-stampable
version matching the package. TTY gates use a real isatty check (D78 fix):
`/dev/null` is a character device but is not a terminal, so prompts can never
block under cron/CI stdin.

`pzlc` is the internal/test-facing single-file compiler with explicit
view/layout/component mode; it is not the app workflow.
