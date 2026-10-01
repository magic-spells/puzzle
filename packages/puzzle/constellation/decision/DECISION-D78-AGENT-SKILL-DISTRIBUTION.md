---
name: 'D78 — Agent-skill distribution: embedded skill, puzzle add skills, and refresh on upgrade'
status: verified
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DECISION-D76-CLI-UPGRADE
  - DECISION-D77-INIT-PROMPTS
  - DECISION-D32-CLI-TOOLING
  - FILE-CLI-ADD
  - TEST-CLI-COMMANDS
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - compiler/cmd/puzzle/add.go
  - compiler/cmd/puzzle/add_skills.go
  - compiler/cmd/puzzle/upgrade.go
  - skills/embed.go
---

# D78 — Agent-skill distribution: embedded skill, `puzzle add skills`, refresh on upgrade

The repo ships an AI-agent skill for building Puzzle apps
(`skills/puzzle/SKILL.md`, cross-agent SKILL.md layout). It is `go:embed`-ed
into the CLI (`skills/embed.go`), so the skill a user installs always matches the
CLI that wrote it. Spec: [[DOC-SPEC-BUILD]] §13 and §41.

## Install: `puzzle add skills` (alias `skill`)

- **Targets:** offered iff the tool's config dir exists — `~/.claude`,
  `~/.codex`, `~/.cursor`; destination `<root>/skills/puzzle/` is created as
  needed. `--skill-root <dir>` (repeatable) names roots outright and skips
  detection and the target prompt; the root must already exist.
- On a TTY a `huh` multi-select with all detected targets pre-selected;
  deselecting all installs nothing. Non-TTY installs to every detected target
  without prompting.
- Every install writes `<dest>/.puzzle-skill-version` (the CLI version, plain
  text). Missing/blank reads as *unknown*, which sorts with stale.
- Each selected target is **missing** (install), **current** (stamp matches —
  skip), **stale/unstamped** (TTY: ask; non-TTY: refuse without `--overwrite`) or
  a **symlink** (report and skip — it is a dev checkout link). Declining skips
  only the conflicts; the rest still install. Current installs are not
  conflicts, so the command is idempotent in CI.
- `--overwrite` is the unconditional write and the only way through a symlink.
- `installSkillTree` removes a real destination before copying, so files a newer
  payload dropped cannot linger. A symlinked destination is written through and
  never removed (`os.RemoveAll` would delete the link itself).
- Copy is recursive, so a `references/` folder needs no CLI change.

## Refresh

- **After `puzzle upgrade` installs a new version** (never on `--check`,
  already-current, or the manual/`go install` branch), it offers to refresh
  existing installs only — real `<root>/skills/puzzle/` dirs under detected
  roots; symlinks are reported and skipped. The running process holds the *old*
  embedded skill, so the refresh **re-execs the newly installed binary**
  (`add skills --overwrite --skill-root …`). Candidates in install-shape order —
  project: `node_modules/@magic-spells/puzzle-<platform>/bin/puzzle`, then
  `node_modules/.bin/puzzle`; global: `exec.LookPath("puzzle")`, then the
  running executable — must each answer `--version` with exactly the target
  (whole-field equality, so 0.2.10 never satisfies 0.2.1). No verified candidate
  → print the manual command. Non-TTY prints a hint and never writes. Nothing
  here can fail the upgrade; problems print one `!` line.
- **`puzzle upgrade skills`** refreshes existing installs from the running
  binary — no registry fetch, no re-exec — and installs on a non-TTY without
  prompting (the command names the clobber).
- `confirmSkillUpdate` is the single test seam for the confirm prompt.

## Alternatives

- **Scaffold-only distribution** (`puzzle init` writes `.claude/skills/`) —
  reaches only new apps; still a possible complement.
- **Ship `skills/` in the npm tarball** — grows the `files` allowlist with
  non-runtime content and adds a second payload copy.
- **Refresh from the running binary after upgrade** — silently installs the
  previous release's skill; the reason re-exec exists.
- **Offer every detected config dir on upgrade** — turns an upgrade into a
  first-time installer for tools the user never chose.
- **Prompt for symlinked destinations** — a "yes" from an older binary would
  revert the checkout's canonical skill.
- **Read `version:` from SKILL.md frontmatter** — tracks the author's number,
  not the installing CLI.

## Consequences

- `huh` (bubbletea/lipgloss) is a CLI dependency. `ui.IsTerminal` is a real
  isatty check (`mattn/go-isatty`) — `/dev/null` is a char device and would
  otherwise hang huh under cron/CI.
- Nothing in the build checks the skill's content: it is release-checklist
  surface and must be re-verified against the public surface whenever that
  changes (it has drifted before).
- `.puzzle-skill-version` lands inside the tree, so `--overwrite` through a
  checkout symlink drops one untracked file (gitignored in this repo).
