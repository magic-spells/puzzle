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

Theme: public sites with real pages for each language and dynamic content, plus the component composition and lifecycle support those applications need. In progress on `release/0.9.0`; Cory tags and publishes.

## Upgrade notes

- `i18n.locales` returns `{ locale, label, href, active }[]`; code needing tags maps each entry's `locale`.
- `Component` is a reserved built-in tag/family root. Rename a user component or imported tag binding named `Component`.
- No npm `0.8.1` exists; that version belongs to the independently tagged `puzzle-lang` Go module.
