---
name: >-
  D201 — dev.proxy entries take Vite's { target, changeOrigin }; Host is the browser's unless
  changeOrigin
status: built
connections:
  - FEATURE-DEV-PROXY
  - FILE-CONFIG
  - FILE-DEV-SERVER
  - COMPONENT-DEV-SERVER
  - DECISION-D110-DEV-PROXY-PREFIX-VALIDATION
  - DECISION-D190-CONFIG-ENV
  - DOC-SPEC-ANATOMY
  - DOC-RELEASE-SURFACE
  - TEST-BUILD-AND-DEV-PIPELINE
---

# D201 — `dev.proxy` `changeOrigin`

## Context

`puzzle dev` forwards a `dev.proxy` prefix with the browser's `Host` header (`localhost:<dev port>`). A local backend that compares `Origin` with `Host` needs exactly that: Django's `CsrfViewMiddleware`, Rails' `forgery_protection_origin_check`, gorilla/websocket's default `CheckOrigin` and coder/websocket's `Accept` reject a POST (Django 403, Rails 422) or a WebSocket connect (403) whose `Origin` host differs from `Host`. A hosted backend behind a platform router, CDN or virtual host picks the site by `Host`, and answers the browser's with an error page (404, 403 or 421) or the wrong site. No single value serves both.

## Decision

- An entry is a target URL string or Vite's object form `{ target, changeOrigin }`. The string is `{ target }` and keeps the browser's `Host`. `config.validate` decodes both into one `config.Proxy { Target, ChangeOrigin }`; `dev.go` sees only that.
- `changeOrigin: true` sends the target URL's host (`url.URL.Host`: the host, and the port if one is written) as `Host`. One line in the proxy's director decides it, so plain requests and WebSocket upgrades get the same header.
- The meaning is Vite's (http-proxy-3 `setupOutgoing`, the library Vite 8 bundles): `changeOrigin` sets the outgoing `Host` to the target's host, for HTTP and WebSocket alike, and changes nothing else. `Origin` passes through, so a backend with the check above rejects unsafe requests and WebSocket connects under `changeOrigin` unless it trusts the dev origin. Puzzle documents that and does not rewrite `Origin`.
- Validation follows the loader: `target` is an absolute http(s) URL (the string form's rule and message, printing the whole entry), `changeOrigin` a boolean (`null` is unset), other keys are ignored. Only `target` and `changeOrigin` are read: Vite's `rewrite` (a function, which the config's JSON step drops) and its other options do nothing, and a path in the target URL is dropped. A target that is undefined or null skips the entry, as JSON already drops an undefined string entry, so an unset dev-only `process.env` target never fails `puzzle build` ([[DECISION-D190-CONFIG-ENV]]).
- Vite's string shorthand implies `changeOrigin: true`; Puzzle's does not. The docs say so where they show the option.

## Alternatives rejected

- **Always send the target's `Host`.** Every local backend with the Origin-versus-Host check then rejects POSTs and WebSocket connects.
- **Vite's string shorthand** (string means `changeOrigin: true`). The same always-on change for every string entry, the form a local backend is written with. It would not match Vite either: Puzzle proxies WebSocket upgrades on every entry and a Vite string entry proxies none, so it would add a WebSocket failure Vite does not have.
- **Guess from the URL** (https or a non-loopback host). Invisible to the author; a local https backend breaks the same way.
- **Rewrite `Origin` as well.** It bypasses the backend's CSRF origin check. Vite tried it inside `changeOrigin` and moved it to a separate WebSocket-only `rewriteWsOrigin`, so the name keeps one meaning in both tools.
- **`X-Forwarded-Host`.** Header injection, which [[FEATURE-DEV-PROXY]] scopes out; of the checks above only Rails reads it (Django only with `USE_X_FORWARDED_HOST`, the Go WebSocket checks never).
- **An error for an object without a target.** Catches a misspelt `target`, but fails a CI `puzzle build` that does not set a dev-only variable.
- **Stripping a written default port (`https://api.example.com:443`) to match Vite's URL parser byte for byte.** Servers compare hosts with the default port normalized away.
