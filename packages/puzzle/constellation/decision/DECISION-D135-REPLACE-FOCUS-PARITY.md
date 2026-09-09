---
name: 'D135 — params-only replace() moves no focus, announces nothing (v1.64)'
status: verified
connections:
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - DECISION-D119-ROUTER-SETTLEMENT-ANNOUNCEMENT
  - COMPONENT-ROUTER
  - DOC-SPEC-ROUTER
  - FILE-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D135 — params-only `replace()` moves no focus, announces nothing (v1.64)

A `replace()` that commits through the params-only path — the committed leaf
is reused, `keep === chain.length` — passes `focus: null` into `#commitState`:
no focus move, no live-region announcement. Params-only **pushes** keep the
full focus + announcement path; full replaces (a different leaf) are
untouched.

## Context

D83's query-rewrite pattern (`router.replace('/search?q=' + v)` per
keystroke) got a scroll carve-out from day one: `#resolveScroll` leaves
replace alone by default because a filter keystroke must not jump the window.
When D93 added focus management it deliberately passed push, replace, and pop
all through — reasoned for FULL replaces (browsers restore no focus for
client-side moves) — but the leaf-identical case was never considered. Result:
the canonical D83 pattern focused the leaf root (`tabindex="-1"`) on every
character, yanking focus out of the search input, while the live region
re-announced a route the user never left. Found as C1 of the 2026-07-27
pass-2 review; the shipped test covered only a full-route replace.

## Decision

The fix lives at the COMMIT SITE, not the gate: `#resolveFocus` cannot know
`keep` when it runs, so the params-only commit branch nulls the sentinel for
replaces (`focus: replace ? null : focus`). A leaf-identical replace is
URL-backed transient-state churn — §44's own framing — not a route change:
nothing to announce, no reason to move focus. This is the exact focus half of
"replace never touches scroll by default".

- A custom `focusBehavior` is also skipped on this path (scroll parity: the
  default-vs-custom split applies to navigations that resolve focus at all).
- `#announcedTitle` intentionally does not advance here; the next real
  navigation compares against the last ANNOUNCED title and behaves correctly
  even if a params-only replace changed `document.title` meanwhile.

## Alternatives rejected

- **Gate-side fix in `#resolveFocus`** — the gate runs before `keep` exists;
  threading chain-reuse knowledge into it duplicates commit-site state.
- **Announce-but-don't-focus** — announcing a route the user is already on,
  per keystroke, is live-region spam; D119 already establishes announce-on-
  change-only.

Amends SPEC §51 (D93/D119).
