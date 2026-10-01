---
name: 'D46 — `{#svg ''path''}`: compile-time SVG inlining as an island-frozen vnode'
status: verified
connections:
  - DECISION-D44-DOM-ISLANDS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-TEMPLATE-SYNTAX
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
verified_at: '2026-07-11T04:53:45.732Z'
code_refs:
  - client-runtime/views/viewManager.js
  - client-runtime/ssg/serialize.js
---

# D46 — `{#svg 'path'}`: compile-time SVG inlining

`{#svg 'icons/cart.svg'}` renders `app/assets/icons/cart.svg` as an `<svg>` vnode whose children are a **string** seeded once via `innerHTML` — island semantics ([[DECISION-D44-DOM-ISLANDS]]). One file on disk, referenced by name everywhere. SPEC §18.

## Decision
- **Grammar:** the only **void** block tag (no `{/svg}`; a stray one has its own error). Exactly one quoted **static** path, resolved from `app/assets/` only; absolute, `./`, `../` and escaping paths are compile errors. Any future void tag reuses the same `parseBlock` return-directly shape.
- **The file is inert.** The compiler strips prolog/DOCTYPE, requires one depth-counted `<svg>` root, lifts the root tag's attributes onto the vnode, and embeds the inner markup verbatim — never template-parsed, so no expressions or handlers inside. For reactive or animated SVG, paste the markup into the template.
- **Runtime:** string children → `el.innerHTML` once at mount (namespace already correct), never reconciled; the root's own attributes and listeners patch. It re-seeds only if a same-node patch carries a different string. A resolved `{#svg}` (string children) and an authored `<svg>` (array children) at one conditional position are a replacement boundary, not a patch (`sameNode` compares child ownership). This is not a general raw-HTML capability — the string always comes from a build-time file.
- **Dedup in bundles:** under the esbuild plugin (`Options.SVGDedup`), each use site imports a virtual module `@magic-spells/puzzle/svg-asset/<path>` and calls its factory, so each icon's markup is stored once per bundle. Standalone `pzlc` inlines per use. Codegen still reads each file, so a missing or malformed file is a positioned `.pzl` compile error.
- **No per-use attributes.** Style through the parent (`currentColor` and hover classes on the button, `[&_svg]:size-5`) or the file's own dimensions.
- **Dev loop:** `Compile` returns `InlinedFiles` (even on error) and the plugin sets esbuild `WatchFiles` from it, so editing an `.svg` rebuilds and creating a missing one recovers the build. `app/assets/` is compile-time only, never copied to `dist/` (unlike `app/public/`).
- Tooling: `pzlc --assets <dir>`; `puzzle init` scaffolds `app/assets/icons/heart.svg`.

## Alternatives rejected
- `<inline-svg src>` element form, header attributes (`{#svg 'p' class="…"}`) or Liquid params — mixing attribute syntax into a brace tag is incoherent; parent styling covers the use. Params stay a reserved compatible extension.
- `{@svg}` — `@` already means events.
- A generic `{#asset}` — the contract is SVG-specific; JSON already imports through esbuild.
- Parsing the file into vnodes — every icon would join diffing, and large SVGs bloat the AST and goldens.
- An esbuild text loader + raw-HTML vnode — a general `innerHTML` node is the XSS-shaped hatch the vdom excludes.
