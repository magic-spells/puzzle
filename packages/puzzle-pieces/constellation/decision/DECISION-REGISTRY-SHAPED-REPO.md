---
name: Registry-shaped repo from day one
status: built
connections:
  - DOC-REGISTRY
  - FEATURE-ADD-CLI
  - DECISION-COPY-IN-DISTRIBUTION
---

# Registry-shaped repo from day one

## Context

Given copy-in distribution ([[DECISION-COPY-IN-DISTRIBUTION]]), the delivery mechanism is a CLI that copies files. The repo layout determines how much that CLI has to do.

## Decision

Structure the repo as a **registry from the first commit**, with deliberately **conventional `piece.json` manifests** and an aggregated `registry.json` index — so the [[FEATURE-ADD-CLI]] stays a pure *resolver + copier*, never a build tool. Each piece declares its own `files`, `registryDependencies` (transitive), `dependencies` (real npm), and `targetDir`; `registry.json` aggregates every manifest for one-fetch resolution. The token set (`registry/theme/pieces.css`) and shared `registry/lib/*.js` helpers live in the registry as first-class copyable artifacts.

## Alternatives rejected

- **A bespoke manifest format** — rejected; the conventional shape keeps the resolution algorithm (resolve deps transitively, dedupe, copy to `targetDir`) a known, boring pattern.
- **Deferring structure until the CLI is written** — rejected; building pieces into an ad-hoc layout first would force a migration later. The registry shape was paid for up front so every piece already conforms.

## Consequences

- `registry.json` is **generated** by aggregating the `piece.json` manifests — it must be regenerated when pieces are added/renamed (see [[DOC-REGISTRY]]).
- The CLI's whole job is reduced to the resolver-copier spec in [[FEATURE-ADD-CLI]].
