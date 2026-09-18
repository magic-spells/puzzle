---
name: Puzzle themes — four palettes × three modes, appearance runtime, design-system demo
status: building
change: feature
branch: feat/pieces-themes
connections:
  - DECISION-THEMES-IN-PIECES
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
pr: https://github.com/magic-spells/puzzle/pull/137
notes:
  - kind: verified
    text: >-
      2026-09-18, PR #137 open against release/0.8.0 (head 88ef5f9). npm test 491/491; demo build
      clean; puzzle check adds nothing beyond the 17 pre-existing piece errors. Headless Chromium
      (own Playwright 1.63): 12 scheme×mode combos of /themes/compare and /themes/shell
      screenshotted to demo/.playwright/themes/, computed --color-surface / --color-surface-frame /
      --color-ink equal the values parsed from the CSS files (36/36), switcher click persists {
      scheme, mode }, 0 console/page errors. Min AA ratios (light/medium/dark): default
      3.57/3.11/3.79, dim 3.48/3.46/3.96, warm 3.39/3.56/3.58, void 3.43/3.93/3.89 (the 3.x floors
      are the 3:1 non-text pairs). Status stays `building` until the PR merges.
    sha: 88ef5f9
  - kind: gotcha
    text: >-
      Two traps hit in this build. (1) The inline pre-paint in demo/app/public/index.html had a
      stray second copy of its body after the closing tag — the parity test only compared the first
      block, so it passed while every page threw "missing ) after argument list"; the test now
      asserts exactly one inline copy and one </script> in <head>. Also an inline script ends at the
      first literal `</script>` even inside a comment, so pre-paint.js spells it `<\/script>`. (2)
      Puzzle drops the whitespace at a line break between an inline element and the next
      text/element, so "<span>warm</span> or\n<span>void</span>" renders as "warm orvoid" — keep
      such runs on one line. Also: getComputedStyle().getPropertyValue('--color-x') returns the
      UNRESOLVED light-dark() text; the demo resolves colours by applying the var to a probe
      element's background-color and reading that.
---

# Puzzle themes — four palettes × three modes, appearance runtime, design-system demo

Brief: `docs/briefs/2026-09-18-puzzle-themes.md` (the spec). Decision record: [[DECISION-THEMES-IN-PIECES]].

## Scope


- In: `registry/theme/{pieces,dim,warm,void}.css` re-tuned per Cory's palette notes with a new `medium` mode; `registry/theme/appearance.js` + `pre-paint.js`; package `exports` (`./themes/*.css`, `./appearance`, `./pre-paint`); `registry.json` `themes` + `modes`; tests (`test/themes.test.mjs`, `test/contrast.test.mjs`, `test/appearance.test.mjs`, `test/demo-theme-guard.test.mjs`, `test/lib/{color,roles,parse-theme}.mjs`); Sidebar piece `variant="rail"`; the new **`appearance-picker` piece** (`registry/ui/appearance-picker/`, controlled: `scheme`, `mode`, `schemes?`, `modes?`, `system?`, `@change({ scheme, mode })`; theme cards are `data-scheme`-scoped live miniatures of the shell; Pyramid's AppearancePanel / Sites' Appearance dialog ported so both can copy it in phase 2); the demo rebuilt as a frame / rail / panel shell (`layouts/Default.pzl`, `components/docs/AppearanceSwitcher.pzl` = rail-foot trigger + non-modal popover over the piece) with `/themes/:scheme`, `/themes/compare`, `/themes/shell`, `/themes/pieces` panels, `/components/appearance-picker` doc page, and a rewritten `/theming`; README, CLAUDE.md, framework SKILL.md §Styling, CHANGELOG 0.8.0 entry (0.7.1 notes folded in).
- Out (follow-ups, each its own PR): `puzzle add theme <name>` in the Go CLI; Pyramid / Sites / account apps adopting the package and the picker piece; the org Puzzle app template.

## Acceptance

- `npm test` green: all four files declare the identical token set; every palette × mode passes AA on every declared pair; medium blocks cover every differing token; demo `appearance.js` and the inline pre-paint are byte-equal to the registry; no colour literals in the demo shell/themes files.
- `cd demo && npm run build` succeeds; `puzzle check` adds no errors beyond the pre-existing piece ones.
- Headless browser pass: every scheme × mode renders in the compare grid and shell view; computed `--color-surface`, `--color-surface-frame`, `--color-ink` match the CSS files; zero console errors.
