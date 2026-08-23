---
name: Docs in the demo app now, Astro on magic-spells-site later
status: built
connections:
  - DOC-DEMO-DOCS-SITE
  - RELEASE-V0-1-0
---

# Docs in the demo app now, Astro on magic-spells-site later

## Context

The pieces need both a dev/integration harness and public documentation. Those two needs pull in different directions: the harness wants to *be* a Puzzle app that consumes pieces via the real copy-in flow; public docs want SEO, long-form content, and to live with the rest of the marketing site.

## Decision

- **Now:** documentation lives *inside* the in-repo `demo/` Puzzle app ([[DOC-DEMO-DOCS-SITE]]) — a full docs site that doubles as the dev harness and integration test bed. It dogfoods the pieces through the actual copy-in flow, so building the docs also verifies the pieces.
- **Later:** long-form public docs/component pages move to the existing `../magic-spells-site/` Astro app (partially built), alongside the rest of the `@magic-spells` marketing surface.

## Alternatives rejected

- **Docs only on magic-spells-site from the start** — rejected; an Astro site can't be the Puzzle integration harness, and the team needs a live consumer app to catch copy-in and compile regressions.
- **Demo app as the permanent public docs** — not rejected outright, but treated as interim: the demo proves the pieces; the polished public home is Astro. Which one becomes canonical is a [[RELEASE-V0-1-0]] open question.

## Consequences

- The demo is a real consumer: its `app/components/ui/` holds **copies** of registry pieces, kept in sync by hand today.
- Docs primitives (ExampleBox, CodeBlock, Toc, SideNav) are demo-only components, NOT registry pieces — see [[DOC-DEMO-DOCS-SITE]].
