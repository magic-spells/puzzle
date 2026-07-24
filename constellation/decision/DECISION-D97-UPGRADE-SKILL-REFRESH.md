---
name: 'D97 — `puzzle upgrade` offers to refresh the installed agent skill (v1.60)'
status: built
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DECISION-D78-AGENT-SKILL-DISTRIBUTION
  - DECISION-D76-CLI-UPGRADE
---

# D97 — `puzzle upgrade` offers to refresh the installed agent skill (v1.60)

After `puzzle upgrade` actually installs a new version, it asks whether to
reinstall the Puzzle agent skill wherever one is already installed, and does it
by re-executing the binary it just installed. `puzzle add skills` gains a
repeatable `--skill-root` flag that pins the config dirs and skips detection and
the target prompt. See [[DOC-SPEC]] §13 and §41.

## Context

[[DECISION-D78-AGENT-SKILL-DISTRIBUTION]] made the skill payload
`go:embed`-ed into the binary specifically so the installed skill always matches
the CLI that wrote it, and closed with "`puzzle upgrade` + re-run refreshes it" —
a manual re-run nobody remembers. The skill encodes the public surface (CLI
commands, grammar, SSG rules), so a user on a new CLI with last release's skill
gets an agent confidently describing a framework they are no longer running.
That is worse than no skill.

## Decision

**Gate: only after a version actually changed.** The offer runs on the success
path of `puzzle upgrade`, after `✓ upgraded <old> → <new>`. `--check`, the
already-up-to-date short-circuit, and the manual/`go install` branch all reach
it never.

**Scope: refresh, not first install.** A target qualifies iff
`<root>/skills/puzzle/` already exists as a real directory under a detected
config dir (`~/.claude`, `~/.codex`, `~/.cursor`). Config dirs with no skill are
left to `puzzle add skills` — an upgrade should not spread new files into tools
the user never opted in for.

**A symlinked `<root>/skills/puzzle` is reported and skipped.** That shape means
a dev checkout linked into the config dir; copying through it rewrites files in
someone's working tree. One `!` line names the path, and nothing is written.

**The refresh re-execs the NEWLY INSTALLED binary, verified by `--version`.**
This is the load-bearing part: the skill is embedded, so the running process
holds the OLD skill and physically cannot install the new one. Candidates are
tried in install-shape order — project: `node_modules/@magic-spells/
puzzle-<platform>/bin/puzzle` then `node_modules/.bin/puzzle`; global:
`exec.LookPath("puzzle")` then the running executable — and each must answer
`--version` with exactly the target version (trailing-field equality, so 0.2.10
never satisfies a 0.2.1 check). No candidate verifies → print the manual command
rather than reinstall the stale skill we are carrying.

**Nothing here can fail the upgrade.** The package is installed by this point; a
skill copy is a courtesy on top. Every failure prints and returns nil.

**Non-TTY prints a hint, never writes.** One `!` line naming the installed
destinations and `puzzle add skills --overwrite`, preserving the D32/D77/D78
never-prompt-never-hang rule.

**`--skill-root <dir>` (repeatable) is the parent→child contract.** The prompt
lists exact destinations, so the child must install to exactly those; explicit
roots therefore skip both home detection and the multi-select. The root must
already exist — a typo'd path is an error, not a conjured config dir. It is
public, not hidden: pinning a project-local `.claude` is a legitimate manual use.

## Alternatives rejected

- **Install the running binary's embedded skill.** One process, no re-exec — and
  silently writes the previous release's skill while reporting success. This is
  the bug the whole design exists to avoid.
- **Ship `skills/` in the npm tarball and copy from `node_modules`.** Would let
  the old process read new bytes off disk, but grows the npm `files` allowlist
  with non-runtime content — the exact thing D78 rejected — and adds a second
  copy of the payload to keep in lockstep with the embedded one.
- **Offer every detected config dir, like `add skills`.** Turns an upgrade into
  a first-time installer for tools the user never chose. `puzzle add skills` is
  one command away.
- **Let the child run its own multi-select (no `--skill-root`).** Saves a flag
  but costs a second prompt, and the child's list would not match the paths the
  parent just asked about.
- **Passing roots through an env var instead of a flag.** Hides the contract
  from `--help` and from anyone debugging a failed refresh; a documented flag is
  also independently useful.
- **A `--skills`/`--no-skills` flag on `upgrade`.** Nothing to script yet: the
  non-TTY path already never prompts and never writes. Add it if a real CI need
  appears.

## Consequences

- The feature only takes effect from the *next* upgrade onward: the binary that
  performs an upgrade must itself carry this code, so a release upgrading INTO
  v1.60 does nothing, and v1.60 → later releases refresh.
- The re-exec spawns `--version` plus the install (two child processes; via
  `node_modules/.bin/puzzle` those go through the node shim).
- `puzzle add skills --overwrite` is unchanged for direct users, symlinked
  destinations included — the skip is upgrade-path policy, not a new `add`
  semantic.
- `confirmSkillUpdate` is a package-level indirection so tests answer the prompt
  without driving a huh form; the real form is separately pinned to y/n input.
