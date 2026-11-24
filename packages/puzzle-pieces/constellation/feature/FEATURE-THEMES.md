---
name: Puzzle themes — palettes, appearance runtime, design-system demo
status: verified
change: feature
branch: feat/pieces-themes
connections:
  - DECISION-THEMES-IN-PIECES
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
pr: https://github.com/magic-spells/puzzle/pull/137
notes:
  - kind: gotcha
    text: >-
      test/themes.test.mjs holds the demo's index.html to exactly one inline copy of pre-paint.js
      and one </script> in <head>, before the stylesheet: a stray second body would sit as text in
      <head> and throw on every page. An inline script ends at the first literal `</script>` even
      inside a comment, so pre-paint.js spells it `<\/script>`.
      getComputedStyle().getPropertyValue('--color-x') returns the UNRESOLVED light-dark() text; the
      demo resolves colours by applying the var to a probe element's background-color and reading
      that.
  - kind: state
    text: >-
      BottomSheet and Sheet feed their overlay from tokens:
      `[--bs-overlay-background:var(--color-scrim)]` /
      `[--sheet-overlay-background:var(--color-scrim)]` and `[--*-overlay-blur:var(--blur-sm)]`
      (8px), so the light scrim and the palettes apply. No blur token of our own is needed: Tailwind
      v4 keeps a default-theme var when any generated utility (including an arbitrary property)
      references it via var(). Dialog, AlertDialog and Command use `bg-scrim` too; Dialog and
      AlertDialog write it as `[:where(&)]:bg-scrim`, so a colour in `backdropClass` still wins. The
      `[--bs-handle-*:0px]` / `[--sheet-handle-*:0px]` zeros stay literal: zero is not a design
      value, so a token for it would be noise.
  - kind: state
    text: >-
      pieces.css has a second, type-only `@theme` block after the palette block, holding
      `--text-code` (0.8125rem / 1.25rem line-height). It sits outside the palette block on purpose:
      themes.test's token contract reads only the first `@theme` block, so cool/warm/void do not
      restate a scheme-agnostic size. Code.pzl, markdown-doc.js and rich-text-doc.js use
      `text-code`. An app with an older pieces.css lacks the token until it runs `puzzle add theme
      default`, and add-piece's stale-theme hint prints that.
    sha: 0c470749
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# Puzzle themes — palettes, appearance runtime, design-system demo

Decision record: [[DECISION-THEMES-IN-PIECES]].

## Scope


- In: `registry/theme/{pieces,cool,warm,void}.css` (four schemes × four styles: dark, dim, mixed, light); `registry/theme/appearance.js` + `pre-paint.js`; package `exports` (`./themes/*.css`, `./appearance`, `./pre-paint`); `registry.json` `themes` + `modes`; tests (`test/themes.test.mjs`, `test/contrast.test.mjs`, `test/appearance.test.mjs`, `test/demo-theme-guard.test.mjs`, `test/lib/{color,roles,parse-theme}.mjs`); Sidebar piece `variant="rail"`; the **`appearance-picker` piece** (`registry/ui/appearance-picker/`, controlled: `scheme`, `mode`, `schemes?`, `modes?`, `system?`, `@change({ scheme, mode })`; theme cards are `data-scheme`-scoped live miniatures of the shell); the demo's frame / rail / panel shell (`layouts/Default.pzl`, `components/docs/AppearanceSwitcher.pzl` = rail-foot trigger + non-modal popover over the piece) with `/themes/:scheme`, `/themes/compare`, `/themes/pieces` panels, the `/components/appearance-picker` doc page, and `/theming`; README, CLAUDE.md and the framework SKILL.md §Styling.
- Out: Pyramid / Sites / account apps adopting the package and the picker piece; the org Puzzle app template.

## Acceptance

- `npm test` green: all four files declare the identical token set; every palette × style passes AA on every declared pair; the dim and mixed blocks keep their shapes; demo `appearance.js` and the inline pre-paint are byte-equal to the registry; no colour literals in the demo shell/themes files.
- `cd demo && npm run build` succeeds; `puzzle check` adds no errors.
- Headless browser pass: every scheme × style renders in the compare grid; computed `--color-surface`, `--color-surface-frame`, `--color-ink` match the CSS files; zero console errors.
