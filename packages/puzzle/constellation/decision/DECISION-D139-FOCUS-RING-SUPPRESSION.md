---
name: 'D139 — Focus-ring suppression on the router''s transient focus stamp'
status: verified
connections:
  - COMPONENT-ROUTER
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - DECISION-D135-REPLACE-FOCUS-PARITY
  - DOC-SPEC-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/router/router.js
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

The D93 focus stamp also cuts both focus-ring channels for its lifetime: when the router stamps its transient `tabindex="-1"`, it sets inline `outline: none !important` **and** `box-shadow: none !important`, and undoes both on the same `blur` that lifts the tabindex — a pre-existing inline value is put back exactly as found (value and priority), everything else removed outright.

## Context

D93 moves focus to the committed leaf view root after every navigation. When the navigation is keyboard-driven (Enter on a link) or comes from the browser's back/forward chrome, the UA's `:focus-visible` heuristic matches the freshly focused root and draws its outline around the **entire view** — the first user-visible complaint against D93 in practice (the stays example). App stylesheets widen the hole: a global `*:focus` rule re-draws the outline on every navigation regardless of `:focus-visible`, and Tailwind's `focus:ring-*` utilities draw the same noise through `box-shadow`, which `outline` suppression alone would not touch.

The ring is pure noise here: the stamped root is a *programmatic-only* target — `tabindex="-1"`, never a Tab stop, not keyboard-operable — so there is no action the ring could be inviting. WCAG's visible-focus requirement (SC 2.4.7) attaches to keyboard-operable interface, which this deliberately is not; the announcement and the focus position itself remain the accessibility story.

## Decision

- **Both channels, inline, `!important`.** `outline` covers the UA default and most app `:focus` rules; `box-shadow` covers ring-as-shadow frameworks (Tailwind). Inline + `!important` so no app stylesheet — including a `!important` global — can re-draw either. Two `style.setProperty` calls ride the exact stamp lifecycle D93 already owns; no injected stylesheet, no new attribute.
- **Same lifetime as the tabindex.** Suppression is applied only in the branch that stamps `tabindex="-1"` and removed in the same `{ once: true }` blur listener. Prior inline values are captured (`getPropertyValue` + `getPropertyPriority`) and restored verbatim; absent ones are removed, so the `style` attribute accumulates no debris.
- **An author-set `tabindex` still gets nothing** — D93's posture, extended to visuals: the author chose that element's focus semantics, including its ring.

## Consequences

- Every Puzzle app loses the navigation-time ring around the view root with no app CSS; the D93 live-region announcement and focus placement are untouched.
- A custom `focusBehavior` that returns a natively focusable control (an input, a button) without an explicit `tabindex` attribute has always entered the stamp branch — D93 already made it a non-Tab-stop until blur, and it now also loses its focus ring until blur. An author who wants a real control focused with its ring intact should give it an explicit `tabindex` (e.g. `"0"`), which skips the stamp entirely.
- A rerender that rewrites the root's `style` attribute while it holds focus can drop the suppression early (the tabindex attribute survives patching; inline style properties may not). Harmless — the ring can only reappear, and the blur restore is a no-op mismatch at worst.

## Alternatives rejected

- **Documenting app-level CSS** (`puzzle-view:focus { outline: none }`) — fixes each app separately while every Puzzle app has the noise by default; the framework creates this focus, so it owns the cosmetics.
- **A runtime-injected stylesheet rule** — more machinery than two inline properties, and an app's `!important` rule would still beat a non-`!important` injected one.
- **Suppressing `outline` only** — leaves the Tailwind/`box-shadow` ring channel wide open.
