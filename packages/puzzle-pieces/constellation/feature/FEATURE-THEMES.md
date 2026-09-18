---
name: Puzzle themes — four palettes × three modes, appearance runtime, design-system demo
status: building
change: feature
branch: feat/pieces-themes
connections:
  - DECISION-THEMES-IN-PIECES
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
---


# Puzzle themes — four palettes × three modes, appearance runtime, design-system demo

Brief: `docs/briefs/2026-09-18-puzzle-themes.md` (the spec). Decision record: [[DECISION-THEMES-IN-PIECES]].

## Scope

- In: `registry/theme/{pieces,dim,warm,void}.css` re-tuned per Cory's palette notes with a new `medium` mode; `registry/theme/appearance.js` + `pre-paint.js`; package `exports` (`./themes/*.css`, `./appearance`, `./pre-paint`); `registry.json` `themes` + `modes`; tests (`test/themes.test.mjs`, `test/contrast.test.mjs`, `test/demo-theme-guard.test.mjs`, `test/lib/{color,roles,parse-theme}.mjs`); Sidebar piece `variant="rail"`; the demo rebuilt as a frame / rail / panel shell (`layouts/Default.pzl`, `components/docs/AppearanceSwitcher.pzl`) with `/themes/:scheme`, `/themes/compare`, `/themes/shell`, `/themes/pieces` panels and a rewritten `/theming`; README, CLAUDE.md, framework SKILL.md §Styling, CHANGELOG 0.8.0 entry.
- Out (follow-ups, each its own PR): `puzzle add theme <name>` in the Go CLI; Pyramid / Sites / account apps adopting the package; the org Puzzle app template.

## Acceptance

- `npm test` green: all four files declare the identical token set; every palette × mode passes AA on every declared pair; medium blocks cover every differing token; demo `appearance.js` and the inline pre-paint are byte-equal to the registry; no colour literals in the demo shell/themes files.
- `cd demo && npm run build` succeeds; `puzzle check` adds no errors beyond the pre-existing piece ones.
- Headless browser pass: every scheme × mode renders in the compare grid and shell view; computed `--color-surface`, `--color-surface-frame`, `--color-ink` match the CSS files; zero console errors.
