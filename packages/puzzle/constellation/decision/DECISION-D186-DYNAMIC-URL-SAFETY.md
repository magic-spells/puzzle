---
name: D186 — Dynamic URL binding safety
status: built
connections:
  - COMPONENT-CODEGEN
  - COMPONENT-SSG
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - DOC-RELEASE-SURFACE
  - TEST-COMPILER-CODEGEN
  - TEST-DOM-PATCHING
---

## Context

A dynamic DOM URL binding (`href={ url }`) can carry an executable scheme. Browser rendering and both prerender modes must make the same safety decision, and templates that cannot produce a script URL must not pay for the check.

## Decision

The compiler decides which values need a guard; the runtime only checks the values it is handed.

- **Which attributes.** href, src, action, formaction, xlink:href, poster, background, cite, data, codebase, manifest, longdesc, profile, usemap, srcset, imagesrcset, ping and archive, compared case-insensitively, on DOM elements only. On the SVG animation elements (`animate`, `set`, `animateMotion`, `animateTransform`) also `to`, `from`, `by` and `values`, whatever `attributeName` says: an animation can write `href`/`xlink:href` through them, and guarding all four is simpler than tracking the target. Component props and marker arguments keep their types; the component's own DOM binding checks the forwarded value.
- **Which values.** Brace-only (`href={ url }`) and mixed (`href="{ base }x"`) values. Static author-written attributes are trusted source, as are `{#raw}` markup and inline SVG assets. A mixed value whose literal head already fixes the scheme skips the guard: after the leading spaces and controls a browser strips, a character that cannot continue a scheme name (`:`, `/`, `?`, `#`, …) decides it, so `href="/users/{ id }"` and `href="mailto:{ email }"` compile without it. `&` in the head decides nothing (it may begin an entity), and list attributes always keep the guard.
- **The guard.** A guarded value compiles to `__u(value, mode)`, the compiler-support root export `urlValue`, imported only by a module that emits it. `mode` carries the compiler's facts: bit 1 = image position (data: allowed), bit 2 = candidate list (whitespace/comma separated), bit 4 = `;`-separated animation `values`. The guard decodes numeric and scheme-related named references, drops tabs and newlines, strips each entry's leading whitespace and controls, and compares case-insensitively. `javascript:` and `vbscript:` are blocked everywhere; `data:` only in image positions (img/input src; img/source/link srcset or imagesrcset; SVG image href/xlink:href; poster; background). A list is blocked whole when any entry is unsafe.
- **Blocked values** become null, so the attribute is omitted (and removed on patch). Development logs a warning; production strips it. A safe value passes through unchanged.
- **`srcdoc`.** A dynamic `srcdoc` on `<iframe>` is a whole HTML document from data, which no URL check can make safe. It is a positioned compile error unless the same iframe carries a static `sandbox` attribute without `allow-scripts` and every other `sandbox` attribute on it is one too: a repeated `sandbox` that is dynamic, mixed or allows scripts can replace the safe one at runtime. Elements take no `{...spread}`, so nothing else can set it. The message steers to adding one, or to `raw()` and its sanitizer.

The emitted render function is shared by the browser and both prerender modes, so serialization receives the same guarded values and the serializer needs no URL policy of its own.

## Alternatives rejected

- **Check every attribute in the patcher and serializer** — duplicates classification at runtime and charges URL-free apps.
- **Block every data: URL** — breaks image data.
- **Trust the scheme spelling** — misses case, entities and the controls browsers ignore.
- **Rewrite author-written literals** — static source is a separate, trusted boundary.

## Consequences

Script URLs from data never reach the DOM or prerendered HTML. Apps whose URL bindings all have a fixed literal head ship no guard. This rule covers URL attributes; it is not a sanitizer for author markup (`raw()` keeps its own allowlist, D174).
