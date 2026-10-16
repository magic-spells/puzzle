---
name: D180 — Hashed production output names and modulepreload
status: built
connections:
  - FEATURE-HASHED-ENTRY-MODULEPRELOAD
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D81-STATIC-PAGES-MODE
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-BUILD-SHELL
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-CONFIG
  - DOC-SPEC-BUILD
---

## Context

Fixed entry and stylesheet URLs require revalidation, while a split entry's static imports introduce a discovery round trip. The compiler already has the emitted filenames and esbuild's import graph; applications should not reconstruct them after a build.

## Decision

Production `build.hashNames` follows the configured `build.splitting` when absent or null. Explicit `true` hashes without splitting; `false` opts out. Development always keeps fixed names and unchanged HTML.

SPA/hybrid entries and JavaScript-imported CSS use esbuild's `[name]-[hash]` names. The composed stylesheet always uses `styles-<ContentHash>.css` when hashing is on, even if unlinked; `fsutil.ContentHash` shares the locale tables' SHA-256/base32 format. Static page entries use `_puzzle/<slug>-[hash].js`. The discarded static-mode SPA pass keeps its fixed entry name.

The build rewrites local `src`/`href` references in script/link start tags, preserving bare, `./` and `/` prefixes, queries and fragments. A hashed SPA/hybrid entry requires a shell script reference to `app.js`; missing shell/reference errors name `build.hashNames: false` before the atomic swap.

Every production splitting pass emits modulepreloads for its transitive static-import closure, breadth-first in metafile import order, de-duplicated and excluding external/dynamic edges. SPA/hybrid shells inherit the entry script's prefix and verbatim `crossorigin`; static pages reuse their generated module tag's base. Links precede `</head>` at its indentation; a missing closing head is an error. Static locale/generated pages sharing an entry are all rewritten after bundling. The JavaScript summary's fixed `entry` contract stays unchanged.

`public/` files are copied verbatim and never renamed. Fixed reserved output names remain reserved because development still emits them.

## Alternatives rejected

- **Hash every production build by default** — the default follows `build.splitting`, so opting into a multi-file graph also selects hashed entry names.
- **Post-build JavaScript scripts** — duplicate compiler knowledge and move failures outside its atomic staging guarantee.
- **Scan emitted JavaScript for imports with a regexp** — the metafile is the authoritative graph and distinguishes static, dynamic and external edges.
- **Marker comments in the shell** — ordinary script/link references already identify the output.
- **Hash public files** — Cory: "I think the stuff in public is designed to be static and not really change much. like you drop in a pacakge .js file for something and it's just there and rarely gets updated. it does't need to be folded into anything."
- **Leave static pages for later** — the same naming and preload guarantees belong to every shipped browser entry.

## Consequences

Split production apps can cache compiler output by content and discover shared chunks immediately without fetching lazy routes. External references to fixed compiler URLs require the explicit opt-out. A default static app keeps fixed names and still gains preloads. Failed rewrites preserve the last good dist tree.
