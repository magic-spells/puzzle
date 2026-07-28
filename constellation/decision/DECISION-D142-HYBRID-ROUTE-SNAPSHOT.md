---
name: 'D142 — Hybrid prerender shadows router.current with the page snapshot'
status: built
connections:
  - COMPONENT-SSG
  - COMPONENT-ROUTER
  - DECISION-D117-STATIC-OUTPUT-HISTORY-HREFS
  - DOC-SPEC-BUILD
---

The hybrid prerender context's `router.current` is the page's frozen route
snapshot, so route-aware markup — active-nav classes, `current.path` /
`current.params` / `current.route.name` reads — prerenders in the same state
the live router renders after takeover. Both prerender modes and the live
client agree; a template reading `current` produces identical markup through
hybrid prerender, static prerender, and a started router (pinned by a
three-way parity test in `tests/static-prerender.test.js`).

## Contract

- `makeRouteSnapshot(entry)` builds for every page in both output modes
  (`ssg/index.js createPageContext`); static threads it into the throwing
  stub, hybrid shadows it onto the real Router.
- The shadow is an **own instance property** over the prototype getter —
  `Object.defineProperty(router, 'current', { value: route, enumerable: true,
  configurable: true })` — the same instance-shadowing `url()` uses, and for
  the same reason: `current` reads private fields, so a delegating facade
  would throw. `configurable: true` keeps the property redefinable.
- Hybrid still keeps the real *unstarted* memory Router (the takeover needs
  its compiled route table), and the takeover replaces the whole instance, so
  the shadow never outlives the prerender.

## Rationale

Without a committed state, every `current` read in a hybrid build rendered its
nothing-is-current branch into the shipped HTML: crawlers and no-JS visitors —
the audience hybrid output exists for — only ever saw inactive nav and missing
route-derived content, and real users saw a flash between first paint and
takeover. Static mode already threaded the snapshot; the mode mismatch was the
defect.

## Alternatives rejected

- **Starting the memory router at build time** — runs guards, hooks, and
  scroll logic in a DOM-free node pass.
- **Replacing hybrid's Router with `makeRouterStub`** — the stub throws on
  every navigation method and carries no compiled route table; the takeover
  needs both.
- **A delegating facade** — throws on private-field reads.
