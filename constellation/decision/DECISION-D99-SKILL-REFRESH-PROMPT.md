---
name: D99 — `puzzle add skills` asks instead of refusing, and `puzzle upgrade skills` (v1.62)
status: verified
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DECISION-D78-AGENT-SKILL-DISTRIBUTION
  - DECISION-D97-UPGRADE-SKILL-REFRESH
  - DECISION-D77-INIT-PROMPTS
verified_at: '2026-07-24T22:56:54.920Z'
verified_sha: b64de21995a88b303d63bee37e8bc7f00cabb741
notes:
  - kind: verified
    text: >-
      Built and verified on feat/skill-refresh-prompt: both suites green (go test ./... all
      packages, vitest 1170/1170), plus a throwaway-HOME run of the real binary covering the symlink
      skip, the non-TTY stale refusal, --overwrite through a symlink, the up-to-date short-circuit,
      prune, and upgrade skills. The interactive confirm is covered by tests
      (TestConfirmSkillRefreshAnswers pins the real huh form); driving it through a pty was not
      reproducible from this harness.
    sha: b1bcbfa975096ce3d61b300340e54b53c46f0919
  - kind: verified
    text: >-
      Re-verified at merged main (PR #24). Both suites green on the merged tree: go test ./... all
      compiler packages, vitest 1223/1223 (the count grew from 1170 because D100's DevTools bridge
      tests landed in the same merge).
    sha: b64de21995a88b303d63bee37e8bc7f00cabb741
---

# D99 — `puzzle add skills` asks instead of refusing, and `puzzle upgrade skills` (v1.62)

An existing skill directory now prompts on a TTY rather than aborting the command,
installs carry a `.puzzle-skill-version` stamp so the CLI can tell current from
stale, and `puzzle upgrade skills` refreshes installed skills from the running
binary. See [[DOC-SPEC-BUILD]] §13 and §41.

## Context

The skill payload is `go:embed`-ed ([[DECISION-D78-AGENT-SKILL-DISTRIBUTION]]), so
re-running `puzzle add skills` after a CLI upgrade IS the refresh mechanism — and it
was the one path that answered with an error. The all-or-nothing pre-flight was
inherited from `add piece`, where refusing to clobber hand-edited component files is
right; a skill directory is generated content the user never authors, so the same
posture just made the common case retype the command with a flag.

The CLI also could not tell a *current* install from a *stale* one. It asked only
"does a directory exist?", which is why `add skills` had to refuse uniformly and why
[[DECISION-D97-UPGRADE-SKILL-REFRESH]] had to infer staleness indirectly from the CLI
version changing.

## Decision

**A stamp makes staleness a fact, not an inference.** Every install writes
`<dest>/.puzzle-skill-version` containing the CLI version. Missing or blank reads as
*unknown*, never an error — every pre-D99 install legitimately has none, and unknown
sorts with stale, which is the safe default. Plain text, not JSON: there is no second
field.

**Consent is asked where the destination is real, and only there.** Selected targets
classify four ways — missing (install), stamp matches (skip, already current), real
but stale/unstamped (ask), symlink (report, skip). Only the stale bucket needs an
answer.

**Declining skips the conflicts and still installs the rest.** The pre-flight was
all-or-nothing because it produced an *error*, and a partially-written error is worse
than none. A prompt is not an error: answering "no" about `~/.codex` says nothing
about `~/.cursor`, which has no skill to protect.

**Symlinked destinations are never offered.** D97 established that a symlinked
`<root>/skills/puzzle` is a dev checkout link; `add` now applies the same rule, so a
routine "yes" cannot rewrite files in someone's working tree. `--overwrite` still
writes through — explicit intent, and D97's re-exec depends on that shape.

**Non-TTY keeps the refusal, verbatim.** A script that did not say `--overwrite` must
not clobber (the D32/D77/D78 never-prompt-never-hang rule). One behavior does change:
an install whose stamp already matches is no longer a conflict, so `puzzle add skills`
is now idempotent in CI instead of failing on its own previous run.

**`puzzle upgrade skills` installs from THIS binary — no version check, no re-exec.**
It is the mirror image of D97's post-upgrade path and must be separate code for that
reason: there, a newer binary exists on disk and the running process provably holds a
stale payload, so the install has to be re-exec'd; here nothing was upgraded, so the
running CLI is the correct source and checking the registry would be pointless. It
refreshes only existing installs (D97's rule) and, unlike `add`, installs on a non-TTY
without prompting — the command names the clobber, so it is the request rather than a
side effect.

**Reinstalling replaces the tree instead of merging into it.** `installSkillTree`
removes a real destination before copying, so a file the newer payload dropped cannot
survive to contradict the current release — the D97 failure mode one level down. A
symlinked destination is written through and never removed: `os.RemoveAll` on a
symlink deletes the *link*, silently converting a checkout link into a real directory.

## Alternatives rejected

- **Declining aborts the whole command.** Matches the old pre-flight and is simpler to
  describe, but one existing install would block every fresh one — the case the prompt
  was added to fix.
- **Prompt for symlinked destinations too.** Smallest diff, and wrong on the machine
  most likely to see it: a dev whose `~/.claude/skills/puzzle` points at the checkout
  would revert the canonical source by answering "yes" from an older binary.
- **Never write through a symlink, even with `--overwrite`.** Safest in isolation, but
  it silently changes what `--overwrite` means and breaks D97's re-exec contract.
- **Prompt on a non-TTY when stdin looks answerable.** Reintroduces the hang D77/D78
  spent a rule avoiding.
- **Read the `version:` field in `SKILL.md` frontmatter instead of a stamp file.** It
  tracks the skill author's hand-maintained number, not the CLI that installed it, and
  would make Go parse YAML to learn something the writer already knew.
- **`puzzle upgrade --skills` as a flag on the existing command.** Reads as "also do
  skills while upgrading", which is already automatic; the point of the subcommand is
  refreshing *without* an upgrade.
- **Route `upgrade skills` through `runUpgrade`.** Would drag in a registry fetch, an
  install-context detection, and a re-exec, all to install bytes the process is holding.

## Consequences

- An install written before v1.62 has no stamp, so the first `add skills` after
  upgrading prompts once and stamps on the way through. Steady state after that.
- `add skills` on an all-current set prints the `--overwrite` hint. That is also how
  you re-copy an edited `skills/puzzle/` payload without bumping `version.go`, which
  matters while iterating on the skill itself.
- `.puzzle-skill-version` lands inside the installed tree, so a `--overwrite` through a
  checkout symlink drops one untracked file in the linked repo; this repo gitignores it.
- The confirm prompt is now shared by three call sites, so `confirmSkillUpdate` stays
  the single test seam D97 introduced and its description lines name the version delta.
