---
name: v0.9.0 — multilingual static sites
status: building
version: 0.9.0
connections:
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D178-AFTERUPDATE-PREV
  - DECISION-D179-STATIC-PATHS
---

# v0.9.0 — multilingual static sites

Theme: public sites with real pages for each language and dynamic content, plus the component composition and lifecycle support those applications need, and a set of small APIs (D182–D189) that let tools and agents drive a running app. Ready to publish on `release/0.9.0` (stamps bumped, CHANGELOG dated); Cory tags `v0.9.0` + `packages/puzzle-lang/v0.9.0` and publishes.

## Upgrade notes

- `i18n.locales` returns `{ locale, label, href, active }[]`; code needing tags maps each entry's `locale`.
- `Component` is a reserved built-in tag/family root. Rename a user component or imported tag binding named `Component`.
- puzzle-pieces themes are four schemes × four styles: the `dim` palette is `cool`, and `data-theme` takes `dark | dim | mixed | light` (`medium` became `dim`). Apps that copied the theme files re-copy them together with `appearance.js`, the pre-paint snippet and `appearance-picker`.
- `router.push()`/`replace()` never reject; they resolve a `NavigationResult`, so a `.catch()` on a push no longer runs.
- No npm `0.8.1` exists; that version belongs to the independently tagged `puzzle-lang` Go module.

The CHANGELOG's 0.9.0 entry carries the full "Upgrading from 0.8" checklist.

## Editor grammar follow-ups

The separate puzzle-vscode, puzzle-sublime and puzzle-zed repositories need `Component` built-in highlighting for D180. Extend Zed's self-closing whitelist to include `Component`. These grammar updates remain out-of-repo release follow-ups.
