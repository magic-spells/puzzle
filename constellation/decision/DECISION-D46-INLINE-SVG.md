---
name: "D46 — `{#svg 'path'}` compile-time SVG inlining (v1.14)"
status: verified
connections:
  - DECISION-D44-DOM-ISLANDS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
verified_at: '2026-07-11T04:53:45.732Z'
notes:
  - kind: verified
    text: >-
      Verified: full Go suite + 365 vitest green; end-to-end puzzle init/build/dev
      exercised ({#svg} inlined vnode in bundle, .svg-edit live reload, missing-file recovery
      covered by build/watch tests).
---

# D46 — `{#svg 'path'}` compile-time SVG inlining (v1.14)

The Shopify-snippet ergonomic for a shared icon set: `{#svg 'icons/cart.svg'}` inlines `app/assets/icons/cart.svg` at compile time as an island-frozen ([[DECISION-D44-DOM-ISLANDS]]) `<svg>` vnode with **string children** seeded once via `innerHTML`. SPEC §18.

## Context

Inline SVG is the web-app icon idiom (`currentColor` recoloring on parent hover), and pasting SVG into a template has always worked (no element whitelist; runtime `createElementNS` namespace propagation). What was missing was reuse: one file on disk, referenced by name everywhere — the `{% render 'icon-cart' %}` workflow. The vdom deliberately has no general raw-HTML node (D17's injection-safety stance), so the design had to inline without opening that door.

## Decision

- **Grammar:** `{#svg '<path>'}` — the first **void** block tag (no `{/svg}`; a stray one gets a dedicated error). Exactly one quoted **static** path, nothing else. Resolves from `app/assets/` only; absolute/`./`/`../`/escaping paths are compile errors.
- **The file is inert.** Compiler strips prolog/DOCTYPE, requires a single depth-counted `<svg>` root, tokenizes only the root open tag (attrs lifted onto the vnode), and embeds the inner markup verbatim — never template-parsed. No expressions/handlers inside the file; the escape hatch for reactive/animated SVG is pasting it into the template.
- **Runtime = island semantics:** string-typed vnode children → `el.innerHTML` once at mount (SVG namespace already correct), never reconciled; the root element's own attrs/listeners keep patching. Re-seed only if a same-node patch carries a different string. Not a general raw-HTML capability — the string always comes from a build-time file.
- **No per-use attributes; style via the parent** (`currentColor` + hover classes on the button; sizing via wrapper span / `[&_svg]:size-5` / in-file dimensions).
- **Dev loop:** `Compile` returns `Result{JS, InlinedFiles}` (populated even on error); the plugin sets esbuild `WatchFiles` from it, so editing only the `.svg` rebuilds and creating a missing file recovers a failed build. `app/assets/` is compile-time only — never copied to `dist/` (contrast `app/public/`).
- **Tooling:** `pzlc --assets <dir>`; `puzzle init` scaffolds `app/assets/icons/heart.svg` used in `Home.pzl`.

## Alternatives rejected

- **`<inline-svg src class>` element form** — attributes are natural in HTML syntax, but the user preferred a Liquid-shaped tag and the attribute-merge machinery it required wasn't pulling its weight (see next).
- **Header attributes** (`{#svg 'path' class="…"}`) **and Liquid params** (`, class: '…'`) — mixing HTML-attribute syntax into a brace tag is incoherent, and Shopify's own `{% render %}` takes none; the motivating use puts hover classes on the parent `<button>` anyway. Params stay a reserved backwards-compatible extension.
- **`{@svg}`** — `@` already means event actions; one sigil, one meaning.
- **`{#asset}` generic tag** — the contract (root-tag scan, innerHTML seed, parent styling) is SVG-specific; other asset types would each need their own semantics. Precise tags, general folder (`assets/`, not `svg/`). JSON needs nothing: `import x from './x.json'` in `<script>` already works via esbuild's built-in loader.
- **Parsing the file into vnodes** — the first design; rejected because every icon would join vdom diffing on every patch for nothing, and large exported SVGs would bloat AST/goldens. Verbatim string + island freeze is zero-cost after mount and even removes the need for static-only validation and a recursion guard (file contents are inert text).
- **esbuild text loader + raw-HTML vnode** (`import heart from './heart.svg'`) — a general innerHTML node is an XSS-shaped escape hatch D17 deliberately excludes.

## Consequences

- Additive: `{#svg}`-free templates compile byte-identically; array-children runtime paths untouched (every new branch gated on `typeof children === 'string'`).
- `parser.Element` gained a `RawInner *string` field (nil for all parsed nodes; set only by codegen's resolve pass) — a codegen-package node can't satisfy `parser.Node`.
- Bundle cost = hand-pasting (one copy per use); huge repeated SVGs belong in `app/public/` as `<img>`.
- The one-void-block-tag invariant break is documented; any future void tag should reuse the same `parseBlock` return-directly shape.
