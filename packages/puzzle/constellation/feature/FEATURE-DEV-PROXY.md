---
name: Dev-server API proxy (dev.proxy)
status: built
connections:
  - COMPONENT-DEV-SERVER
  - FILE-DEV-SERVER
  - FILE-CONFIG
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D110-DEV-PROXY-PREFIX-VALIDATION
  - DECISION-D201-DEV-PROXY-CHANGE-ORIGIN
  - DOC-SPEC-BUILD
change: feature
---

# Dev-server API proxy (`dev.proxy`)

A dev-only reverse proxy so an app can use same-origin API paths (`apiURL: ''`)
with no CORS middleware and no dev/prod URL split. `puzzle dev` forwards each
configured prefix to its backend; everything else is served from `dist/`.

```js
// puzzle.config.js
export default {
	dev: {
		proxy: {
			'/api': 'http://localhost:3091',
			'/cms': { target: 'https://cms.example.com', changeOrigin: true },
		},
	},
};
```

## Contract

- **Config** ([[FILE-CONFIG]]): each key is an absolute `/`-prefixed path. Each
  value is a target URL string or Vite's object form `{ target, changeOrigin }`;
  the string is the target alone. The target is an absolute http(s) URL with a
  host, `changeOrigin` a boolean (default `false`), and other keys, Vite's
  `rewrite` among them, are ignored. An undefined or null target leaves its
  prefix unproxied ([[DECISION-D201-DEV-PROXY-CHANGE-ORIGIN]]). A `/` prefix and
  two prefixes that normalize to the same route are config errors
  ([[DECISION-D110-DEV-PROXY-PREFIX-VALIDATION]]). A trailing `/` on a prefix is
  normalized.
- **Routing** ([[FILE-DEV-SERVER]]): prefixes register on the mux (both `/api`
  and `/api/` forms, sorted) before the static catch-all, backed by
  `httputil.NewSingleHostReverseProxy`. Streaming responses (SSE) and WebSocket
  upgrades pass through.
- **No path rewriting.** A wrapped director restores the browser's path, raw path
  and query byte-for-byte; only the scheme and address come from the target. A
  path carried by the target URL is ignored.
- **Host header.** The backend gets the browser's `Host` (`localhost:<dev port>`),
  which a local backend that compares `Origin` with `Host` needs. `changeOrigin:
  true` sends the target URL's host (and written port) instead, for a backend
  that routes on `Host`, on requests and WebSocket upgrades alike. `Origin` is
  never rewritten, so under `changeOrigin` a backend with that check rejects
  unsafe requests and WebSocket connects unless it trusts the dev origin. This is
  Vite's meaning; Vite's string shorthand also implies `changeOrigin: true`,
  Puzzle's does not ([[DECISION-D201-DEV-PROXY-CHANGE-ORIGIN]]).
- **Backend down** → one log line (`proxy /api → … refused — is the backend
  running?`) and a 502 `puzzle dev: backend unavailable`.
- Config is read once at startup; edits need a restart, like every other key.
- **Dev only.** `puzzle build`, both prerender passes, and `puzzle preview`
  ignore `dev.*`.

Out, until a real app needs it: path rewriting, header injection (`Origin`,
`X-Forwarded-Host`), HTTPS termination, production proxying
([[DECISION-D08-MINIMAL-CONFIG]]).
