---
name: v1.32 — 0.1.0 release hardening bundle
status: verified
connections:
  - DOC-SPEC
  - DOC-MODELS
  - DOC-DATASTORE
kind: amendment
verified_at: '2026-07-15T22:04:51.554Z'
notes:
  - kind: verified
    text: >-
      Merged to main. Full verification at merge: 627 vitest, all Go packages +
      vet, 14 Playwright tests (Chromium+WebKit) including the scroll-restore regression guard,
      test:types, e2e-pack (real tarball install + build), verify-pack. Release remainders tracked
      outside this card: license text, NODE_AUTH_TOKEN secret, v0.1.0 tag.
---

The pre-0.1.0 hardening bundle (branch fix/pre-0.1.0-hardening, SPEC §35): the fifth
full-codebase review — six parallel module reviews plus an external Codex review, every
Critical/Important finding verified at file:line before fixing — followed by the fix
tranche and the npm distribution build-out. Suite 588 → 627 vitest + all Go packages.

## Three deliberate semantic changes (owner-approved pre-release, before API ossifies)

1. **Two-layer component state** (PuzzleView): `#local` (setData + created()-seeded) under
   `#model` (latest successful data() result, REPLACED wholesale per commit — omitted keys
   drop). Precedence: commit beats earlier setData; later setData beats model until the
   next commit. Ends the accumulate-forever `Object.assign(#data, model)` bag. Zero
   existing tests relied on accumulation. `_localState()` is the internal local-layer
   reader for devstate.
2. **Type-aware validation bounds** (model.js checkBound): a declared number()/date()
   field fails min/max with a type-mismatch message on wrong-runtime-type values —
   `"150"` no longer passes max(120) by string length. string()/array() keep length
   semantics; NaN/invalid Date stay incomparable passes.
3. **Persisted `_synced` provenance** (store `_serializeAll`/`_hydrateAll`): out-of-band
   `__synced` marker in the persistence wire shape; hydration restores true provenance
   (never-saved records POST after reload). Markerless old blobs → synced (back-compat).

## Correctness fixes

Runtime: schema object/array defaults deep-cloned per record (structuredClone); save
boundary — request-key identity re-check after the fetch (destroyed/replaced records
resolve detached, never re-inserted) and pk-adoption collision refusal (plain Error, both
records untouched); mounted() defers via #pendingMountHook/#completeMount to the first
LANDED commit when a prop update supersedes the initial async data(); router-owned
mount() rejections observed (#observeMount); #runPendingPush in the outer commit finally;
memory-mode go() chains sync pops via #pendingIndex (cleared at commit/failure/push/stop);
beforeUnmount thenable rejections logged; two-phase HMR restore — store transplants
BEFORE navigation #0 via `_hydrateAll(data, {replace:true})` (identity-preserving
Object.assign on duplicate pks), view-local state after mount, snapshots serialize only
the local layer; formatter fail-soft (shared decimal clamp; invalid date/locale/timezone
→ string fallback).

Compiler: empty/Vue-dotted event names are positioned errors with did-you-mean
(@click.prevent → @click:prevent; dotted custom events still legal); one-shot Build()
stages into .dist-staging-* and swaps into dist/ only after esbuild+styles+public all
succeed; scriptcollide.go warns when a template expression reads a <script>-imported
name (LexSkip-aware textual import scan, out-of-band Result.Warnings); hasKeyAttr
MixedAttr arm; classname extraction rewritten as a LexSkip state machine
(findDefaultClass — comment/string/regex-aware, prevWasDot guard); {#svg} rejects
backslash paths.

## Distribution (the 0.1.0 on-ramp blocker)

esbuild model: bin/puzzle.js shim in @magic-spells/puzzle resolves
@magic-spells/puzzle-{darwin-arm64,darwin-x64,linux-x64,linux-arm64} from pinned
optionalDependencies and execs the binary; npm/ holds the four manifests (binaries
release-built, gitignored). Releases are published BY HAND: scripts/release-prep.mjs
asserts package.json==version.go==manifests, runs verify-pack, cross-compiles with
-ldflags version stamping, and prints the publish commands (platform packages BEFORE
the root). There is no CI publish workflow — the tag-triggered release.yml was removed
pre-0.1.0 in favor of manual publishing. No postinstall. Windows:
unsupported-but-not-hostile (shim prints the go-install fallback).

## Docs

README truthed (D66/v1.31 status, feature list, real install story); overlap + morph
marked EXPERIMENTAL for 0.1.0 (interaction-matrix risk); template-expression boundary
written into SPEC §6 as contract (lexed-not-parsed, binding forms unsupported);
PuzzleView reserved-name list in SPEC §4; §20/§22/§27/§34 amended in place.

## Deferred (from the same review, deliberately)

License decisions (resolved pre-0.1.0: MIT, everywhere — root LICENSE.txt, all five
package.json license fields, platform LICENSE.txt copies, README); Windows CI + win32
package; bundle budgets; compiler benchmarks;
concurrent-mount() promise sharing; D65 3-tier transitionMode trim; router file
decomposition; persistence write-batching; destroy()/delete() rename; scheduler
unification; belongsTo null-FK subscription gap.
