---
name: 0.7.0 — in flight
status: building
version: 0.7.0
connections:
  - RELEASE-V0-6-0
  - DECISION-D76-CLI-UPGRADE
---

# 0.7.0 — in flight

Unreleased. In progress on the `release/0.7.0` branch: not published, not
tagged, and nothing in it should be described as shipped.

No theme is locked yet. The work that has landed so far is corrective rather
than additive — `puzzle upgrade` now resolves the install it is upgrading from
the running executable instead of walking up from the current directory, so a
globally installed CLI invoked inside a Puzzle app stops upgrading that app's
dependency while leaving itself stale, and a workspace root that hoisted the
binary is named and refused rather than silently treated as a global install.

Whether that stays the story depends on what else merges before the cut. Git
is the authority on what a release contains; this card only carries the intent
and the upgrade surface.

## Upgrade notes

None yet. Written when the release is cut.
