---
name: 0.7.0 — in flight
status: building
version: 0.7.0
connections:
  - RELEASE-V0-6-0
  - DECISION-D76-CLI-UPGRADE
notes:
  - kind: state
    text: >-
      D161 auto-fetching-finds round verified post-merge on the release branch: both suites green,
      and the five round cards (D161, D21, D49, D158, the v1.76 feature) re-verified and stamped,
      with staleness corrected in place. Still open for ship: the matching pieces 0.7.x publish,
      release prep, and the prose sweep — note the CHANGELOG's "fixture-driven apps are untouched"
      clause is wrong (installFixtures() installs the capability, so fixture apps fault through the
      mock) and needs the same correction the cards got.
---

# 0.7.0 — in flight

Unreleased. In progress on the `release/0.7.0` branch: not published, not
tagged, and nothing in it should be described as shipped.

The centerpiece so far is v1.76 auto-fetching finds
([[FEATURE-AUTO-FETCHING-FINDS]] / [[DECISION-D161-AUTO-FETCHING-FINDS]] —
breaking: the One/Many verb rename with loud guards, generated read failures
normalized to `PuzzleAdapterError`, and the static read-state island). Also
in: the D76 correction that resolves `puzzle upgrade` from the running
executable instead of walking up from the current directory, so a globally
installed CLI invoked inside a Puzzle app stops upgrading that app's
dependency while leaving itself stale, and a workspace root that hoisted the
binary is named and refused rather than silently treated as a global install.

Git is the authority on what a release contains; this card only carries the
intent and the upgrade surface.

## Upgrade notes

None yet. Written when the release is cut.
