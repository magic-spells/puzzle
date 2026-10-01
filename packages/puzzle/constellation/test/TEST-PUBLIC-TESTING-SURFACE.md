---
name: Public /testing and /fixtures surface
kind: integration
status: built
framework: vitest
connections:
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - COMPONENT-STORE
  - COMPONENT-TESTING
  - COMPONENT-FIXTURES
  - FLOW-ADAPTER-SYNC
  - DOC-RELEASE-SURFACE
  - DOC-TESTING
  - TEST-TODOS-INTEGRATION
---

# Public /testing and /fixtures surface

The framework dogfooding its own shipped test tooling — the only thing that
catches the public helpers rotting relative to the internal ones. Suites under
`tests/`: `testing`, `testing-todos`, `testing-i18n-isolation`,
`fixtures-install`, `fixtures-seed`, `mock-adapter`.

- **`/testing`:** `mountView` and its handle, `createTestApp` driving the real
  load-then-commit pipeline in memory mode, the `settled()` convergence guard
  (its bounded failure must throw naming the churn source, never hang), and the
  WAAPI and IntersectionObserver fakes. `testing-todos` ports the canonical todos
  behavior onto these helpers and asserts the same outcomes as
  [[TEST-TODOS-INTEGRATION]].
- **`/fixtures`:** install/uninstall leaving no patches attached, per-key merge of
  mock config between the model block and the fixtures file, `setup(app)` running
  at `beforeMount` before navigation zero, and argument validation. Seeding across
  its three call shapes: determinism, schema-honoring values, defaults and
  primary keys, and `belongsTo` wiring.
- **The mock adapter** is proven here, not with the real adapter: interception
  with no network, the five default CRUD shapes, first-save pk adoption from a
  mock response, the latency knob (makes skeleton timing developable), the
  failure knob (the supported way to make `data()` reject on purpose), and the
  custom-path handler.
