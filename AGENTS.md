# Agent instructions

**Read [CLAUDE.md](./CLAUDE.md) before doing anything in this repo.** It is the
single source of truth for agent guidance here — full project knowledge base,
architecture, the v1→v1.33 changelog, and working conventions. This file exists
so tools that look for AGENTS.md (Cursor, Codex/GPT, etc.) find their way there;
it intentionally duplicates nothing.

The three rules you must not skip even on a quick task:

1. **constellation/doc/DOC-SPEC.md is the frozen contract** — when any doc,
   comment, or this file's pointers conflict with it, the SPEC wins. Every SPEC
   change requires a new numbered decision (see constellation/doc/DOC-DECISIONS.md).
2. **Read the constellation cards covering an area before changing it, and
   bring them back into line after** (constellation/ — decisions, features,
   components). That's part of "done", like updating tests.
3. **Run both suites before claiming success:** `npx vitest run` at the repo
   root and `go test ./...` in `compiler/`.
