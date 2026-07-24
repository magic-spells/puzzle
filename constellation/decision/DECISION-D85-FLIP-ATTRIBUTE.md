---
name: 'D85 — FLIP keyed-reorder animation via a `flip` directive attribute (v1.51)'
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - DOC-SPEC
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D72-ELEMENT-REFS
  - FILE-VIEW-MANAGER
  - FILE-ANIMATE
  - FILE-SSG-SERIALIZER
  - FEATURE-V1-51-FLIP
verified_at: '2026-07-24T06:55:20.417Z'
verified_sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
notes:
  - kind: verified
    text: >-
      Re-verified at 1400ec6 to cover the D89 amendment (per-app flip.js inclusion via
      component-props-aware AST scan) appended to this card's body — prior stamp (df909f7) predated
      that section.
    sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
---

# D85 — FLIP keyed-reorder animation via a `flip` directive attribute (v1.51)

Keyed list rows opt into FLIP (First, Last, Invert, Play) position animation
with a plain `flip` attribute — bare, or `flip={ flipOptions }` with the
options object built in `data()` (template expressions do not admit inline
object literals, SPEC §6) — on the keyed row root. Retained elements that MOVE during keyed
reconciliation animate from their old visual position to their new one;
inserts and removes keep their existing enter/leave paths. Closes the
"FLIP animations for keyed reorders" entry on the project's deferred list.
See [[DOC-SPEC]] §46.

## Context

Puzzle animates views in/out (§12), skeletons (§16), scroll-triggered enters
(§39), and cross-view morphs (D55) — but an element that stays mounted and
merely moves because its keyed list was sorted/filtered jumps instantly to its
new coordinates. FLIP is the standard fix: measure before, patch, measure
after, and animate the delta as a transform while the DOM already sits in its
final order (accessibility order, hit testing, and layout stay truthful; only
the paint is deferred).

## Decision

**A directive ATTRIBUTE, not a directive NAMESPACE.** The prompting proposal
wanted Svelte-shaped `animate:flip` syntax — a new template grammar family
that ripples through the parser, codegen, goldens, three editor grammars, and
the eslint/prettier plugins that vendor the section splitter. A plain `flip`
attribute parses TODAY (static valueless / dynamic attr) and simply joins
`key`/`island`/`ref` in the framework-directive strip lists (`setAttr`/
`removeAttr` and the SSG serializer) — it never reaches the DOM or prerendered
HTML. Zero compiler change; validation is a runtime warn-once when `flip`
sits on an unkeyed row (mirroring the duplicate-key warning). **Rejected:**
`animate:flip`.

Runtime rules (a small `views/flip.js`, integrated only in the keyed
reconciliation path):

- First-measure runs after pairing and BEFORE the removal pass (removals
  reflow); rects include live transforms, so a rapid re-reorder measures the
  true mid-flight visual position, then cancels the prior Puzzle FLIP (a
  WeakMap tracks only our animations — foreign WAAPI animations are never
  touched).
- Translation only in v1 (no width/height scaling); deltas under 0.5px skip;
  a pre-existing base transform is composed under the correction and restored
  untouched.
- Defaults `250ms` / `cubic-bezier(0.2, 0, 0, 1)`; malformed options fall
  back to defaults. Animation state is fully released on settle so author CSS
  stays authoritative.
- `prefers-reduced-motion` and missing WAAPI mean ZERO measurement work — and
  a list with no `flip` attrs (or unchanged order) costs nothing beyond one
  cheap scan of the already-built pair list.
- Inserted rows keep the existing enter path; leavers keep the existing
  out-animation/`leavingEls` path and are never FLIP candidates. No wrapper
  elements, no vnode-identity changes.

## Consequences

- Sorting/filtering/moving keyed rows gains spatial continuity with one
  attribute; the identity system stays the existing loop key — no second
  identity mechanism.
- Simultaneous author-controlled transform ANIMATIONS on the same element can
  conflict (documented; a wrapper element is the escape hatch). Static
  transforms are safe.
- The directive strip lists are the one cross-cutting touch: `flip` must be
  stripped everywhere `key`/`island`/`ref` are.

## Alternatives rejected

- `animate:flip` directive namespace — grammar/tooling ripple for identical
  runtime behavior (above).
- Loop-level opt-in (`{#for … flip}`) — the animated element is the row root,
  and per-element attrs are where `key` already lives; a loop-level flag would
  be a second place to look.
- FLIP for inserts/leavers — both already have owned animation paths (§12);
  double-driving them is how frameworks get ghost elements.

## Amended by D89 — per-app inclusion

[[DECISION-D89-FEATURE-USAGE-TREESHAKE]] makes `flip.js` conditional: the
compiler's usage scan matches a `flip` attribute in the template AST and emits
`__PUZZLE_HAS_FLIP__`, so an app with no `flip` anywhere never bundles the
module. Detection spans element attrs, **component props**, and slot children —
a component vnode's props ARE its attrs (`ViewNode` `get props()`), so
`<PostCard … flip>` is a real flip row (examples/blog) and an element-only scan
would silently drop the module and kill the animation.

D85's "zero compiler change" property is what makes this safe: `flip` is a
framework directive that never reaches the DOM, so it is visible in the template
AST and nowhere else — an exact static signal, not a heuristic.
