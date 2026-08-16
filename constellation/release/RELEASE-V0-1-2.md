---
name: 0.1.2 — the embedded agent skill
status: built
version: 0.1.2
connections:
  - RELEASE-V0-1-1
  - DECISION-D78-AGENT-SKILL-DISTRIBUTION
---

# 0.1.2 — the embedded agent skill

Published 2026-07-22. Puzzle is a framework agents are expected to write, so
the framework ships its own instructions: an agent skill embedded in the
binary and installable with `puzzle add skills`.

Self-contained is the whole point of it. A skill that reaches out to external
docs rots the moment a version ships without them, and an agent reading stale
guidance writes code that no longer compiles — so the skill carries everything
it needs and travels with the CLI version that understands it.

Theme: distributing knowledge, not code. The runtime and compiler are
unchanged from 0.1.1.

## Upgrade notes

Drop-in. Run `puzzle add skills` in a project to install the skill.
