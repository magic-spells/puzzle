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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: state
    text: >-
      `add piece` next steps also carry (D171): a stale-theme hint when an existing
      app/styles/pieces.css differs from the registry theme (lock-hash match → `puzzle add theme
      default`; otherwise hand merge / `--overwrite`), and one `puzzle add theme <names…>` line for
      the palettes the resolved pieces name in their manifest `themes` array that the app has
      neither on disk nor package-imported. `pieces.lock` is read before `planTheme` so the hint can
      tell an older registry copy from an edit. `add theme` with no names marks an installed palette
      whose bytes differ from the registry's `installed · outdated`.
---

# Compiler CLI

The Cobra command surface in the platform binary (`compiler/cmd/puzzle`, one file per
command, each self-registering). The user-facing contract is [[DOC-SPEC-BUILD]] §13 and
the per-feature sections it points to; this card holds implementation rules.

## Commands

- **`build [dir] [--mode] [--static|--hybrid]`** — production/development SPA, true
  static (D81) or hybrid prerender (D67). The two output flags are exclusive and must
  agree with any `output` config. The entry is `app/app.ts` or `app/app.js`. Prints
  raw/gzip sizes, a per-dependency composition report (warns past 200 KB,
  [[DECISION-D160-SPA-CODE-SPLITTING]]) and prerender summaries. `--profile-build` (or
  `PUZZLE_PROFILE_BUILD=1`, which is how a dev static rebuild gets profiled) prints phase
  tables to **stderr**, keeping the stdout summary scripts parse untouched; disabled, the
  profiler is a nil pointer.
- **`dev [dir] --port`** — [[COMPONENT-DEV-SERVER]]. A busy port scans upward
  (`--strict-port` = bind-or-fail, [[DECISION-D90-DEV-PORT-SCAN]]); an `output: 'static'`
  project runs the real prerender per rebuild ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]],
  [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]).
- **Runtime preflight**: `build` and `dev` call `build.PreflightRuntime` before any
  esbuild work. It first `os.Stat`s the directory (`directory not found` / `is not a
  directory`, not bypassable by `PUZZLE_RUNTIME`), then requires one of the three runtime
  sources (`PUZZLE_RUNTIME`, the in-repo walk, the installed runtime); otherwise one
  message naming `<pm> install`, with the package manager from the nearest lockfile.
  Rejected: auto-installing (the CLI never touches node_modules or the network, would guess
  the manager, and could install a mismatched runtime). `check`/`generate`/`preview` never
  bundle and are not gated.
- **`preview [dir] [--port N] [--strict-port]`** (D148) — serves an existing `dist/` with
  production-host semantics per output mode via `internal/preview` over the shared
  `internal/serve` resolver; no watcher. Default port 4000; missing `dist/` is a hard
  error; a flag-only build's mode is read back from the `data-puzzle-static`/
  `data-puzzle-ssg` marker.
- **`check [dir]`** ([[DECISION-D165-PUZZLE-CHECK]]) — `internal/check` rebuilds
  `.puzzle/check/` per run: each `.pzl` becomes a virtual file (a TS script verbatim plus
  a never-executed wrapper restating every template expression, or for JS an unchecked
  `.pzl.script.js` mirror — the `.script` infix stops TypeScript resolving the wrapper's
  import back to itself). It runs `node <app>/node_modules/typescript/bin/tsc --noEmit
  --pretty false -p .puzzle/check` (never a `.bin` shim or `cmd.exe`, so spaces in paths
  work on Windows) and maps diagnostics back through `.segments.json` sidecars. The
  generated tsconfig extends the app's, overrides workspace-breaking options, writes
  `paths` (app entries merged over `@/*`, retargeted), and switches shape at TypeScript 6
  (≥ 6 clears `baseUrl`/`moduleResolution`; below keeps node resolution and pins
  `module: ESNext`). No app tsconfig ⇒ `strict: false`. A missing tsc is checked AFTER
  the not-a-project test; an uncompilable `.pzl` is its own diagnostic, not an abort.
  `--js` is registered and errors as not implemented.
- **`--fixtures`** on `build`/`dev` (D98): a generated two-module wrapper entry under
  `.puzzle/` installs `/fixtures` before the app entry; requires `app/fixtures.js`,
  rejected with static/hybrid output. `.puzzle/` is the compiler's self-ignoring scratch
  root (`tmp/`, `check/`, a `*` `.gitignore`; [[DECISION-D153-PUZZLE-SCRATCH-DIR]]).
