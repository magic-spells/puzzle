---
name: Public /testing and /fixtures surface
kind: integration
status: verified
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
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Public /testing and /fixtures surface

The framework dogfooding its own shipped test tooling: the only thing that catches the
public helpers rotting relative to the internal ones. Run with
`npx vitest run tests/testing tests/fixtures- tests/mock-adapter`.

- **`/testing`** (`testing`, `testing-todos`, `testing-i18n-isolation`): `mountView` and
  its handle, `createTestApp` driving the real load-then-commit pipeline in memory mode,
  the `settled()` convergence guard (its bounded failure throws naming the churn source,
  never hangs), the WAAPI and IntersectionObserver fakes, and the `i18n` option staying
  isolated per app. `testing-todos` ports the canonical todos behavior onto these
  helpers and asserts the same outcomes as [[TEST-TODOS-INTEGRATION]].
- **`/fixtures`** (`fixtures-install`, `fixtures-seed`): install/uninstall leaving no
  patches attached, per-key merge of mock config between the model block and the
  fixtures file, `setup(app)` running at `beforeMount` before navigation zero, argument
  validation. Seeding across its three call shapes: determinism, schema-honoring values,
  defaults and primary keys, `belongsTo` wiring.
- **The mock adapter** (`mock-adapter`) is proven here, not with the real adapter:
  interception with no network, the five default CRUD shapes, first-save pk adoption
  from a mock response, the latency knob (makes skeleton timing developable), the
  failure knob (the supported way to make `data()` reject on purpose), and the
  custom-path handler.
