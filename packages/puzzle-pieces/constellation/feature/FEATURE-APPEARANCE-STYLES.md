---
name: Appearance styles — Cool scheme, Dark/Dim/Mixed/Light, picker previews (0.9.0)
status: built
change: feature
branch: feat/appearance-styles
connections:
  - DECISION-SCHEMES-AND-STYLES
  - FEATURE-THEMES
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
---

# Appearance styles — Cool scheme, Dark/Dim/Mixed/Light, picker previews

Decision record: [[DECISION-SCHEMES-AND-STYLES]]. Release work for 0.9.0, branch `feat/appearance-styles` off `release/0.9.0`.

## Scope

- In: `registry/theme/dim.css` → `cool.css` with the Figma Cool values; Default, Warm and Void retuned to the Figma cells; every palette gets a dim block (replacing medium) and a mixed block; `appearance.js` / `pre-paint.js` (styles list, color-scheme per style, aliases `dim`→`cool`, `medium`→`dim`); `registry.json` `modes` + `themes`; package export `./themes/cool.css`; `appearance-picker` piece (style tiles are live miniatures of the current palette in each style, plus System); demo (copies, inline pre-paint, tokenNames, styles.css import, TokenCard/SchemePanel 4 columns, Compare 4×4, ShellMock, Theming, AppearancePickerDoc); tests; README, CLAUDE.md, CHANGELOG 0.9.0.
- Out: Pyramid / Sites adopting the new values (their own repos); the Go CLI is data-driven from `registry.json` and needed no change (its `defaultModes` fallback only applies to registries without `modes`).

## Acceptance

- `npm test` green, including 16 scheme × style AA runs and the dim/mixed shape tests; `cd demo && npm run build` clean; demo screenshots of the Appearance doc page in Default·Dark, Cool·Dim, Warm·Mixed, Void·Light.
