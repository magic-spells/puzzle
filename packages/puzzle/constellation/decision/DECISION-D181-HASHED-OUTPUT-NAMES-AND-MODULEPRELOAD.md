---
name: D181 — Hashed production output names and modulepreload
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

Production `build.hashNames` is **on by default**: absent or null means hashed names, whatever `build.splitting` says. Explicit `true` forces hashing; `false` opts out and restores the fixed `app.js`, `styles.css` and `_puzzle/<slug>.js`. Development always keeps fixed names and unchanged HTML.

SPA/hybrid entries and JavaScript-imported CSS use esbuild's `[name]-[hash]` names. The composed stylesheet uses `styles-<ContentHash>.css`; `fsutil.ContentHash` shares the locale tables' SHA-256/base32 format. Static page entries use `_puzzle/<slug>-[hash].js`. The discarded static-mode SPA pass keeps its fixed entry name.

**Default-on never fails a build the shell cannot follow.** Before bundling, with the key unset, the build reads `public/index.html` (`shellHashSupport`): if no `<script src>` loads `app.js` (SPA/hybrid), the entry keeps its fixed name; if no script/link tag references `styles.css`, the stylesheet keeps its fixed name. Each fallback prints one `warning: build.hashNames: …` line naming the file. A missing shell falls back for both. An **explicit** `hashNames: true` keeps the hard error for a missing shell or entry reference (naming `build.hashNames: false`, before the atomic swap), and hashes the stylesheet even when unlinked.

The build rewrites local `src`/`href` references in script/link start tags, preserving bare, `./`, `/` and deployment-base prefixes, queries and fragments. Tags inside an HTML comment (`<!-- … -->`, or an unterminated one to the end of the shell) are left as written: they are neither rewritten, checked against the emitted outputs, nor read as the entry script. The scan steps over a whole `<script>…</script>` and over every start tag's quoted attribute values first, so a `<!--` inside a script body or an attribute value (`<meta content="<!--">`) opens no comment. Copied public files take precedence over compiler filenames, including under a deployment base; remote URLs are unchanged. A fixed compiler asset reference without an emitted output fails the build before the staging swap. Static output strips the fixed app script under the normalized `routerBase` as well as the unprefixed spellings, including query and fragment suffixes. Other shell read failures report their I/O error plainly.

Every production splitting pass emits modulepreloads for its transitive static-import closure, breadth-first in metafile import order, de-duplicated and excluding external/dynamic edges. SPA/hybrid shells inherit the entry script's prefix and verbatim `crossorigin`; a shell without a recognized entry skips preloads; static pages reuse their generated module tag's base. Links precede `</head>` at its indentation; a missing closing head is an error only when there are preloads to place (a shell omitting the optional end tag still builds otherwise). Static locale/generated pages sharing an entry are all rewritten after bundling. The JavaScript summary's fixed `entry` contract stays unchanged.

`public/` files are copied verbatim and never renamed. Fixed reserved output names remain reserved because development (and `hashNames: false`) still emits them.

## Alternatives rejected

- **Leave hashing opt-in (default follows `build.splitting`)** — a plain app then ships fixed `styles.css` and `_puzzle/<slug>.js` served must-revalidate, and real browsers hold them anyway: on magicspells.io a browser kept a stale stylesheet for three days after a deploy. Cache-correct output should not depend on the author knowing a flag exists; the cost of the default (filenames change on upgrade, hosts pinning a fixed name must follow) is paid once and `hashNames: false` restores the old names.
- **Fail the build when a default-hashed name cannot be rewritten** — the same shell built fine before the default flipped, so an upgrade would break builds that never asked for hashing. Default-on falls back per file with a warning; only an explicit `true` errors.
- **Post-build JavaScript scripts** — duplicate compiler knowledge and move failures outside its atomic staging guarantee.
- **Scan emitted JavaScript for imports with a regexp** — the metafile is the authoritative graph and distinguishes static, dynamic and external edges.
- **Marker comments in the shell** — ordinary script/link references already identify the output.
- **Hash public files** — Cory: "I think the stuff in public is designed to be static and not really change much. like you drop in a pacakge .js file for something and it's just there and rarely gets updated. it does't need to be folded into anything."
- **Leave static pages for later** — the same naming and preload guarantees belong to every shipped browser entry.

## Consequences

Every production app can cache compiler output by content, and split apps discover shared chunks immediately without fetching lazy routes. Output filenames change on upgrade (BREAKING in 0.10.0): host rules, cache headers or deploy scripts naming `styles.css`, `app.js` or `_puzzle/<slug>.js` must follow the hashed names or set `hashNames: false`. In-repo consumers that load fixed names by path opt out explicitly (the DevTools panel, whose `extension/panel.html` names `panel/app.js`). Failed rewrites preserve the last good dist tree.
