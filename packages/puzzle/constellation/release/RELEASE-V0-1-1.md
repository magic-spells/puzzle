---
name: 0.1.1 — init ergonomics
status: built
version: 0.1.1
connections:
  - RELEASE-V0-1-0
  - DECISION-D77-INIT-PROMPTS
---

# 0.1.1 — init ergonomics

Published 2026-07-22, the same day as 0.1.0. A patch cut immediately, because
first contact with the scaffolder turned out to be rougher than first contact
with the runtime: `puzzle init` assumed a template and a language rather than
asking. It now asks, TTY-gated so scripted use is unaffected. The datastore
took its first round of post-publish fixes alongside.

Theme: smooth the first five minutes. Nothing in the app-facing API moved.

## Upgrade notes

Drop-in. No config, template, or API changes.
