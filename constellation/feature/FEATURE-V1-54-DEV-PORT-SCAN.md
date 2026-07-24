---
name: v1.54 — dev server port scan + `--strict-port` (D88)
status: built
connections:
  - DECISION-D90-DEV-PORT-SCAN
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - FILE-DEV-SERVER
---

`puzzle dev` binds the first free loopback port at or above `--port` instead of
failing on a busy one, prints a notice when it moves, and reports the bound port
everywhere. `--strict-port` keeps bind-or-fail. Ship
[[DECISION-D90-DEV-PORT-SCAN]].

## Scope

- In (Go): `internal/dev/dev.go` — new `listenDev(port, strict)` (bounded scan,
  `portScanLimit = 10`, first-error-wins) and `boundPort(ln, fallback)`; Serve
  reads the bound port for the banner URL, `openBrowser`, and `httpSrv.Addr`,
  and logs one warning line when the port moved. `Options.StrictPort` added.
  `cmd/puzzle/main.go` — `--strict-port` flag; `--port` help notes the scan.
- Out: a `puzzle.config.js` `strictPort` key; LAN/host binding (still loopback
  only, no host option in v1); scanning downward or across a configured list.

## Acceptance

- Requested port used when free; scan advances past a busy one and stays inside
  the 10-port window; strict mode fails on busy with the bind error; an
  exhausted scan reports the REQUESTED port's error; `--port 0` resolves to a
  kernel-assigned port. Banner and browser-open never advertise a port that is
  not being served. Full `go test ./...` green.