- **`init <name>`** — embedded `default`/`todos` trees (+ TypeScript variants). On a TTY
  it prompts for what wasn't given (D77); non-TTY never prompts. Targets must be
  npm-valid and empty.
- **`generate` / `g`** — component/view/layout/model stubs; in a TypeScript app (a root
  `tsconfig.json`, `IsTypeScriptApp`) every stub is TypeScript and a model is
  `app/models/<name>.ts`. Model generation prints registry wiring instead of editing JS.
  `--family A,B` (D167) scaffolds `app/components/<Root>/` with one `.pzl` per member plus
  an `index.js`/`index.ts` barrel; names are PascalCase and reserved marker names are
  refused for components. `Component` is refused for every `.pzl` scaffold, including
  views, layouts, family roots and members (D180), with a rename hint before any write.
  Collisions are all-or-nothing and `--force` rewrites only the family's files. The `--path` containment guard resolves symlinks
  (`evalSymlinksAllowMissing`, in lockstep with pieces).
- **`add tailwind`** writes missing canonical files or prints the snippet for
  user-owned config.
- **`add piece`** — registry precedence `--registry` → `$PUZZLE_PIECES_REGISTRY` →
  `npm:@magic-spells/puzzle-pieces`; sources are `npm:` specs, directories or URLs. The npm
  transport picks the newest release sharing the CLI's major.minor (no prereleases),
  falls back to an older minor with a notice, `--pieces-version` pins. Then: transitive
  piece and `lib/` deps, did-you-mean, all-or-nothing overwrite pre-flight, theme and npm
  next steps, sha256 `pieces.lock`. **Every manifest path is validated before any write**
  (no `.`/`..`/empty segments, no absolute or drive paths) and rejected, never cleaned; a
  `files` entry with a `/` installs path-preserving (the only compound-piece signal).
  Theme fetch and lock parse finish before the first write. Dependency specs carry a
  version floor (D169): split on the LAST `@`, merged by package name keeping the highest
  floor; a bare name still prints bare.
- **`add theme [name…]`** (D171, `internal/pieces/themes.go`) — no args lists the
  registry's palettes with install state; with names, copies each into the app and
  records it in `pieces.lock`: the default palette at `app/styles/pieces.css` (the same
  file `add piece` writes, so the two stay idempotent), others at
  `app/styles/themes/<name>.css`. A palette already imported from
  `@magic-spells/puzzle-pieces/themes/` is skipped; `styles.css` is never edited (the
  `@import` and `data-scheme` switch are printed). An unmodified older copy (matches its
  lock hash) is refreshed; a modified one needs `--overwrite`.
- **`add skills`** ([[DECISION-D78-AGENT-SKILL-DISTRIBUTION]]) installs the embedded agent
  skill into detected `~/.claude`/`~/.codex`/`~/.cursor` dirs (TTY multi-select, non-TTY
  installs to all; `--skill-root` pins). The `.puzzle-skill-version` stamp classifies
  existing installs; symlinked destinations are skipped unless `--overwrite` (then written
  through, never removed). **`upgrade skills`** refreshes existing installs from the
  running binary.
- **`upgrade`** (D76) resolves the install context from the RUNNING EXECUTABLE (project →
  lockfile manager; global → `npm -g`/`pnpm -g`; `go install` → instructions; a hoisted
  workspace binary → refusal naming the member command), confirms the version, then offers
  to refresh installed skills by re-execing the NEW binary. `--check` only reports.
- **Passive update notice** (`internal/update`, on `build`/`dev`): prints from a 1 h
  cache and NEVER fetches in-process. When stale (and no `failed_at` backoff), it spawns a
  detached helper — the binary re-execing the hidden `update-check` subcommand
  (`updatecheck.go`, 3 s budget) — because `puzzle build` exits before an in-process
  fetch could land. Cache writes are atomic (parallel builds). TTY-only; skipped under
  `CI`/`PUZZLE_NO_UPDATE_CHECK` (re-checked by the helper); `PUZZLE_REGISTRY` overrides.
- `doctor`, `info`, `--version` — diagnostics.

## Rules

- **D3 boundary**: add/generate never parse or rewrite user JavaScript and never install
  npm dependencies; `check` resolves the app's own `tsc` and never installs one.
- **Piece registries are untrusted**: no absolute/parent traversal in target/file/lib/
  theme paths, no symlink escape from the app or (local fetches) the registry root.
- Atomic writes where a partial artifact would hurt. TTY gates use a real isatty check —
  `/dev/null` is a character device, not a terminal, so prompts never block under CI.
- `pzlc` (`cmd/pzlc`) is the test/tooling single-file compiler with explicit mode; not
  the app workflow.
