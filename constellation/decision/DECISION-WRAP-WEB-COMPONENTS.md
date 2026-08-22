---
name: Wrap @magic-spells web components; port only when wrapping can't work
status: built
connections:
  - DOC-REGISTRY
  - DECISION-CONFIG-FIRST-API
  - DECISION-COPY-IN-DISTRIBUTION
  - FEATURE-DOM-FREE-SHEET-LIBS
notes:
  - kind: gotcha
    text: >-
      Wrap-safety criteria sharpened by the 2026-08-22 registry-wide survey
      (notes/2026-08-22-wrap-candidates-assessment.md, §2). The attribute-diff fact is necessary but
      not sufficient. Three more gates: (1) SIBLING-NODE RULE — a component may set
      attributes/inline styles on itself or on slotted children freely, and may create ONE node the
      template can pre-author (dialog-panel's <dialog-backdrop>); but a component that
      inserts/moves/removes nodes AMONG template-rendered siblings is unsafe under a KEYED child
      list — patchKeyedChildren's move guard (puzzle client-runtime/views/viewManager.js ~L1169,
      nextPersistentSibling ~L1188) skips only mid-leave elements, not foreign nodes, so it
      re-inserts on every patch. Unkeyed fixed lists survive (that is why ScrollStack works).
      tarot-puzzle/docs/PUZZLE-FRICTION.md is independent prior art. (2) ATTRIBUTE-DRIVABILITY —
      most @magic-spells components have no usable observedAttributes (dialog-panel, dropdown-panel,
      tab-group, select-dropdown declare none); a wrapper then drives them imperatively from
      mounted()/afterUpdate() (show()/hide()/setActiveTab()), which is fine for a few methods
      (sheet/dialog) and 'more glue than the port' when the whole API is imperative. A wrapper can
      only expose callbacks the component actually emits. (3) PUBLISHED UPSTREAM — piece.json
      dependencies resolve from npm, so an unpublished component (range-slider, notification-stack,
      date-picker, tarot pkgs, color-picker at the time of the survey) cannot be wrapped at all.
      Also: the demo pins some wrappers to file:../../<repo>, so a green demo build does not prove
      the npm tarball works — smoke against the published version before shipping.
  - kind: state
    text: >-
      2026-08-22 (phase 2, feat/sheet-wrapper, uncommitted): bottom-sheet is now a wrapper too —
      registry/ui/bottom-sheet/BottomSheet.pzl renders dialog-panel > dialog >
      bottom-sheet(-header/-content/-footer) from @magic-spells/bottom-sheet, replacing the
      1,123-line port and sheet-math.js. Two gotchas the sheet conversion did not hit: (1) the
      bottom-sheet ESM bundle does NOT side-effect-import its dialog-panel peer (sheet's does), so
      mounted() must dynamically import BOTH packages or show() throws "panel?.show is not a
      function"; (2) its snap API is a VALUE in dvh percent, not an index — the component reflects
      the committed snap back into the snap attribute, so the wrapper never binds that attribute (it
      writes it once at mount as the opening rung and drives it with snapTo() after), and the event
      is camelCase snapChange with detail { from, to }. Upstream gap found in the browser: published
      bottom-sheet 2.0.2 still paints its scrim on dialog::backdrop and its display:none rule for
      dialog-backdrop loses on specificity to dialog-panel 2.0.1's [state='shown'] rule, so two
      overlays paint at once (cosmetic; fixed on the component's main branch, which needs a 2.0.3
      publish).
---

# Wrap @magic-spells web components; port only when wrapping can't work

## Context

The `@magic-spells` ecosystem has 15+ mature web components (dialog-panel, sheet, scroll-stack, select-dropdown, tab-group, range-slider, …) that keep shipping via npm for Shopify themes and other non-Puzzle contexts. Pieces need the same behavior inside Puzzle apps. The question is whether a piece renders the real custom element or re-expresses its behavior as native `.pzl` markup.

## Decision (2026-08-22)

**Wrap the web component directly whenever possible.** A wrapper piece renders the custom element's markup around `<Slot/>`/`<Children/>`, binds props to attributes, declares the npm package in `piece.json.dependencies`, dynamic-imports the package in `mounted()` (module-scope `class extends HTMLElement` crashes Node prerender), and documents the stylesheet import (`@import "@magic-spells/<pkg>/css" layer(components)`) so Tailwind utilities on the host still win. Upstream fixes then reach every consumer through a version bump; nothing is re-ported. ScrollStack is the exemplar.

**Port (a native `.pzl` rebuild) only when wrapping genuinely can't work** — the behavior doesn't exist as a web component, or the piece's value is token-styled form-control markup where a wrapper would cost more than it saves (Calendar-style controls). Ported pieces keep the rules that make ports workable: no `<style>` blocks, no `customElements.define`, Tailwind semantic tokens only, config-first props.

Why: a complete rewrite is a fork. Every upstream fix has to be translated by hand into a differently shaped codebase, and the translation is where bugs enter. The sheet port is the cautionary case — ~5,600 lines, larger than the ~2,100-line upstream component plus its CSS — and it deliberately rearchitected measurement, the backdrop, and dismissal acknowledgement; those were exactly where bugs appeared that never reproduced upstream.

Self-managed state is acceptable in a wrapper: the parent passes `open`, the component runs itself, and `@show` / `@hide({ result, triggerElement })` report what happened (dialog-panel's `hidden` detail carries the pressed button's `data-result`); the parent re-syncs `open` after the fact. This is a deliberate relaxation of the strict parent-owned-`open` contract for wrapped overlays.

## Alternatives

- **Native `.pzl` rebuilds for every piece** — the original rule (2026-07 → 2026-08-22), abandoned. It rested on two technical claims that did not hold up: (1) "self-mutating web components fight Puzzle's reconciliation" — the patcher (`client-runtime/views/viewManager.js` `patchAttrs`) diffs only the attributes the template rendered, so host attributes and inline custom properties a component sets on itself survive, and the one injected node (dialog-panel's `<dialog-backdrop>`) is created only if the template doesn't already author it; (2) "`island` would be needed and it freezes children" — ScrollStack (2026-08-19, the first wrapper) wraps a light-DOM custom element with reactive slotted children and no `island`. The part that stayed true — "the transferable IP is the behavior design, not the code" — is the argument *for* not forking the code. Existing ports (Select, Dialog, DatePicker, BottomSheet, …) stay as they are until there is a reason to touch them; new pieces and any piece being reworked follow the wrap rule. Sheet is the first scheduled conversion.
- **Copy DOM-free engine modules verbatim into `registry/lib` and rewrite only the host** — the sheet's interim approach ([[FEATURE-DOM-FREE-SHEET-LIBS]]). A half-fork: the libs stayed identical but the host seam still had to be re-ported by hand.

## Consequences

- Wrappers need the package installed (the CLI prints the npm install) and its stylesheet imported in `layer(components)` — two consumer steps, documented in each piece's installation section.
- Wrapped overlays self-close and notify; they don't wait for the parent to flip `open`. Piece docs must say so.
- Theming goes through the component's CSS custom properties set on the host (e.g. `--sheet-panel-background: var(--color-surface)`) plus utilities; upstream defaults should stay minimal — placement and function, not colors.
- Piece-only extras (a `top` sheet position, a grabber toggle, a close `reason`) go upstream first, not into a fork.
- [[DECISION-SPRING-PHYSICS]] and [[FEATURE-DOM-FREE-SHEET-LIBS]] describe ports made under the old rule; they remain accurate history for those pieces.
- Config-first APIs still follow from having no cross-component context ([[DECISION-CONFIG-FIRST-API]]); a wrapper's props simply map to attributes.
