---
name: "D73 — Scroll-triggered enter animations: `trigger: 'visible'` on the `in` spec (v1.40)"
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
  - DOC-VIEW-LIFECYCLE
  - DOC-USER-GUIDE
  - DECISION-D28-ANIMATIONS
verified_at: '2026-07-19T05:39:52.996Z'
verified_sha: 3dae90eb5a8830b9b9eb128a191d858a2c10216b
notes:
  - kind: verified
    text: >-
      Verified at 3dae90e (base 54f6a01 + triggerAnchor 3dae90e): full vitest 788/788 (764 baseline
      + 15 visible-trigger + 9 triggerAnchor tests, controllable fake IO + pause/play fake WAAPI),
      all Go packages ok, tsc clean — re-run by the orchestrator, not just the build agents.
      Contract spot-checked at file level: paused-WAAPI hold (animate.js playAnimation({paused})),
      shared Map<rootMargin,{io,targets:Map<Element,Set<cb>>}> registry (visibility.js —
      snapshot-iterated delivery, empty-set unobserve, empty-bucket disconnect), PuzzleView
      #deferredEnter/#useVisibleTrigger/#resolveAnchor/#abortEnter wiring incl.
      destroy-resolves-pending playIn and playOut unwind. No deviations from the card's contract.
    sha: 3dae90eb5a8830b9b9eb128a191d858a2c10216b
---

# D73 — Scroll-triggered enter animations: `trigger: 'visible'` on the `in` spec (v1.40)

The `animations.in` spec (D28, SPEC §12) gains an optional `trigger` key: `'mount'` (default — today's play-at-mount behavior, byte-identical) or `'visible'` — the enter animation holds the element at its `from` keyframe after mount and plays once when the element scrolls into the viewport, via a shared IntersectionObserver. An optional `triggerOffset` (px number or `'15%'` string) raises the trigger line above the viewport's bottom edge. Runtime-only amendment — the compiler never sees the `animations` field. See [[DOC-SPEC]] §39.

## Context

Long marketing/long-form pages want per-section reveal-on-scroll — the single most common animation pattern the `animations` field could not express: every enter played immediately at mount, so below-the-fold components animated unseen. The project owner had already built `@magic-spells/scroll-trigger` (an IntersectionObserver scroll-spy for section/nav tracking, with a per-element trigger-line-offset-from-viewport-bottom model) and asked for the capability as a framework-integrated trigger mode on the EXISTING in/out system, not a userland recipe.

## Decision

**Spelling: `trigger` lives on the `in` spec, not at the `animations` level.** Triggering is a property of the enter phase — `out` can never be visibility-triggered (its element is leaving). A spec key keeps each phase self-contained and costs nothing when absent (`playAnimation`'s validity check ignores unknown keys). A `trigger` key on `out` warns once and is ignored.

**Hold via a paused WAAPI animation, not inline styles.** At `playIn()` time the animation is created and immediately paused at time 0 — `fill: 'both'` holds the `from` keyframe, so the element renders in its from-state with no flash of natural-state content, reusing the exact keyframe pipeline (and its cancellation semantics) rather than duplicating style application.

**One shared IntersectionObserver per distinct rootMargin** (module registry in `client-runtime/views/visibility.js`), threshold 0; `triggerOffset` maps to `rootMargin: '0px 0px -<offset> 0px'` — the trigger-line model adopted from scroll-trigger. Auto-disconnects when its last target disarms.

**The `viewWillShow`/`viewDidShow` pair defers to bracket the actual reveal.** The §12 contract is that the hooks bracket the enter; splitting the pair (will at mount, did at reveal) would break it. `mounted()` timing is unchanged. Reveal is once per mount (the existing `#playedIn` semantics — scrolling away and back does not replay; keyed remount is the re-reveal idiom). `playIn()`'s promise stays pending until reveal or destroy — safe because every caller (ViewManager mount chain, router `#playInLogged`) is fire-and-forget; `destroy()` disarms the observer and resolves it.

**Anchored group reveals: `triggerAnchor: '<selector>'`, ancestors only.** The child observes `this.element.closest(selector)` (resolved once at arm time) instead of its own root, so a whole section fires as one unit when the SECTION crosses the trigger line; per-child `delay` choreographs the group. Ancestor-only (vs AOS's any-element anchors) is deliberate: an ancestor's lifetime contains the child's, so a torn-down anchor implies torn-down children — no dangling-anchor bookkeeping. The registry holds multiple callbacks per observed element (`Map<Element, Set<cb>>`), still one shared observer per rootMargin. No `closest` match → warn once, fall back to the own root. The anchor needs no declaration of its own — any ancestor element with a matching selector, typically the parent component's root; a parent may independently carry its own `'visible'` animation. `{#for}` rows share one class/spec and so reveal together with identical timing; a per-index stagger knob is deferred until demand.

**Content is never stranded hidden — every degradation lands on `'mount'` behavior:** no `IntersectionObserver` global (jsdom, ancient browsers) → play at mount; `prefers-reduced-motion` → no hold at all, content renders immediately with the existing zeroed-duration posture; unknown `trigger` value or malformed `triggerOffset` → warn once per spec object and fall back; WAAPI create/pause/play throwing → instant reveal. Destroy-before-reveal skips the hooks (the existing destroyed-mid-enter rule).

## Alternatives rejected

- **Depending on `@magic-spells/scroll-trigger` as the engine** (morph-engine-style optional peer): its scroll-spy semantics — one active section at a time, throttled index-change callbacks — mismatch per-element independent reveal, and a core declarative spec key can't hinge on an optional install. The raw shared-IO core is ~a hundred lines with zero dependencies (the runtime's no-dependency rule); scroll-trigger's offset model survives as `triggerOffset`, and the package remains the userland tool for scroll-spy/nav sync.
- **CSS scroll-driven animations (`animation-timeline: view()`)** — cross-browser support is not there, and it bypasses the WAAPI engine, hooks, and reduced-motion handling the runtime already owns.
- **A third `animations.visible` key** — it's not a new phase, it's a different trigger for the same enter; two specs for one phase invites divergence.
- **Replaying on every viewport re-entry** — fights the once-per-mount `#playedIn` contract and the fill-release handback; reveal libs that replay do so because they have no lifecycle to anchor to.
- **Firing `viewWillShow` at mount and `viewDidShow` at reveal** — splits the bracketing pair §12 promises; a hold is not an enter in progress.
- **Restricting to components (rejecting routed views/layouts)** — a routed view is normally in-viewport at mount so `'visible'` just plays immediately; harmless, not worth a special case (the D65 don't-restrict-document posture).

## Consequences

Runtime-only: `PuzzleView.playIn()` branch + new `visibility.js` registry + a `paused` option on `playAnimation` + `types/index.d.ts`; compiler, ViewManager patch paths, router, and SSG serializer untouched. Trigger-free apps behave byte-identically. On SSG pages (§36) the static markup renders in natural state and below-fold components hold-and-reveal after takeover — the intended effect. `in.to` must still equal the natural resting style (fill-release, §12); the hold means below-fold content sits at `from` (typically invisible) until scrolled to, which is the feature — authors gate hero/above-fold content with the default `'mount'`.
