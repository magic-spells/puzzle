---
name: >-
  D131 — The zero-production-bytes oracle is metafile attribution plus sentinel absence, never
  artifact identity
status: verified
verified_at: '2026-08-16T04:35:05.484Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL
  - DECISION-D57-HMR-STATE-RELOAD
  - DOC-SPEC-BUILD
  - FILE-DEVPERF
---

# D131 — The zero-production-bytes oracle is attribution, not artifact identity

Amends the SPEC §56 verification consequence D121 originally wrote: *"both its
raw bytes and gzip byte count must remain identical to the pre-D121 build."*
That oracle is retired. The enforced contract is now:

1. a production build's esbuild metafile attributes **zero `bytesInOutput`** to
   `client-runtime/devperf.js` (and the dev metafile attributes more than zero,
   proving the probe is live, not merely absent);
2. the production bundle contains **none** of the profiler sentinel or bridge
   request strings.

Both are asserted by `TestBuildDevDefineDCE` in
`compiler/internal/build/build_test.go`, so a missed call-site guard fails the
Go suite instead of shipping.

## Why identity was the wrong oracle, twice



- **It measured the wrong thing.** The observed four-byte gzip delta that kept
  D121 unverifiable was minified-identifier allocation drift — dead imported
  bindings perturb esbuild's global name assignment even at zero attributed
  bytes. No instrumentation was retained; the oracle could not distinguish
  "leak" from "renamed variable."
- **It could not survive the repo.** Any remembered byte count goes stale the
  moment unrelated features land (the 0.4.0 bundle legitimately grew ~1.2 KB of
  D125/D127/router-normalization weight), after which the identity check reads
  as a regression when nothing regressed. D122 had already recorded this lesson
  for its own verification ("the invariant is the identity, never an absolute
  size — re-verify by stash-and-compare"); stash-and-compare remains a valid
  spot-check convenience, but it is not the enforced contract because it needs
  a hand-built counterfactual that nothing re-runs on its own — the Go suite
  can assert attribution, but it cannot construct the without-this-change build
  an identity check would have to compare against.

## Rejected

- **Keeping identity alongside attribution** — a permanently red oracle teaches
  people to ignore oracles.
- **Pinning a recorded size with a tolerance band** — any band wide enough to
  absorb legitimate feature work is wide enough to hide a real leak; attribution
  has no band to tune.
