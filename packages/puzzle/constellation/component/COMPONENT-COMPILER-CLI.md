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
  - kind: verified
    text: >-
      generate --path symlink containment + pieces fail-before-write ordering reviewed against the
      card's new prose; Go suite green
    sha: 47b929360bc00d6c19b4b39113a4b502e7957952
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: state
    text: >-
      `puzzle generate component` gained `--family Wrapper,Content` (D167): scaffolds
      `app/components/<Root>/` with one `.pzl` per member plus an `index.js` barrel (`Object.assign`
      default export + named exports). Root and members are PascalCase-validated, and reserved
      marker names (Children/Slot/Snippet/Portal) are refused — that marker guard now also covers
      plain `generate component` (previously `generate component Slot` scaffolded an uninvocable
      component); views are deliberately exempt, being routed by class and never written as tags.
      Collision handling is all-or-nothing: every destination is stat'd before the first write, and
      `--force` rewrites only the family's own files, never siblings. `--path` places the family
      directory inside the override, and the printed import hint follows it — a dir under `app/`
      prints the `@` alias form, anything else the project-relative path. Family stubs are
      composition-shaped (`<Children/>` + caller `class` override), unlike the plain component stub,
      because nested members would otherwise render nothing; non-family output stays byte-identical.
  - kind: state
    text: >-
      0.7.0: `puzzle add piece` installs COMPOUND pieces (D167 families). A manifest `files` entry
      carrying a `/` — `"NavigationMenu/index.js"` — is copied path-preserving under the piece's
      target dir, so a family lands as a directory rather than being flattened. The nested path in
      `files` is the ONLY signal: no `family: true` field and no registry-schema bump. The installer
      also validates every manifest path strictly BEFORE any write — no `.`/`..` segments, no empty
      segments, no absolute or drive-letter paths, for `files`, `targetDir`, `theme` and `lib/`
      registryDependencies — naming the piece, field and entry; it rejects rather than cleans, so
      the manifest entry, the destination and the `pieces.lock` key stay the same string. Overwrite
      pre-flight and RenderSummary are unchanged (one ✓ line per unit with a file count, so a family
      reads as one unit with N files). Contract detail lives on DOC-SPEC-BUILD; implementation is
      compiler/internal/pieces/pieces.go.
  - kind: state
    text: >-
      2026-09-09 — the passive update notice is no longer cache-only, so the body's "24h cache,
      background refresh" phrasing is stale. Current design (D76, amended): `internal/update` keeps
      a **6h** cache under the user cache dir; a cache inside the TTL answers with no request at
      all, and a missing or stale one is refreshed in the **foreground under a 500 ms cap** and
      printed in the SAME run. Over the cap or on error the old fire-and-forget refresh (3s) takes
      over and the stale answer returns immediately. TTY-only, skipped under `CI` /
      `PUZZLE_NO_UPDATE_CHECK`, registry overridable via `PUZZLE_REGISTRY` — all unchanged. Fold
      this into the body on the next pass over this card (it has no `##` sections, so it needs a
      full-body write).
  - kind: state
    text: >-
      2026-09-09, superseding the same-day note above — the same-run update notice was reverted
      before it shipped. Current design (D76, and the body's "24h cache, background refresh" is
      wrong only in the number): `internal/update` keeps a **1h** cache under the user cache dir and
      `CheckPassive` NEVER fetches. It prints from the recorded answer and, when that answer is over
      the TTL or absent and no `failed_at` backoff is running, starts a **detached helper process**
      — the CLI re-execing itself as the hidden `puzzle update-check` subcommand
      (cmd/puzzle/updatecheck.go), which fetches with a 3s budget and writes the cache or the
      failure stamp. It is a process rather than a goroutine because `puzzle build` exits before any
      in-process fetch can land; `dev` uses the same path so there is only one. Cache writes are
      atomic (temp + rename) since parallel builds each spawn one. Gates (TTY-only, `CI`,
      `PUZZLE_NO_UPDATE_CHECK`) and `PUZZLE_REGISTRY` are unchanged, and the helper re-checks the
      two env gates itself. Fold this into the body on the next pass over this card — it has no `##`
      sections, so it needs a full-body write.
---

# Compiler CLI


Cobra command surface shipped by the platform binary:

