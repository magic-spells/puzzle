---
name: 'D90 — puzzle dev / preview binding: upward port scan, --strict-port, --host'
status: verified
connections:
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - FILE-DEV-SERVER
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D90 — `puzzle dev`/`preview` binding: upward port scan, `--strict-port`, `--host`

A busy port is not fatal: the server binds the first free port at or above
`--port` (default 3000) and says so. It binds loopback unless `--host` asks for
more.

## Decision

- **Port scan:** `serve.ListenHost(host, port, strict)`
  (`compiler/internal/serve`; `Listen` is the default-host form) tries
  `port … port+PortScanLimit-1` (`PortScanLimit = 10`). `puzzle dev` and
  `puzzle preview` (D148) both bind through it.
- The banner and browser-open read `serve.BoundPort(ln, opts.Port)`, never
  `opts.Port` — `Options.Port` is a request, not a guarantee. A moved port
  prints one yellow line before the ready banner.
- Bind happens synchronously before the banner: an exhausted scan is a clean
  error, no false "ready", no browser opened. Port 0 passes through.
- **No errno inspection:** the scan advances on any bind failure and reports the
  *first* error (the port the author named). `EADDRINUSE` differs per OS, and a
  non-in-use failure fails identically on every candidate anyway.
- `--strict-port` (`Options.StrictPort`) binds exactly or fails — for container
  mappings, OAuth redirect URIs and proxy configs.
- **`--host`:** omitted → `127.0.0.1`, banner says `localhost`. Bare `--host`
  (or `0.0.0.0`/`::`) binds every interface and the banner adds a Network URL
  per non-loopback, non-link-local IPv4 address. Any other address is bound and
  printed as itself, never as localhost. The port scan and `--strict-port` apply
  to whichever host is bound.

## Gotchas

- pflag gives an optional value only to `--host=<v>`. `normalizeHostArgs`
  (`cmd/puzzle/serveflags.go`) rewrites `--host <ip>` to `--host=<ip>` before
  parsing, but only for the token **immediately** after a bare `--host`, and
  only when it is an IP literal or `localhost` — even if a directory of that
  name exists, since falling back to `0.0.0.0` would bind wider than asked.
  Hostnames need `--host=<name>`; a bare `--host` followed by a stray word is
  reported as that mistake. An explicit `--host=<addr>` is never overridden.

## Alternatives rejected

- **Silent relocation** — leaves people staring at a stale tab.
- **`strictPort` in `puzzle.config.js`** — a per-invocation concern; the flag
  sits beside `--port`.
- **Unbounded scan** — a wedged machine becomes a silent stall.
