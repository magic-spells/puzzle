---
name: D51 — One `routerBase`, applied at the path-shape boundary in every mode
status: verified
connections:
  - DECISION-D34-HASH-ROUTING
  - DECISION-D41-SCROLL-ANCHORS-PERSISTENCE
  - DECISION-D42-MEMORY-MODE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - DOC-ROUTER
  - DOC-SPEC
  - DOC-SPEC-ROUTER
verified_at: '2026-07-12T00:15:00.443Z'
code_refs:
  - client-runtime/router/router.js
  - client-runtime/router/modes.js
  - client-runtime/app.js
---

# D51 — One `routerBase`, applied at the path-shape boundary

`routerBase: '/myapp'` serves the app under a sub-path while route definitions, `push()`, `router.current`, params and `this.route` stay base-free. See [[DOC-SPEC-ROUTER]] §23.

## Decision

- **One config, applied where the router touches the URL.** Reads strip the base after the mode's raw read; writes add it before the mode's encoding. History mode: `location.pathname` = `/myapp/user/1`. Hash mode: the fragment carries it, `#/myapp/user/1`, and the anchor convention composes (`#/myapp/docs#faq` → `/docs#faq`, [[DECISION-D41-SCROLL-ANCHORS-PERSISTENCE]]). Memory mode: **inert** ([[DECISION-D42-MEMORY-MODE]]), so one app config runs under tests.
- **App code is base-free; hrefs are not.** An `<a href>` is a real document URL (middle-click, copy link, new tab), so it carries the base (`/myapp/user/1`, or relative). The path-mode interceptor takes only same-origin URLs **under the base** and strips it on push; links outside fall through to a real navigation. Hash mode mirrors this: with a base set, only `#<base>/…` fragments and the exact `#<base>` (→ `/`) are routes.
- **Locale prefixes compose onto it** ([[DECISION-D177-LOCALE-URL-PREFIXES]]): under `i18n.routing: 'prefix'` the path-mode base is `routerBase + /<locale>` for a non-default locale (`localeBase`), composed once in the Router constructor and used for reading, writing and interception. Route matching and app paths stay locale-free; locale files, page modules and assets stay on the bare base.
- **Normalization:** a leading `/` is ensured and a trailing `/` trimmed; `''` or `'/'` means no base. A base containing `#` or `?` throws at construction. Multi-segment bases work.
- **Loaded outside the base (path mode):** warn once and route the pathname un-stripped — usually the catch-all, visible rather than silently misrouted.
- Scroll keys ride `history.state`, not the URL, so they are unaffected.

## Alternatives rejected
- Mode-specific base options, or throwing in memory mode — one config should work in every mode.
- Base-free hrefs rewritten at intercept time — breaks middle-click and new-tab.
- Reading the base from `<base href>` — implicit config the router cannot validate, with no sane hash-mode story.
