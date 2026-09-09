---
name: D90 — `puzzle dev` scans upward for a free port; `--strict-port` opts out (v1.54)
status: verified
connections:
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - FILE-DEV-SERVER
  - FEATURE-V1-54-DEV-PORT-SCAN
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

A busy dev port is no longer fatal. `puzzle dev` binds the first free loopback
port at or above `--port` (default 3000), scanning at most 10 candidates, and
reports the port it actually bound. `--strict-port` restores bind-or-fail.

## Context

The dev server bound `127.0.0.1:<port>` exactly once and returned the bind
error, so a second `puzzle dev` — a stale server, another example, any unrelated
process on 3000 — died with `listen tcp 127.0.0.1:3000: bind: address already in
use` and the author had to pick a number by hand. Every comparable tool (Vite,
Next, Astro, Nuxt) scans instead; failing was the outlier.

## Decision


Scan upward, bounded, and say so.

- `serve.Listen(port, strict)` in `compiler/internal/serve` tries
  `port … port+PortScanLimit-1` and returns the first listener that binds.
  Both `puzzle dev` and `puzzle preview` bind through it (D148), so the two
  commands cannot drift on port behavior. The banner URL and the browser-open
  read `serve.BoundPort(ln, opts.Port)`, never `opts.Port` — a banner
  advertising the requested port while serving another is worse than the
  original failure, and `--port 0` (kernel-assigned) has no requested number
  to print at all.
- A moved port prints one yellow line before the ready banner. Silent
  relocation is how people end up staring at a stale tab on 3000.
- The synchronous-bind-before-banner rule is unchanged: an exhausted scan
  still returns a clean error with no false "ready" line and no browser opened
  on a dead port.
- **Port 0 is passed through untouched.** The kernel picks a free port, so the
  one attempt always succeeds and there is nothing to scan.
- **No errno inspection.** The scan advances on ANY bind failure and surfaces
  the FIRST error once exhausted — the one for the port the author actually
  named. Matching `EADDRINUSE` would need per-OS handling (Windows reports
  `WSAEADDRINUSE`) and buys nothing: a non-in-use failure (permission,
  unavailable interface) fails identically on every candidate, so the scan
  costs a few syscalls and still reports the right error.
- `--strict-port` (and `Options.StrictPort`, on both `dev` and `preview`)
  binds the requested port or fails. Pinned ports exist on purpose —
  container mappings, OAuth redirect URIs, proxy configs — and moving silently
  breaks whatever depends on the number.

## Consequences


- Concurrent `puzzle dev` runs across examples just work; the second one lands
  on 3001.
- The scan is bounded at `PortScanLimit` (10), so a machine wedged across a
  whole range reports a real error rather than walking the port space.
- `Options.Port` is a *request*, not a guarantee. Anything that needs the
  served port must read the listener, which is what the banner and
  `openBrowser` do via `serve.BoundPort`.

## Alternatives rejected

- **Keep failing.** Correct but unhelpful; the author has the information to
  fix it automatically.
- **Scan by default with no notice** (silent relocation) — the moved-port line
  is the whole reason the behavior is safe.
- **`strictPort` in `puzzle.config.js`** rather than a flag — the config loads
  once per dev process and this is a per-invocation concern; the flag is where
  `--port` already lives.
- **Unbounded scan** — turns a wedged machine into a long silent stall.
