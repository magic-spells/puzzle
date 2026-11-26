---
name: Wrap @magic-spells web components; port only when wrapping can't work
status: verified
connections:
  - DOC-REGISTRY
  - DECISION-CONFIG-FIRST-API
  - DECISION-COPY-IN-DISTRIBUTION
  - FEATURE-DOM-FREE-SHEET-LIBS
notes:
  - kind: gotcha
    text: >-
      Wrap-safety has three gates beyond the patcher diffing only the attributes it rendered. (1)
      Sibling nodes: a component may set attributes and inline styles on itself or its slotted
      children, and may create ONE node the template can pre-author (dialog-panel's
      <dialog-backdrop>). A component that inserts, moves or removes nodes among template-rendered
      siblings is unsafe under a KEYED child list: patchKeyedChildren's move guard
      (nextPersistentSibling) skips only leaving elements, not foreign nodes, so it re-inserts on
      every patch. Unkeyed fixed lists survive, which is why ScrollStack works. (2) Attribute
      drivability: many components observe few or no attributes, so the wrapper drives them from
      mounted()/afterUpdate() (show()/hide()/setActiveTab()). That is fine for a few methods, and
      more glue than the port when the whole API is imperative. A wrapper can only expose callbacks
      the component actually emits. (3) Published upstream: piece.json dependencies resolve from
      npm, so an unpublished component cannot be wrapped.
  - kind: state
    text: >-
      BottomSheet: the bottom-sheet ESM bundle does not import its dialog-panel peer (sheet's does),
      so mounted() imports both packages or show() throws "panel?.show is not a function". Its snap
      is a VALUE in dvh percent, not an index. The component reflects the committed snap into its
      `snap` attribute, so the wrapper never binds that attribute: it writes it once at mount as the
      opening rung, drives it with snapTo() after, and listens for camelCase `snapChange` with
      detail { from, to }.
  - kind: state
    text: >-
      The overlay wrappers (sheet, bottom-sheet, dialog, alert-dialog) share one contract over the
      dialog-panel family: edge-triggered `open`, @show / @hide({ result, triggerElement }), close
      buttons as a real <button data-action-hide-dialog data-result>, the package imported
      dynamically in mounted(), theming through custom properties and utilities, and a #mine(event)
      target guard against nested overlays' bubbling events. Controlled `snap` (sheet index,
      bottom-sheet dvh value) is edge-triggered on the parent's value, and rungs the sheet announced
      are absorbed as echoes (test/snap-echo.test.js).
  - kind: gotcha
    text: >-
      Three framework facts every wrapper must respect. (1) Puzzle's patcher PROPS set
      (client-runtime viewManager.js: `value`/`checked`/`disabled`/`selected`/`muted`) is
      name-keyed, not tag-keyed: `value={…}` on ANY element, custom elements included, is a property
      write with NO attribute. A component that reads `getAttribute('value')` (select-option does)
      sees nothing, so set the attribute imperatively from mounted()/afterUpdate() (see
      Select.Option). `disabled={…}` on a custom element writes an expando before upgrade; it works
      only because the patcher also writes the attribute and these components observe it. (2)
      patchAttrs syncs `value` on <input>/<textarea> against the LIVE DOM property on every patch,
      so a "frozen prerender seed" re-asserts and reverts a web component that writes that field.
      Render the live (clamped) prop through an expression D147 does not auto-bind instead
      (QuantityInput's `current ?? ''`). (3) Never defer a component call with requestAnimationFrame
      to dodge an event-ordering problem: rAF does not fire in a hidden tab, so a parent-driven
      `open` stalls. Fix the ordering upstream (select-dropdown 0.3.0 defers its own outside-click
      listener) and call show()/hide() synchronously.
  - kind: state
    text: >-
      demo/package.json installs every wrapped component from npm, so `npm ci && npm run build` in
      demo/ is the smoke test against the published tarballs and their `/css` export subpaths. Its
      only working-tree link, `@magic-spells/puzzle: file:../../puzzle`, is deliberate.
  - kind: state
    text: >-
      Publish a component before wrapping it, and wrap it at that version. When the demo bumps a
      component, bump the manifest floors for it in the same commit; test/registry-deps.test.js
      fails on drift (framework D169).
  - kind: state
    text: >-
      ScrollStack does not hand-copy upstream enums. Every attribute goes through `attr()` (omit
      when unset, otherwise String), and <scroll-stack> validates and defaults its own values: it
      warns on bad pin/easing/per-view, and direction/edges/snap fall back to defaults. A new
      upstream value therefore needs no piece edit. Exception: `snap` keeps `props.snap === true ?
      'start' : props.snap || false`. attr(false) would render "false", and upstream treats any
      present snap attribute other than center/proximity as `start`, so it would turn snapping ON.
      Upstream does NOT warn on an unknown `effect`, so a typo means no effect.
    sha: 0c470749
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# Wrap @magic-spells web components; port only when wrapping can't work

## Context

The `@magic-spells` ecosystem has 15+ mature web components (dialog-panel, sheet, scroll-stack, select-dropdown, tab-group, range-slider, …) that keep shipping via npm for storefront themes and other non-Puzzle contexts. Pieces need the same behavior inside Puzzle apps. The question is whether a piece renders the real custom element or re-expresses its behavior as native `.pzl` markup.

## Decision

**Wrap the web component directly whenever possible.** A wrapper piece renders the custom element's markup around `<Children/>`, binds props to attributes, declares the npm package in `piece.json.dependencies` and its required stylesheets in `styles`, dynamic-imports the package in `mounted()` (module-scope `class extends HTMLElement` crashes Node prerender), and loads the stylesheet in `layer(components)` (`@import "@magic-spells/<pkg>/css" layer(components)`, the line `puzzle add piece` prints) so Tailwind utilities on the host still win. Upstream fixes then reach every consumer through a version bump; nothing is re-ported. ScrollStack is the exemplar.

**Port (a native `.pzl` rebuild) only when wrapping genuinely can't work** — the behavior doesn't exist as a web component, or the piece's value is token-styled form-control markup where a wrapper would cost more than it saves (Calendar-style controls). Ported pieces keep the rules that make ports workable: no `<style>` blocks, no `customElements.define`, Tailwind semantic tokens only, config-first props.

Why: a complete rewrite is a fork. Every upstream fix has to be translated by hand into a differently shaped codebase, and the translation is where bugs enter. The sheet port is the cautionary case — ~5,600 lines, larger than the ~2,100-line upstream component plus its CSS — and it deliberately rearchitected measurement, the backdrop, and dismissal acknowledgement; those were exactly where bugs appeared that never reproduced upstream.

Self-managed state is acceptable in a wrapper: the parent passes `open`, the component runs itself, and `@show` / `@hide({ result, triggerElement })` report what happened (dialog-panel's `hidden` detail carries the pressed button's `data-result`); the parent re-syncs `open` after the fact. This is a deliberate relaxation of the strict parent-owned-`open` contract for wrapped overlays.

## Alternatives

- **Native `.pzl` rebuilds for every piece** — rejected. It rests on two technical claims that do not hold: (1) "self-mutating web components fight Puzzle's reconciliation" — the patcher (`client-runtime/views/viewManager.js` `patchAttrs`) diffs only the attributes the template rendered, so host attributes and inline custom properties a component sets on itself survive, and the one injected node (dialog-panel's `<dialog-backdrop>`) is created only if the template doesn't already author it; (2) "`island` would be needed and it freezes children" — ScrollStack wraps a light-DOM custom element with reactive slotted children and no `island`. The part that is true — "the transferable IP is the behavior design, not the code" — is the argument *for* not forking the code. Sheet, BottomSheet, Dialog, AlertDialog, Command and Select are wrappers. The remaining ports (Calendar, DatePicker, the emoji pickers, …) stay until there is a reason to touch them; new pieces and any piece being reworked follow the wrap rule.
- **Copy DOM-free engine modules verbatim into `registry/lib` and rewrite only the host** — the sheet's interim approach ([[FEATURE-DOM-FREE-SHEET-LIBS]]). A half-fork: the libs stayed identical but the host seam still had to be re-ported by hand.

## Consequences

- Wrappers need the package installed and its stylesheet imported in `layer(components)`. The CLI prints both steps: the npm install from `dependencies`, the import from the manifest's `styles` (required sheets only, a peer's first). Each piece's installation section documents them too.
- Wrapped overlays self-close and notify; they don't wait for the parent to flip `open`. Piece docs must say so.
- Theming goes through the component's CSS custom properties set on the host (e.g. `--sheet-panel-background: var(--color-surface)`) plus utilities; upstream defaults should stay minimal — placement and function, not colors.
- Piece-only extras (a `top` sheet position, a grabber toggle, a close `reason`) go upstream first, not into a fork.
- [[FEATURE-DOM-FREE-SHEET-LIBS]] describes a port made under the old rule; [[DECISION-SPRING-PHYSICS]] records where engines come from now.
- Config-first APIs still follow from having no cross-component context ([[DECISION-CONFIG-FIRST-API]]); a wrapper's props simply map to attributes.
