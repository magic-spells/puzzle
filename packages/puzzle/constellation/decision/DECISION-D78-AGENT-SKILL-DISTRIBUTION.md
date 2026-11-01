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
verified_at: '2026-11-01T19:23:12.785Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - compiler/cmd/puzzle/add.go
  - compiler/cmd/puzzle/add_skills.go
  - compiler/cmd/puzzle/upgrade.go
  - skills/embed.go
---

# D78 — Agent-skill distribution: embedded skill, `puzzle add skills`, refresh on upgrade

The repo ships an AI-agent skill for building Puzzle apps (`skills/puzzle/SKILL.md`, cross-agent SKILL.md layout). It is `go:embed`-ed into the CLI (`skills/embed.go`), so the skill a user installs always matches the CLI that wrote it. Spec: [[DOC-SPEC-BUILD]] §13 and §41.

## Decision

**Install: `puzzle add skills`** (alias `skill`)

- **Targets:** offered iff the tool's config dir exists — `~/.claude`, `~/.codex`, `~/.cursor`; the destination `<root>/skills/puzzle/` is created as needed. `--skill-root <dir>` (repeatable) names roots outright, skipping detection and the target prompt; the root must already exist.
- On a TTY, a `huh` multi-select with every detected target pre-selected; deselecting all installs nothing. Non-TTY (or `--yes`) installs to every detected target without prompting.
- Every install writes `<dest>/.puzzle-skill-version` (the CLI version). Missing/blank reads as *unknown*, which counts as stale.
- Each target is **missing** (install), **current** (stamp matches — skip), **stale/unstamped** (TTY: ask; `--yes`: replace; plain non-TTY: refuse, naming `--force` and `--yes`) or a **symlink** (report and skip — it is a dev checkout link). Declining skips only the stale ones. Current installs are not conflicts, so the command is idempotent in CI.
- `--force` (hidden alias `--overwrite`) is the unconditional write and the only way through a symlink.
- `installSkillTree` removes a real destination before copying, so files a newer payload dropped cannot linger. A symlinked destination is written through, never removed (`os.RemoveAll` would delete the link itself). Copy is recursive, so a `references/` folder needs no CLI change.

**Refresh**

- **After `puzzle upgrade` installs a new version** (never on `--check`, already-current, or the manual/`go install` branch), it offers to refresh existing installs only — real `<root>/skills/puzzle/` dirs under detected roots; symlinks are reported and skipped. TTY asks; `--yes` refreshes without asking; plain non-TTY prints a hint and writes nothing.
- The running process holds the *old* embedded skill, so the refresh **re-execs the newly installed binary** (`add skills --force --skill-root …`). Candidates in order — project install: `node_modules/@magic-spells/puzzle-<platform>/bin/puzzle`, then `node_modules/.bin/puzzle`; global: `exec.LookPath("puzzle")`, then the running executable — must each answer `--version` with exactly the target (whole-field equality, so 0.2.10 never satisfies 0.2.1). No verified candidate → print the manual command. Nothing here can fail the upgrade; problems print one `!` line.
- **`puzzle upgrade skills`** refreshes existing installs from the running binary — no registry fetch, no re-exec — and runs on a non-TTY without prompting (the command names the intent).
- `confirmSkillUpdate` is the single test seam for the confirm prompt.

## Alternatives rejected

- **Ship `skills/` in the npm tarball** — grows the `files` allowlist with non-runtime content and adds a second payload copy.
- **Refresh from the running binary after upgrade** — silently installs the previous release's skill; the reason re-exec exists.
- **Offer every detected config dir on upgrade** — turns an upgrade into a first-time installer for tools the user never chose.
- **Prompt for symlinked destinations** — a "yes" from an older binary would revert the checkout's canonical skill.
- **Read `version:` from SKILL.md frontmatter** — tracks the author's number, not the installing CLI.
- **Scaffold-only distribution** (`puzzle init` writes `.claude/skills/`) — reaches only new apps; could still complement this.

## Gotchas

- `ui.IsTerminal` must be a real isatty check (`mattn/go-isatty`) — `/dev/null` is a char device and would otherwise hang huh under cron/CI.
- Nothing in the build checks the skill's content: re-verify it against the public surface whenever that changes (it drifts).
- `.puzzle-skill-version` lands inside the tree, so `--force` through a checkout symlink drops one untracked file (gitignored in this repo).
