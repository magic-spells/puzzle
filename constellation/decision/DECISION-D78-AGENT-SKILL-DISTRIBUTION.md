---
name: 'D78 — Agent-skill distribution: embedded skill + `puzzle add skills` (v1.45)'
status: built
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DECISION-D77-INIT-PROMPTS
  - DECISION-D32-CLI-TOOLING
  - FILE-CLI-ADD
---

# D78 — Agent-skill distribution: embedded skill + `puzzle add skills` (v1.45)

The repo now ships a distilled AI-agent skill for building Puzzle apps
(`skills/puzzle/SKILL.md`, cross-agent SKILL.md format), and the CLI installs it:
`puzzle add skills` (alias `skill`) copies the embedded skill into every detected
agent config dir. See [[DOC-SPEC]] §13.

## Context

An app-builder skill (grammar, lifecycle, SSG footguns, pieces conventions) had
proven itself as a private `~/.claude/skills/puzzle` file, but it hard-coded
owner-local paths and had no distribution or versioning story. The skill's
content drifts with the framework (CLI surface, SSG rules), so the copy a user
has must match the framework version they run. Claude Code, Codex, and Cursor
all consume the same `<root>/skills/<name>/SKILL.md` layout, and Cursor
additionally reads Claude's and Codex's dirs for compatibility.

## Decision

**The skill lives in-repo at `skills/puzzle/` (portable links only), is embedded
into the binary via a root-level `go:embed` package (`skills/embed.go`), and
`puzzle add skills` installs it.**

- Target detection: a target is offered iff the tool's root config dir exists —
  `~/.claude` (Claude Code), `~/.codex` (Codex), `~/.cursor` (Cursor).
  Destination `<root>/skills/puzzle/` is created as needed (Cursor typically
  lacks `skills/`).
- On a TTY: a `charmbracelet/huh` multi-select checkbox list, all detected
  targets pre-selected (space toggles, enter confirms). Deselecting all
  installs nothing, exit 0.
- Non-TTY: installs to ALL detected targets silently — the never-prompt,
  never-hang convention from D32/D77.
- Existing `<root>/skills/puzzle/` refuses without `--overwrite`
  (all-or-nothing pre-flight, same idiom as pieces). Copy is recursive, so a
  future `references/` folder ships without CLI changes.
- Embedding at build time is the versioning story: the installed skill always
  matches the CLI that wrote it; `puzzle upgrade` + re-run refreshes it.

## Alternatives rejected

- **Scaffold-only distribution (`puzzle init` writes `.claude/skills/`)**: only
  reaches new apps; existing apps and global installs get nothing. Still a
  candidate as a complement, tracked as an open follow-up.
- **npm-package payload users copy by hand**: manual step, no target detection,
  and the npm `files` allowlist would grow non-runtime content.
- **A plugin marketplace / skills-registry publish**: a second artifact to keep
  in lockstep; can layer on later once content stabilizes.
- **Zero-dep numbered prompt instead of huh**: matches D77's plain-text stance,
  but a multi-toggle selection is a genuinely different interaction than D77's
  two sequential one-answer questions; the owner chose real checkboxes. This
  narrows D77's "no bubbletea/huh" rejection to *sequential* prompts — the
  dependency now exists, and migrating init's prompts to huh is an open idea,
  not a commitment.

## Consequences

- First TUI dependency: `github.com/charmbracelet/huh` (+ bubbletea/lipgloss
  tree). Compile-time only for non-`add skills` paths.
- `ui.IsTerminal` was fixed as part of this work: it now does a real isatty
  check (`mattn/go-isatty`, already in the graph) instead of the
  `ModeCharDevice` heuristic — `/dev/null` is a char device and previously
  counted as a TTY, which would have made huh block forever under cron/CI
  stdin. `init`/`main` gates inherit the stricter (more correct) check.
- The D3 no-JS-rewriting rule is untouched (the command writes only skill
  files under tool config dirs, never project JavaScript).
- The skill file is release-checklist surface: its content must be re-verified
  against the docs whenever the public surface changes.