- `puzzle build [dir] [--mode] [--static|--hybrid]` runs the production/
  development, true-static (D81), or hybrid-prerender (D67) build — the two
  output flags are mutually exclusive and must agree with any `output` config
  value — and prints raw/gzip output plus prerender summaries. The size banner
  also reads the metafile for a per-dependency composition report, warning past
  200 KB for one dependency ([[DECISION-D160-SPA-CODE-SPLITTING]]).
  `--profile-build` adds a per-phase timing table (config load, usage scan,
  browser bundle, tailwind, public copy, prerender bundle/render, per-page
  bundles, source-map strip, staging swap) on **stderr**, leaving the stdout
  summary that scripts parse untouched. `PUZZLE_PROFILE_BUILD=1` enables the
  same table for any process that calls the builder, which is how a
  `puzzle dev` static rebuild — a direct `build.Build` call with no flags of
  its own — gets profiled. Disabled, the profiler is a nil pointer.
- `puzzle dev [dir] --port` starts [[COMPONENT-DEV-SERVER]]. A busy port is not
  fatal: the server scans upward for the first free one and warns when it moved;
  `--strict-port` restores bind-or-fail ([[DECISION-D90-DEV-PORT-SCAN]]). An
  `output: 'static'` project gets the real prerender pipeline per rebuild
  instead of the SPA loop ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]), through
  the persistent builder of
  [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]].
  [[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]] adds
  `--profile-build`, printing stable startup and per-rebuild phase tables for
  SPA, hybrid, and static dev to stderr; `PUZZLE_PROFILE_BUILD=1` enables the
  same behavior without a flag.
- `puzzle preview [dir] [--port N] [--strict-port]` (D148) serves an existing
  `dist/` with production-host semantics per resolved output mode (SPA history
  fallback / hybrid prerendered-page-first / static clean URLs + real 404s) via
  `internal/preview` over the shared `internal/serve` resolver. No watcher, no
  SSE. Default port 4000 so it runs beside dev; missing or empty `dist/` is a
  hard error naming `puzzle build`; a flag-only build's mode is read back from
  the artifact's `data-puzzle-static`/`data-puzzle-ssg` marker when the config
  is silent, and config/artifact disagreements warn.
- `puzzle check [dir]` ([[DECISION-D165-PUZZLE-CHECK]]) type-checks the app's
  `.pzl` files with the TypeScript the app itself installs. `internal/check`
  rebuilds `.puzzle/check/` per run: each `.pzl` under `app/` becomes a virtual
  file — a `lang="ts"` script verbatim plus a generated, never-executed wrapper
  restating every template expression as typed statements, or, for a JavaScript
  component, an unchecked `.pzl.script.js` mirror alongside that wrapper (the
  `.script` infix stops TypeScript's extension substitution resolving the
  wrapper's import back to itself). It then resolves the app's
  `node_modules/typescript/bin/tsc` and runs `node <that entry> --noEmit
  --pretty false -p .puzzle/check` as a subprocess — the same invocation on
  every OS, never a `.bin` shim and never `cmd.exe`, so a project path
  containing a space works on Windows too — then rewrites each diagnostic to its
  authored `.pzl` line/column through the `.segments.json` sidecars, passing
  anything unmappable through untouched. The generated
  tsconfig extends the app's when present, overrides the options that would
  break the workspace (`rootDir`, `composite`, `skipLibCheck`, the `noUnused*`
  pair, an inherited `exclude`), and switches shape for TypeScript 7 after
  probing `tsc --version` once. Nothing here links against a TypeScript API.
  A missing tsc is the message `puzzle check needs TypeScript: npm install -D
  typescript`, checked AFTER the "not a Puzzle project" test (a missing `node`
  on `PATH` is its counterpart); a `.pzl` that
  fails to compile is reported as its own positioned diagnostic and skipped
  rather than aborting the run. `--js` is registered and deliberately errors as
  not implemented.
- `--fixtures` on both `build` and `dev` (D98) wires `app/fixtures.js` through
  a generated two-module wrapper entry under `.puzzle/` so the `/fixtures`
  module installs before the app entry runs; requires the file, is rejected
  with `--static`/`--hybrid` (or a config `output`), and one-shot builds
  remove the generated `.puzzle/fixtures/` afterward while dev keeps it for the
  process lifetime. `.puzzle/` itself survives every build: it is the
  compiler's scratch root, holding `tmp/` (staging + previous-dist holding dirs,
  plus static dev's warm output tree), `check/` (the D165 workspace), and a
  `.gitignore` of `*` that makes the
  whole directory self-ignoring ([[DECISION-D153-PUZZLE-SCRATCH-DIR]]).
- `puzzle init <name>` embeds `default` and `todos` app trees, with optional
  TypeScript editor config. On a TTY it prompts for whatever was not given —
  missing name, then template, then TypeScript y/N (D77; explicit flags are
  never re-asked); non-TTY input never prompts and never hangs. Targets are
  npm-name validated and must be empty.
- `puzzle generate` / `g` creates component/view/layout/model stubs. `.pzl`
  templates compile in tests, and model generation prints registry wiring
  instead of rewriting user JavaScript. The `--path` containment guard resolves
  symlinks before comparing (root fully; the destination via its nearest
  existing ancestor — the same `evalSymlinksAllowMissing` pattern as pieces,
  kept in deliberate lockstep), so an in-project symlink pointing outside the
  root is refused; a purely lexical check let it escape.
- `puzzle add tailwind` writes missing canonical files or prints the exact
  integration snippet when user-owned config already exists.
- `puzzle add piece` resolves the registry source by a fixed precedence —
  `--registry`, then `$PUZZLE_PIECES_REGISTRY`, then the default
  `npm:@magic-spells/puzzle-pieces`. A source may be an `npm:<pkg>[@version]`
  spec, a local directory, or an `http(s)` URL, and each gets its own fetcher.
  The npm transport is version-locked to the CLI: it selects the newest
  published release sharing the CLI's major.minor (prereleases never
  auto-select), falls back to the newest OLDER minor with a printed stderr
  notice naming both versions, and hard-fails with the published list when
  nothing older exists. `--pieces-version` pins an exact release. From there the
  installer expands transitive piece and `lib/` dependencies, offers
  did-you-mean names, runs all-or-nothing overwrite checks, prints theme and npm
  dependency next steps, and records sha256 `pieces.lock` entries alongside the
  resolved registry coordinates and the CLI version that performed the add.
  Everything that can fail — the theme fetch (`planTheme`) and the existing-lock
  parse — completes after the conflict pre-flight but BEFORE the first
  destination write, so a missing theme or malformed lock leaves the app tree
  untouched instead of a partial install with no lock.
