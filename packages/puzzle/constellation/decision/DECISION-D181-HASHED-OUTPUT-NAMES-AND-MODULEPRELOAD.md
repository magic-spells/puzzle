---
name: D181 — Hashed production output names and modulepreload
status: built
connections:
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D81-STATIC-PAGES-MODE
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-BUILD-SHELL
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-CONFIG
  - DOC-SPEC-BUILD
---

# D181 — Hashed production output names and modulepreload

## Context

Fixed entry and stylesheet URLs must be served must-revalidate, and a split entry's static imports cost a discovery round trip before the browser can fetch its chunks. The compiler already has the emitted filenames and esbuild's import graph, so apps should not reconstruct them with post-build scripts.

## Decision

### Names

Production `build.hashNames` is **on by default**: absent or null means hashed names, independent of `build.splitting` (`Config.HashNames()` is the only place the default lives). Explicit `true` forces hashing; `false` opts out and restores the fixed `app.js`, `styles.css` and `_puzzle/<slug>.js`. Development always keeps fixed names and unchanged HTML, because `puzzle dev` and HMR need stable URLs.

- SPA/hybrid entries and JavaScript-imported CSS use esbuild's `[name]-[hash]` (`app-XXXXXXXX.js`, `app-XXXXXXXX.css`). The entry setting rides on `bundleFlags.HashEntry`, never on the shared options, because the node prerender pass writes with `Outfile`.
- The composed stylesheet is `styles-<ContentHash>.css`; `fsutil.ContentHash` (8 base32 chars of SHA-256) is shared with the locale tables.
- Static page entries are `_puzzle/<slug>-[hash].js`. The static-mode SPA pass, whose `app.js` is deleted before the swap, keeps its fixed entry name.
- `public/` files are copied verbatim and never renamed. The fixed output names stay reserved because development (and `hashNames: false`) still emits them.
- The JavaScript prerender summary's `entry` field stays the fixed `_puzzle/<slug>.js`; only the written HTML changes. `puzzle preview`'s shape warning treats `app-<hash>.js` as shipping `app.js`.

### Default-on never fails a build the shell cannot follow

With the key unset, `shellHashSupport` reads `public/index.html` and every other `public/**/*.html` page before bundling:

- if no `<script src>` in the shell loads `app.js` (SPA/hybrid), the entry keeps its fixed name;
- if no script/link tag references `styles.css`, the stylesheet keeps its fixed name;
- any other public page naming `app.js`/`app.css`/`styles.css` by its fixed name keeps that file's fixed name too, so a hand-written `404.html` or `embed.html` never ships a dead link;
- a missing shell falls back for both.

Each fallback prints one `warning: build.hashNames: …` line naming the file (none for the stylesheet when the composed stylesheet is empty). A default build leaves a fixed asset reference with no emitted output as written.

An **explicit** `hashNames: true` is strict: a missing shell or entry reference is a hard error naming `build.hashNames: false` (before the atomic swap); a shell reference to an output that was not emitted (a stale `/app.css`) fails; the other public pages are rewritten to the hashed names (no preloads; only the shell boots the app); and the stylesheet is hashed even when unlinked.

### Rewriting HTML

The build rewrites local `src`/`href` references in script/link start tags, preserving bare, `./`, `/` and deployment-base prefixes, queries and fragments; remote URLs are unchanged, and copied public files win over compiler names, under a deployment base too. Tags inside an HTML comment (or an unterminated one to the end of the shell) are left alone: not rewritten, not checked, not read as the entry script. The scan steps over whole `<script>…</script>` bodies and quoted attribute values first, so a `<!--` inside either opens no comment. Static output strips the fixed app script under the normalized `routerBase` as well as the unprefixed spellings, with query and fragment suffixes.

### Modulepreload

Every production splitting pass emits modulepreloads for its transitive static-import closure, read from esbuild's metafile: breadth-first in import order, de-duplicated, external and dynamic edges excluded (lazy route chunks are never preloaded). SPA/hybrid shells inherit the entry script's prefix and verbatim `crossorigin` (a different credentials mode would make the browser fetch each chunk twice); a shell without a recognized entry skips preloads. Static pages reuse their generated module tag's base, and every locale page sharing an entry is rewritten after bundling. Links go on their own lines before `</head>` at its indentation; a missing `</head>` is an error only when there are preloads to place. The helpers live in `compiler/internal/build/shell.go` ([[FILE-BUILD-SHELL]]).

## Alternatives rejected

- **Leave hashing opt-in (default follows `build.splitting`)**: a plain app ships fixed `styles.css` and `_puzzle/<slug>.js`, and real browsers hold them past a deploy anyway (a stale stylesheet survived three days on magicspells.io). Cache-correct output should not depend on knowing a flag exists.
- **Fail the build when a default-hashed name cannot be rewritten**: a shell that built fine before would break on upgrade without asking for hashing. Default-on falls back per file with a warning; only an explicit `true` errors.
- **Rewrite other public pages by default**: `public/` files are verbatim, and relative references in nested pages would be guessed.
- **Post-build JavaScript scripts**: duplicate compiler knowledge and fail outside the atomic staging guarantee.
- **Scan emitted JavaScript for imports with a regexp**: the metafile is the authoritative graph and tells static, dynamic and external edges apart.
- **Marker comments in the shell**: ordinary script/link references already identify the output.
- **Hash public files**: Cory: "I think the stuff in public is designed to be static and not really change much. like you drop in a pacakge .js file for something and it's just there and rarely gets updated. it does't need to be folded into anything."

## Consequences

Every production app can cache compiler output by content, and split apps discover shared chunks without fetching lazy routes. Output filenames are not stable across builds (breaking for hosts that name them): host rules, cache headers, service-worker lists or deploy scripts naming `styles.css`, `app.js` or `_puzzle/<slug>.js` must follow the hashed names or set `hashNames: false`. In-repo consumers that load fixed names by path opt out explicitly (the DevTools panel, whose `extension/panel.html` names `panel/app.js`). Failed rewrites preserve the last good dist tree.
