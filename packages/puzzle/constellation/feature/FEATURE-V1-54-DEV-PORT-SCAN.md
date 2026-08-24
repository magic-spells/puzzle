---
name: v1.54 — dev server port scan + `--strict-port` (D90)
status: verified
connections:
  - DECISION-D90-DEV-PORT-SCAN
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - FILE-DEV-SERVER
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-2-0
change: feature
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

`puzzle dev` binds the first free loopback port at or above `--port` instead of
failing on a busy one, prints a notice when it moves, and reports the bound port
everywhere. `--strict-port` keeps bind-or-fail. Ship
[[DECISION-D90-DEV-PORT-SCAN]].

## Scope


- In (Go): `internal/serve/serve.go` — `Listen(port, strict)` (bounded scan,
  `PortScanLimit = 10`, first-error-wins, port 0 passed through) and
  `BoundPort(ln, fallback)`, shared by `puzzle dev` and `puzzle preview`
  ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]). `internal/dev/dev.go` — `Serve`
  reads the bound port for the banner URL, `openBrowser`, and `httpSrv.Addr`,
  and logs one warning line when the port moved; `Options.StrictPort`.
  `cmd/puzzle/main.go` — a `--strict-port` flag on both `dev` and `preview`;
  `--port` help notes the scan.
- Out: a `puzzle.config.js` `strictPort` key; LAN/host binding (still loopback
  only, no host option in v1); scanning downward or across a configured list.

## Acceptance

- Requested port used when free; scan advances past a busy one and stays inside
  the 10-port window; strict mode fails on busy with the bind error; an
  exhausted scan reports the REQUESTED port's error; `--port 0` resolves to a
  kernel-assigned port. Banner and browser-open never advertise a port that is
  not being served. Full `go test ./...` green.
