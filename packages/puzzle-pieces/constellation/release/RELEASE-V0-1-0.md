---
name: v0.1.0 — first publish (public registry + add CLI)
status: built
connections:
  - DOC-REGISTRY
  - FEATURE-ADD-CLI
  - DECISION-COPY-IN-DISTRIBUTION
  - DECISION-DOCS-DEMO-SPLIT
---

# v0.1.0 — first publish (public registry + add CLI)

Theme: make the finished registry something an external Puzzle app can actually pull from. **Publishing = making this GitHub repo public** — no npm package. The shipped [[FEATURE-ADD-CLI]] (`puzzle add piece`, in the Puzzle Go CLI) defaults to `https://raw.githubusercontent.com/magic-spells/puzzle-pieces/main/registry`, so the flip to public activates the default registry URL directly. The earlier plan of an npm-hosted `npx @magic-spells/puzzle-pieces add` (registry embedded in a tarball) was superseded 2026-07-17; consumers by definition already have the `puzzle` CLI ([[DECISION-COPY-IN-DISTRIBUTION]]). *(Later update: the npm-transport half of that plan was re-adopted for 0.6.0 — the registry ships as the versioned `@magic-spells/puzzle-pieces` package the CLI downloads, replacing the raw-GitHub default source; the `npx …` standalone CLI remains superseded. See [[FEATURE-ADD-CLI]].)*

## Done

- All 85 pieces built, compile-verified, demo-verified; registry.json aggregated.
- `puzzle add piece` shipped and verified end-to-end against this registry.
- **MIT license** chosen and committed (`LICENSE`, Magic Spells, 2026).
- Pre-public sweep (2026-07-21): internal planning log `PLAN.md` deleted (rationale absorbed into these cards + CLAUDE.md), README rewritten around `puzzle add piece` with the true piece count, demo README de-scaffolded, competitor-library analogies removed from decision cards.

- **SHIPPED 2026-07-22.** Repo public + tagged `v0.1.0` (history NOT squashed — the pre-sweep `PLAN.md` remains visible in the initial commit; accepted). `@magic-spells/puzzle@0.1.1` and all four platform binary packages published to npm; demo de-localized (registry-resolved dep, plain `puzzle dev`/`puzzle build` scripts). Verified end-to-end as an external user: clean `npm install` + demo build via the npm wrapper binary; fresh `puzzle init` app + `puzzle add piece date-picker` against the default public registry URL (transitive calendar + `lib/date-math.js` + tokens copy) + morph-engine install + clean build.

## Post-release follow-ups

- **Public docs home undecided** — the demo docs site vs the future Astro pages on `../magic-spells-site` ([[DECISION-DOCS-DEMO-SPLIT]]).
- Docs for the CLI flow + the `diff`/`update` command ([[FEATURE-ADD-CLI]] follow-ups).

## Upgrade notes

None — first release. Consumers install nothing at runtime; they run `puzzle add piece` (or copy by hand) and get `pieces.css` tokens copied in automatically.
