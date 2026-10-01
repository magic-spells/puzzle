---
name: D90 — puzzle dev / preview scan upward for a free port; --strict-port opts out
status: verified
connections:
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - FILE-DEV-SERVER
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D90 — `puzzle dev`/`preview` scan upward for a free port; `--strict-port` opts out

A busy port is not fatal: the server binds the first free loopback port at or
above `--port` (default 3000) and says so.

## Decision

- `serve.Listen(port, strict)` (`compiler/internal/serve`) tries
  `port … port+PortScanLimit-1` (`PortScanLimit = 10`). `puzzle dev` and
  `puzzle preview` (D148) both bind through it.
- The banner and browser-open read `serve.BoundPort(ln, opts.Port)`, never
  `opts.Port` — `Options.Port` is a request, not a guarantee.
- A moved port prints one yellow line before the ready banner (silent
  relocation leaves people staring at a stale tab).
- Bind happens synchronously before the banner: an exhausted scan returns a
  clean error, no false "ready", no browser opened.
- Port 0 passes through (kernel-assigned).
- **No errno inspection:** the scan advances on any bind failure and reports the
  *first* error (the port the author named). `EADDRINUSE` differs per OS, and a
  non-in-use failure fails identically on every candidate anyway.
- `--strict-port` (`Options.StrictPort`) binds exactly or fails — for container
  mappings, OAuth redirect URIs and proxy configs.

## Alternatives

- **Silent relocation** — rejected: the notice is what makes it safe.
- **`strictPort` in `puzzle.config.js`** — rejected: a per-invocation concern;
  the flag sits beside `--port`.
- **Unbounded scan** — rejected: a wedged machine becomes a silent stall.
