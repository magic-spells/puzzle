# 0.4.0 outstanding work — handoff index

Written 2026-07-27, after the Grok pass-2 review round closed. This file and its
four siblings are **self-contained briefs for a fresh model or agent**. Each one
assumes no memory of the review round: it states the finding, proves it against
current source with real paths and line numbers, gives the decision already made
(or names the decision still owed), and lists the verification and Constellation
obligations.

## Where things stand

`fix/grok2-runtime` is pushed and open as **PR #39 ("Grok review 2 fixes")**, eight
commits off `release/0.4.0` (@5584f3c):

| SHA | Content |
|---|---|
| `926d412` | D134 capitalized composition markers (54 files) |
| `c5d8706` | Runtime hardening — C1 focus parity, C2/C3 anchor race, I5, I1, I10 |
| `942e89e` | D135/D136/D137 cards + SPEC amendments |
| `38773d8` | JS reliability — I8, I9, M9, M4, M5, M2, I6-lite |
| `a92ecbc` | SPEC notes — validate defaults, keyed leave |
| `386038d` | Go polish — M8, M17, M10 |
| `e1054fb` | Go batch — I2, I4, I15, M6, M11 |
| `1abc068` | D138 dirty-aware background loads |

Suites at the tip: **vitest 1462/1462**, full `go test ./...` green, constellation
lint 349 cards / 0 errors.

The review round itself is **done**. Everything below is what did not go into it.

## The briefs

| File | What it covers | Status |
|---|---|---|
| [`HANDOFF-D134-ECOSYSTEM-MIGRATION.md`](./HANDOFF-D134-ECOSYSTEM-MIGRATION.md) | The breaking grammar change's downstream fallout across 6 sibling repos. **Release-gating.** | Ready to execute; contains one real design problem (see below) |
| [`HANDOFF-I7-HYBRID-ROUTER-CURRENT.md`](./HANDOFF-I7-HYBRID-ROUTER-CURRENT.md) | `router.current` is `null` for the whole hybrid prerender | Designed, not started — needs a go-ahead |
| [`HANDOFF-I13-MOUNTED-THROW-POLICY.md`](./HANDOFF-I13-MOUNTED-THROW-POLICY.md) | Two different reactions to a post-paint `mounted()` throw | **Decision owed by the framework owner** before any code |
| [`HANDOFF-DEFERRED-FINDINGS.md`](./HANDOFF-DEFERRED-FINDINGS.md) | I12, I14, M1, M3, M12, M15, M16 — verified, deliberately not fixed | Each has a recommendation and a trigger for revisiting |

## Priority order

1. **D134 ecosystem migration.** This is the only item that genuinely gates 0.4.0.
   The compiler now rejects the old spellings, so every downstream `.pzl` using
   them is a hard build failure. ~55 files across `puzzle-pieces`,
   `magic-spells-puzzle-site`, `puzzle-devtools`, `puzzle-music-demo`, and
   `streakwave`.
   **Read that brief before scheduling it** — 12 of those components rely on slot
   fallback content, which D134 removed, and the replacement pattern is a small
   API design decision, not a rename.
2. **I7** — contained, low-risk, would be nice to land on the same PR.
3. **I13** — one decision, then a small change.
4. Everything in the deferred brief — post-0.4.0.

## What must happen regardless, before the release

- **Constellation stamps.** D134–D138 are `status: built`. Once PR #39 merges,
  re-read each card against the merged code and `set_verified` at the merged SHA.
  In this project `built` is a claim and `verified` means someone checked.
- **Branch cleanup.** `feat/d134-capitalized-markers` and the two agent worktree
  branches (`worktree-agent-ae024105064ae1f89`, `worktree-agent-a857f9901f89f0b3e`)
  are fully subsumed by `fix/grok2-runtime` — delete them.
- **Release notes.** 0.4.0 carries a breaking grammar change. Call it out
  explicitly with the migration table from the D134 brief. The compile errors are
  themselves the migration guide — each one names its replacement spelling.
- **Pre-release dependency sweep**, per `CLAUDE.md`: the two `go:embed`ed scaffold
  templates, `examples/*/package.json`, and `client-runtime/devtools.js`
  `FRAMEWORK_VERSION`. `npm run release:prep` asserts these now, but the scaffold
  pins need a **binary rebuild** to take effect — a JS-only republish will not
  carry them.

## Verification, for any of this work

```bash
npx vitest run           # JS runtime — 1462 passing at the branch tip
cd compiler && go test ./...
npx constellation lint   # 349 cards, 0 errors
```

Run `npm run test:types` and the example builds when the change touches types or
codegen. Report anything not run.

## Two corrections to earlier assumptions

Both were stated during the review round and are **wrong** — recorded here so
nobody re-funds them:

- *"The eslint and prettier plugins need D134 updates."* They do not.
  `puzzle-eslint/src` contains **zero** references to slot or children, and
  `puzzle-prettier/src/index.js`'s `children` identifiers are its own AST node
  arrays. Both plugins vendor only the **section** splitter (`<script>`/`<style>`/
  view), which never parsed the template grammar.
- *"The three editor grammars need D134 updates."* They do not. None of
  `puzzle-sublime`, `puzzle-vscode`, or `puzzle-zed` special-case these tags —
  they highlight capitalized tags generically, which is exactly why `<Slot/>` and
  `<Children/>` already highlight correctly. `puzzle-sublime/README.md:30` even
  documents it: *"Capitalized component tags such as `<AlbumCard />` and
  `<Slot />`"*. The only cosmetic loss is that a lowercase `<slot>` still
  highlights as a plain HTML element instead of being flagged — the compiler
  catches it, so this is not worth a grammar change.
