---
name: Puzzle release plan
status: verified
verified_at: '2026-07-22T00:04:04.846Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
connections:
  - DOC-SPEC
  - DOC-DECISIONS
  - DOC-RELEASE-SURFACE
  - DOC-TESTING
  - DOC-DEVELOPMENT
  - FLOW-BUILD
  - FLOW-REACTIVITY
  - TEST-TODOS-INTEGRATION
---

# Puzzle release plan

[[DOC-SPEC]] is the frozen product contract. [[DOC-DECISIONS]] records why it
changed, [[DOC-RELEASE-SURFACE]] inventories what ships, and git holds the
detailed implementation history.

## Completed foundation

The original five-phase plan is complete:

- Contract: the public API and `.pzl` grammar were frozen and backed by
  numbered decisions.
- Runtime: application, component, store/model, router, virtual DOM,
  formatter, animation, morph, development-state, and static-rendering paths
  are implemented.
- Compiler: the Go parser/code generator, esbuild plugin, style pipeline,
  public-asset handling, and static prerender path compile the real examples.
- Tooling: scaffold, dev, build, generate, add, doctor, info, platform binary
  packaging, and the internal `pzlc` compiler are implemented.
- Proof: runtime/compiler unit tests, golden output, compiled-fixture tests,
  example builds, package/type checks, and browser tests cover the release
  surface.

The todos app remains the canonical end-to-end milestone. Other examples cover
specialized syntax, routing, animation, morph, TypeScript, static output, and
showcase behavior.

## Current release phase

The codebase is preparing its first `0.1.0` npm release. Remaining work is
release operations, not feature construction:

1. Keep README, contributor guidance, and Constellation current with HEAD.
2. Run the JavaScript and Go suites and the package/type/example checks required
   by any changed surface.
3. Inspect the npm tarball and all optional platform-package metadata.
4. Publish platform packages before the root package.
5. Smoke-test install, scaffold, dev, production build, and static build from a
   clean consumer project.
6. Tag the verified release and prepare launch material.

## Release gate

Do not publish while any of these are true:

- a current doc contradicts [[DOC-SPEC]] or the shipped code;
- a built/verified Constellation card is stale against its connected FILE cards;
- integrity reports dangling connections or orphaned architectural cards;
- either `npx vitest run` or `go test ./...` fails;
- the packed package cannot drive a clean consumer project.

Historical estimates, prototype audits, and commit-by-commit progress belong in
git and [[DOC-CODE-REVIEW]], not in this live plan.
