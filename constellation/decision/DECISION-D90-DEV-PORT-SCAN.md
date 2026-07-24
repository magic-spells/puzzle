---
name: D90 — `puzzle dev` scans upward for a free port; `--strict-port` opts out (v1.54)
status: built
connections:
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - FILE-DEV-SERVER
  - FEATURE-V1-54-DEV-PORT-SCAN
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

- `listenDev(port, strict)` tries `port … port+9` and returns the first
  listener that binds. The banner URL and the browser-open both read
  `ln.Addr()`, never `opts.Port` — a banner advertising the requested port
  while serving another is worse than the original failure. This also fixes
  `--port 0` (kernel-assigned), which previously printed `localhost:0`.
- A moved port prints one yellow line before the ready banner. Silent
  relocation is how people end up staring at a stale tab on 3000.
- The synchronous-bind-before-banner rule from the original implementation is
  unchanged: an exhausted scan still returns a clean error with no false
  "ready" line and no browser opened on a dead port.
- **No errno inspection.** The scan advances on ANY bind failure and surfaces
  the FIRST error once exhausted — the one for the port the author actually
  named. Matching `EADDRINUSE` would need per-OS handling (Windows reports
  `WSAEADDRINUSE`) and buys nothing: a non-in-use failure (permission,
  unavailable interface) fails identically on every candidate, so the scan
  costs a few syscalls and still reports the right error.
- `--strict-port` (and `Options.StrictPort`) binds the requested port or
  fails. Pinned ports exist on purpose — container mappings, OAuth redirect
  URIs, proxy configs — and moving silently breaks whatever depends on the
  number.

## Consequences

- Concurrent `puzzle dev` runs across examples just work; the second one lands
  on 3001.
- The scan is bounded at 10, so a machine wedged across a whole range reports a
  real error rather than walking the port space.
- `Options.Port` is now a *request*, not a guarantee. Anything that needs the
  served port must read the listener, which is what the banner and
  `openBrowser` now do.

## Alternatives rejected

- **Keep failing.** Correct but unhelpful; the author has the information to
  fix it automatically.
- **Scan by default with no notice** (silent relocation) — the moved-port line
  is the whole reason the behavior is safe.
- **`strictPort` in `puzzle.config.js`** rather than a flag — the config loads
  once per dev process and this is a per-invocation concern; the flag is where
  `--port` already lives.
- **Unbounded scan** — turns a wedged machine into a long silent stall.