- `puzzle add skills` (alias `skill`; D78) installs the embedded agent skill
  (`skills/puzzle/`, `go:embed`) into detected `~/.claude`/`~/.codex`/`~/.cursor`
  config dirs: huh checkbox multi-select on a TTY with all targets pre-selected,
  silent install-to-all on non-TTY, friendly no-op when nothing is detected.
  `--skill-root` (D97, repeatable) pins the config dirs, skipping both detection
  and the prompt; the root must already exist. Existing destinations classify
  against the `.puzzle-skill-version` stamp each install writes (D99): a matching
  stamp is skipped as up to date, a stale or unstamped one prompts on a TTY
  (declining skips only that target, so fresh ones still install) and keeps the
  all-or-nothing refusal on a non-TTY, and a symlinked destination is reported
  and skipped unless `--overwrite` is given. Installing removes a real
  destination first so a dropped payload file cannot linger; a symlink is
  written through instead, since removing it would delete the link.
- `puzzle upgrade skills` (D99) runs that same refresh from the running binary —
  no registry check and no re-exec, because nothing was upgraded — over installs
  that already exist, and unlike `add skills` it installs on a non-TTY without
  prompting.
- `puzzle doctor`, `puzzle info`, and `puzzle --version` provide diagnostics and
  environment/project metadata.
- `puzzle upgrade` (D76) checks the npm registry and upgrades via the user's
  own package manager, resolving the install context from the RUNNING
  EXECUTABLE rather than the cwd — project installs get the lockfile-detected
  manager with the dependency field preserved, global installs get
  `npm -g`/`pnpm -g`, `go install` users get instructions, and a binary hoisted
  into a workspace root that does not itself declare the CLI is a refusal
  printing the member-package command instead of guessing a member. The
  installed version is confirmed
  afterward. On that confirmed-success path only, it then offers (D97) to
  refresh the agent skill wherever one is already installed, by re-execing the
  newly installed binary — `--version`-gated, since this process embeds the old
  skill — with `add skills --overwrite --skill-root …` for the confirmed roots;
  symlinked installs are reported and skipped, non-TTY prints a hint instead,
  and no failure here can fail the upgrade. `--check` only reports. `build`/`dev`
  additionally print a passive
  cache-first update notice (`internal/update`: 24h cache under the user cache
  dir, background refresh, TTY-only, skipped under `CI` or
  `PUZZLE_NO_UPDATE_CHECK`, registry overridable via `PUZZLE_REGISTRY`).

The D3 boundary holds: add/generate never parse or rewrite user JavaScript and
never install npm dependencies — `puzzle check` extends that rule to the
toolchain, resolving the app's own `tsc` and never installing one. Piece
registries are untrusted: target/file/lib/
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
