---
name: Public /testing and /fixtures surface
kind: integration
status: built
framework: vitest
connections:
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - DECISION-D96-FIXTURE-MOCK-TREESHAKE
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - COMPONENT-STORE
  - FLOW-ADAPTER-SYNC
  - DOC-RELEASE-SURFACE
  - DOC-TESTING
  - TEST-TODOS-INTEGRATION
---


# Public /testing and /fixtures surface

The framework dogfooding its own shipped test tooling. This is the only thing
that catches the public helpers rotting relative to the internal ones, so it is
not optional coverage.

`/testing`: `mountView` and its handle, `createTestApp` driving the real
load-then-commit pipeline in memory mode, the `settled()` convergence guard
including its bounded failure — it must throw naming the churn source rather
than hang — and the environment fakes for WAAPI and IntersectionObserver.
A second suite ports the canonical todos behavior onto these public helpers and
asserts the same outcomes as [[TEST-TODOS-INTEGRATION]].

`/fixtures`: install and uninstall leaving no patches attached, per-key merge of
mock config between the model block and the fixtures file, `setup(app)` running
at `beforeMount` before navigation zero, and argument validation. Seeding is
covered across its three call shapes, for determinism, for honoring the schema
when generating field values, for defaults and primary keys, and for wiring
`belongsTo` relations.

The mock adapter is proven here rather than with the real adapter: interception
with no network, all five default CRUD shapes, the first-save primary-key
adoption driven by a mock response, the latency knob that makes skeleton timing
developable, the failure knob that is the only supported way to make `data()`
reject on purpose, and the custom-path handler escape hatch.

Covers 5 files under `tests/`.
