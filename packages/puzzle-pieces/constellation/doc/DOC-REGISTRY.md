---
name: The registry — source of truth
kind: guide
status: built
connections:
  - PLAN-PROJECT
  - DIAGRAM-TOPOLOGY
  - DECISION-COPY-IN-DISTRIBUTION
  - DECISION-REGISTRY-SHAPED-REPO
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
---

# The registry — source of truth

`registry/` is the canonical home of every piece; everything else (the demo, the future CLI, external apps) is downstream. Its shape is deliberately conventional for a copy-in registry ([[DECISION-REGISTRY-SHAPED-REPO]]) so distribution is pure copying ([[DECISION-COPY-IN-DISTRIBUTION]]).

```
registry/
├── registry.json          # generated index aggregating every piece manifest
├── theme/pieces.css       # @theme design tokens (light + dark)
├── lib/*.js               # shared plain-JS helpers (copyable registryDependencies)
└── ui/<name>/
    ├── <Name>.pzl         # one or more component files
    └── piece.json         # per-piece manifest
```

## piece.json semantics

The manifest schema and per-field meaning live in CLAUDE.md; the load-bearing rules:
- `files` copy to `targetDir` (default `app/components/ui/`).
- `registryDependencies` are resolved **transitively**: `lib/*.js` → `app/lib/`, sibling pieces (e.g. `date-picker` → `calendar`) → their own `targetDir`.
- `dependencies` are **real npm packages, plain JS only** — `.pzl` never appears there. Morph pieces (Select, Dialog, DatePicker) list `@magic-spells/morph-engine`.
- `description` is reused verbatim as the docs subtitle, so it must read as one clean sentence.

## registry.json is generated

`registry.json` is not hand-maintained per entry — it is the aggregation of all `piece.json` manifests, pieces alphabetical, with a top-level `theme` pointer and `version`. **Regenerate it whenever a piece is added or renamed** (re-run the aggregation; lib files are represented via their consumers' `registryDependencies`, e.g. `lib/date-math.js`). Current count: **96 pieces** — keep the README and the demo shell (`Introduction.pzl`, `ComponentsIndex.pzl`) count in sync when it changes.

## theme/pieces.css is the token source

Every piece styles itself exclusively through the semantic utilities these `@theme` tokens generate (`bg-surface`, `text-ink`, `border-border`, `bg-brand`, `text-danger`, …) — no hex inside components. `pieces.css` is a **registry file**: editing token *values* here changes every consumer. It carries a light block plus a `prefers-color-scheme: dark` block (re-tuned to near-black — page `#09090b` — during the docs refactor; that dark re-tune reached every consumer). Consumers merge it into `app/styles/styles.css` after `@import "tailwindcss"`.

## lib/ convention

`registry/lib/` holds shared plain-JS helpers copied to the consumer's `app/lib/`; examples include date math for Calendar/DatePicker, panel-state helpers, document models, chart/slider math, and Code's highlight adapter. They are pulled in only via a piece's `registryDependencies` — no piece imports another piece's `.pzl`, only its lib.

Per-piece specifics are NOT catalogued here — one card per piece would drift against 96 `piece.json` descriptions + file header comments. See [[DECISION-WRAP-WEB-COMPONENTS]] and [[DECISION-CONFIG-FIRST-API]] for the conventions all pieces share.
