# Agent instructions

**Read [CLAUDE.md](./CLAUDE.md) before doing anything in this repo** — and
[packages/puzzle/CLAUDE.md](./packages/puzzle/CLAUDE.md) before framework work. It is the
single source of truth for agent guidance here — full project knowledge base,
architecture, release state, and working conventions. This file exists
so tools that look for AGENTS.md (Cursor, Codex/GPT, etc.) find their way there;
it intentionally duplicates nothing.

The three rules you must not skip even on a quick task:

1. **packages/puzzle/constellation/doc/DOC-SPEC.md is the frozen contract** —
   when any doc, comment, or this file's pointers conflict with it, the SPEC
   wins. Every SPEC change must be reflected in a decision card in
   packages/puzzle/constellation/decision/: a new numbered DECISION-D* card for
   a new question, or a rewrite of the card that already owns it.
2. **Read the constellation cards covering an area before changing it, and
   bring them back into line after** (packages/puzzle/constellation/ —
   decisions, features, components). That's part of "done", like updating
   tests.
3. **Run the suites before claiming success:** in `packages/puzzle`,
   `npx vitest run`, `npm run test:runtime-types` and `go test ./...` in
   `compiler/`; and `go test ./...` in `packages/puzzle-lang`.
