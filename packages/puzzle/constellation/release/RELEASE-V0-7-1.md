---
name: 0.7.1 — the truth after the ship
status: built
version: 0.7.1
connections:
  - RELEASE-V0-7-0
  - DECISION-D76-CLI-UPGRADE
  - DOC-USER-GUIDE
  - FLOW-RELEASE
notes:
  - kind: state
    text: >-
      0.7.1 was never published or tagged. All four items merged, and they ship folded into 0.8.0
      ([[RELEASE-V0-8-0]]); the 0.8.0 CHANGELOG entry carries them. `release/0.7.1` is kept for
      history only. No `v0.7.1` tag will exist.
---

# 0.7.1 — the truth after the ship

In progress on `release/0.7.1`: not published, not tagged, and nothing in it
should be described as shipped. npm `latest` is [[RELEASE-V0-7-0]].

A patch release with no new framework surface. Its theme is the gap 0.7.0's
publish exposed: the release train was correct about its own packages and wrong
about everything **underneath** them. `add piece` installs pieces whose web
components are declared by bare name, so npm resolved `latest` and the eight
components the D167 families were built against had to be published by hand,
in the right order, before the release could go out at all. Nothing in the
pipeline knew that, so nothing checked it. The rest of the release is the
paperwork a shipped version earns.

## What's planned

- **Release-state truthing.** `CLAUDE.md`, [[PLAN-PROJECT]], and the release
  cards record 0.7.0 as published — the date, the `verify:published` result,
  the first Windows platform package, the eight component publishes and the
  lesson they carry, and the post-review PRs (#127–#130). The 0.7.0 card's
  "Still open before ship" section is closed out.
- **The user guide's Quick Start.** [[DOC-USER-GUIDE]] still opened on
  `npx @magic-spells/create-puzzle-app my-app` with a note that the wrapper was
  "not yet published". It never will be: the wrapper is retired under
  [[DECISION-D77-INIT-PROMPTS]] and the local draft is deleted.
  `npm install -g @magic-spells/puzzle` then `puzzle init my-app` is the only
  onboarding path, and the guide now mirrors the README's own Quick Start.
- **D169 — registry version floors.** A piece manifest gains a way to declare
  the minimum version of each web component it needs, so `add piece` installs
  something that builds instead of whatever npm's `latest` happens to be. This
  is the mechanism that makes the 0.7.0 publish prerequisite a check rather
  than a habit. Written by a separate lane.
- **A D76 amendment to the update notice.** [[DECISION-D76-CLI-UPGRADE]]
  owns the notification and `puzzle upgrade`; the notice's behavior changes
  here, so that card is rewritten in place rather than superseded.

## Upgrade notes

None expected. A patch release with no framework API change: an app on 0.7.0
upgrades by bumping the dependency. If D169 lands as planned, existing
`pieces.lock` files stay valid and the floors apply to the next `add piece`.
