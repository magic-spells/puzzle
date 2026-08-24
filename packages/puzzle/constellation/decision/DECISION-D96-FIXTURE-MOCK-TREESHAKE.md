---
name: D96 — Tree-shake the fixture/mock runtime out of production bundles (v1.59)
status: verified
connections:
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-STORE
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

**SUPERSEDED by [[DECISION-D98-FIXTURES-MODULE-FLAG]] (v1.61, same release — never published).** The scan/define approach had two structural hazards D98 records: a compiler older than these defines ships the whole runtime (fail-safe probes), and the conservative token scan compiles an app's own `store.seed()` seeding into production. The fixtures/mock scan bits reverted; D89's scanning stays — its `flip` half only, since [[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]] later retired the head-tags half too. Kept for rationale.

D95's fixture generator and mock adapter shipped in every production bundle. Two usage-scanned defines — `__PUZZLE_HAS_FIXTURES__` and `__PUZZLE_HAS_MOCK__` — folded them out of apps that used neither, extending D89's mechanism rather than inventing a parallel one.

## Context

D95 added `fixtures.js` and `mock.js` (~20 KB of source), imported statically by `store.js` and reachable from class methods, so esbuild retained both in production. Measured against a real production build of `examples/todos` — an app using neither feature:

```
before:  68902 raw / 22679 gzip   fixtureSeed ×10, failRate ×3, latency ×1
```

This directly contradicted D89, which shipped a whole build-time usage-scan mechanism to save **~1.4 KiB gzip** across five features. Test-only code was costing more than D89's entire win, in a framework whose stated posture is pay-for-what-you-use.

## Decision

Reuse D89's pipeline end to end: scan → manifest → esbuild defines → inlined runtime probes → DCE.

- **Two flags, not one.** Fixtures and mock are separately gated, so an app that mocks its adapter but never calls `seed()` does not pull in the generator, and vice versa. They share the seeded PRNG, so a bundle using *either* retains it.
- **The scan reaches plain `.js`/`.ts` model files, not only `.pzl`.** That is where a real app declares `static adapter = { mock: … }`, and a scan that only walked templates would miss every real usage. The DCE test declares its model in a plain `.js` file specifically to pin this.
- **The scan is conservative by design.** A false positive costs bytes; a false negative silently breaks the app. Bias toward inclusion, documented in comment.
- **Probes are spelled inline at each site.** Per the measured note in `app.js`, a shared `const` does not constant-propagate into class-method scopes and leaves dead guards in the bundle; the inline expression folds at every site.
- **Degradation is loud, never silent.** With both flags false, `seed()` and `resetFixtureSeed()` remain as throwing stubs whose message names the flag state and the cause: *"the build's usage scan found no fixture or mock usage in the project source."* A silent no-op would be the worst outcome — a test passing against an empty store.
- **`watch.go` is wired too**, so `puzzle dev`'s incremental rebuild path scans identically. A define wired only into one-shot builds would make dev and build diverge.

## Consequences

Measured after, same app:

```
after:   63317 raw / 20702 gzip   fixtureSeed ×0, failRate ×0, mulberry32 ×0
saved:    5585 raw /  1977 gzip
```

~2 KB gzip recovered — confirming the regression exceeded D89's total saving. The only residue is the throwing stubs (`resetFixtureSeed` ×2), which is the fail-loud requirement working as intended.

- D95's public API and semantics are unchanged. This decision is purely about what ships.
- The **six-direction DCE assertion** in `build_test.go` pins both eliminate *and* retain across three build fixtures (neither / seed-only / mock-only), with each failure message naming the consequence — a false negative on mock "sends the app's writes to the real endpoint."
- Unbundled Vitest has no defines, so `typeof … === 'undefined'` reads as enabled and D95's suites pass unchanged.
- A production app that genuinely declares a `mock` block still ships it; D95's warn-once remains the guard for that case.

## Alternatives rejected

- **Gating on the existing `__PUZZLE_DEV__` define** — simpler, no compiler work, but it would make a `mock` block behave differently under `puzzle dev` and `puzzle build`, silently deleting behavior someone may want for a demo or preview build. D89's usage scan gets the bytes back without that divergence.
- **One combined flag** — an app that only mocks would still pay for the generator.
- **Leaving it and recording the cost** — the regression was larger than the saving the project had just shipped machinery to achieve; documenting it would have meant knowingly shipping a net byte regression.
- **A silent no-op when compiled out** — a green test against an empty store is a worse failure than a thrown error.
