---
name: Hashed entry and stylesheet names + modulepreload in the shell
status: planned
change: breaking
branch: feat/build-hashed-entry
connections:
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D175-TRANSLATIONS
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-CONFIG
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-SSG-RUNTIME
  - FILE-CLI
  - FLOW-BUILD
  - FLOW-PRERENDER
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - DOC-SPEC-BUILD
  - DOC-RELEASE-SURFACE
  - TEST-BUILD-AND-DEV-PIPELINE
  - TEST-CLI-COMMANDS
---


# Hashed entry and stylesheet names + modulepreload in the shell

With `build.splitting` on, a production build keeps the entry as a fixed
`dist/app.js` and the stylesheet as a fixed `dist/styles.css`
([[DECISION-D160-SPA-CODE-SPLITTING]]: "the entry keeps its stable app.js
name"). That costs every split app two things, measured on Pyramid:

1. **No modulepreload.** The browser learns the names of the chunks `app.js`
   imports statically only after it has downloaded and parsed `app.js` — one
   extra round trip (~450 ms in Pyramid's production trace; 77 chunks).
2. **Fixed names cannot be cached long.** A server must send `app.js` and
   `styles.css` `no-cache`, so every visit pays a revalidation per file, while
   the hashed chunks and locale tables get a year + `immutable`.

Pyramid ships two post-build scripts for this (`web/scripts/hash-entries.mjs`,
`web/scripts/modulepreload.mjs`). The build should do it, so every app gets it
and the scripts can go. The decision record is a new **D180** (next free
number), and D160's "stable app.js name" sentence is rewritten in place to
point at it.

## Design

One new step in `Build` (`compiler/internal/build/build.go`), between
`copyPublic` and the prerender switch: **rewrite the shell**
(`staging/index.html`, the copy of the app's `public/index.html`). Both
prerender modes read the shell from that path (`prerender.go` passes
`staging/index.html` as `shellPath`), so every hybrid page, every
`prerender: false` SPA shell and every static page inherits the rewrite with no
change on the JavaScript side. It runs in production builds only
(`!opts.Development`); a development build — and so all of `puzzle dev` — keeps
the fixed names and a byte-identical shell, so HMR, the dev server, the static
dev builder and `e2e-pack` (which builds `--mode development`) are untouched.

### Hashed names

- **Entry JS**: `buildOpts.EntryNames = "[name]-[hash]"` on the browser pass
  when the entry is hashed → `app-XXXXXXXX.js` (and `app-XXXXXXXX.js.map`;
  esbuild writes the `sourceMappingURL` itself). Same shape as the chunks
  (`chunks/[name]-[hash]`): eight base32 characters, `[A-Z2-7]`. esbuild's
  entry hash already folds in the hashes of the chunks it imports, so a chunk
  change renames the entry. If the app's JS imports CSS, esbuild's CSS bundle
  for the entry becomes `app-XXXXXXXX.css` by the same setting.
- **`styles.css`** (written by Go from `styles.Compose`) → `styles-XXXXXXXX.css`,
  hashed over its final bytes with the same 8-character SHA-256/base32 hash the
  locale tables use (`locales.contentHash`, moved to `fsutil.ContentHash` so
  both share it).
- **Static mode hashes the stylesheet only.** It ships no `app.js` (the SPA
  pass's `app.js` is deleted and the SSG strips the `/app.js` tag by matching
  that literal name, `APP_BUNDLE_RE` in `client-runtime/ssg/index.js`), so the
  entry keeps `EntryNames` unset there. The per-page `_puzzle/<slug>.js`
  modules keep their names (out of scope, below).
- Public files are never renamed: `public/` is copied verbatim and a public
  file can be referenced from places the build cannot see.

### Rewriting the shell's tags

New file `compiler/internal/build/shell.go`. It takes a rename table built
from what this build actually emitted — `app.js` → hashed entry, `app.css` →
its hashed CSS bundle when esbuild emitted one, `styles.css` → hashed
stylesheet — and rewrites every `src`/`href` on a `<script>` or `<link>` tag
(any `rel`, so a `rel="preload"` to the stylesheet is kept in step) whose value,
query and fragment aside, is exactly `name`, `./name` or `/name`. The prefix,
query and fragment are kept. A nested public file (`/vendor/app.js`) and any
absolute or protocol-relative URL never match.

- **The entry must be referenced.** Hashing the entry while the shell loads no
  `app.js` would ship an app nothing can load (the usual cause is a page on
  another site embedding `/app.js`). That is a build error naming the shell and
  steering to `build.hashNames: false`; it fires before the swap, so the last
  good `dist/` survives. No `public/index.html` at all with the entry hashed is
  the same error.
- **A stylesheet the shell does not link keeps its fixed name** — not linking
  `styles.css` is a legitimate shell, and an unlinked file with a hash in its
  name would be referenced by nothing.
- Only the shell is rewritten. Another HTML file in `public/` that loads
  `/app.js` is copied verbatim (documented; see Risks).

### modulepreload

When the browser pass splits (production), the shell gets one
`<link rel="modulepreload" href="…">` per chunk the entry reaches through
**static** imports, transitively — never a `dynamic-import` edge, so a lazy
route's chunk is not fetched up front. The set comes from esbuild's metafile
(`outputs[<entry>].imports`, kind `import-statement`, non-external), walked
breadth-first in metafile order with de-duplication, so the order is
deterministic and matches first reach. No regex over emitted JavaScript (the
Pyramid script's approach). The pass sets `Metafile: true` whenever it needs
the walk; the CLI already requests the metafile for the size banner
(`compiler/cmd/puzzle/summary.go`). Output keys are cwd-relative (the SPA pass
deliberately does not anchor `AbsWorkingDir`, D160), so they are resolved with
`resolvePath` and made staging-relative against the EvalSymlinks'd staging
path.

- `href` = the entry tag's own prefix (everything before `app…js` in its
  `src`) + the chunk's dist-relative path, so `/app.js`, `./app.js` and
  `app.js` shells each get matching links.
- `crossorigin` is copied verbatim from the entry `<script>` (absent, bare, or
  with its value). A modulepreload whose credentials mode differs from the
  module script's is fetched twice.
- Inserted on their own lines immediately before `</head>`, indented like the
  `</head>` line; a shell with no `</head>` gets them immediately before the
  entry `<script>`.
- Preloads are independent of hashing: a split app with `hashNames: false`
  still gets them (pointing at `chunks/…` beside a fixed `app.js`). A shell
  that does not reference `app.js` with hashing off simply gets none.
- Not in static mode: splitting is forced off for the SPA pass there.

### Config surface and defaults

`build.hashNames` — boolean, tri-state like `build.splitting`
(`Config.Build.HashNames *bool`, rejected with the same "must be a boolean"
error when not one). `Config.HashNames()` is the one place the default lives:
**unset follows `build.splitting`**. Effective rules in `Build`:

| | entry JS | CSS | modulepreload |
|---|---|---|---|
| development (any mode) | fixed | fixed | none |
| production SPA / hybrid, `hashNames` on | hashed | hashed | when splitting |
| production SPA / hybrid, `hashNames: false` | fixed | fixed | when splitting |
| production static, `hashNames` on | — (no app.js) | hashed | none |

Why tied to splitting: a split app has already opted into a hashed,
multi-file `dist/` and needs a server that tells hashed names apart; an app
that has not opted in keeps exactly today's output (hello-world and todos, the
size-banner apps, do not split, so `measure:size` is unaffected). `hashNames:
true` turns it on for a non-split app. Production-only because the dev server
serves `public/index.html` per request and HMR needs stable URLs.

## Files to change

- `compiler/internal/config/config.go` — `Build.HashNames`, raw decode +
  validation, `HashNames()` accessor.
- `compiler/internal/build/options.go` — `bundleFlags.HashEntry` (rides on the
  flags like `Splitting`, never on shared options: the node prerender pass
  writes with `Outfile`, the static per-page pass sets its own `EntryNames`);
  set `EntryNames` when on; rewrite the D160 comment.
- `compiler/internal/build/build.go` — resolve `hashEntry`/`hashCSS`/`preload`
  next to `splitting`; metafile on when needed; write `styles-<hash>.css`;
  call the shell rewrite after `copyPublic`; update the `reservedOutputNames`
  and `copyPublic` comments (the fixed names stay reserved — dev still writes
  them).
- `compiler/internal/build/shell.go` (new) + `shell_test.go` — rename table,
  tag rewrite, metafile static-import walk, preload insertion. Plain funcs, no
  new types beyond a small result struct.
- `compiler/internal/fsutil` — `ContentHash` (moved from `locales`).
- `compiler/internal/preview/preview.go` — `shapeWarning` accepts
  `app-<hash>.js` as "ships app.js".
- `compiler/cmd/puzzle/main.go` — `build` long help names the hashed outputs.
- Docs: `README.md` (splitting section ~L687–700), `skills/puzzle/SKILL.md`
  (~L72–85), `CHANGELOG.md` (0.9.0, under breaking for split apps), cards
  below, `CLAUDE.md` next free decision number → D181.
- Cards: new `DECISION-D180-…`; rewrite D160's entry-name sentence and its
  "On by default" alternative in place; `DOC-SPEC-BUILD`, `FLOW-BUILD`,
  `FILE-BUILD`, `FILE-BUILD-OPTIONS`, `FILE-CONFIG`, a new `FILE-BUILD-SHELL`,
  `DOC-RELEASE-SURFACE`, `TEST-BUILD-AND-DEV-PIPELINE`.

Unchanged by design: the i18n manifest (its base logic keys off
`/chunks/…-HASH.js`, never the entry name), `route_deps`, the watch builders,
`release:prep`, the scaffold shell (it keeps `/app.js` + `/styles.css`; the
build rewrites them), `measure:size`, `e2e-pack`, `build:blog` (development).

## Test plan

- **Unit (`shell_test.go`)**: tag rewrite table — double/single/unquoted
  attributes, `/`/`./`/bare prefixes, query and fragment kept, `rel=preload`
  link rewritten, `/vendor/app.js` and `https://cdn/app.js` untouched,
  unlinked `styles.css` kept fixed, missing entry tag → error; preload insertion
  — before `</head>` with its indentation, fallback before the entry tag,
  `crossorigin` bare/valued/absent copied; metafile walk on synthetic JSON —
  transitive chunk→chunk, diamond de-duplicated, dynamic edge excluded,
  external skipped, order stable.
- **Config**: `hashNames` true/false/null/non-boolean; default follows
  `splitting`.
- **Build integration (`build_test.go`)**: production + splitting →
  `app-<H>.js`, no `app.js`, `styles-<H>.css`, every rewritten shell
  reference exists on disk, preload set equals the metafile's static closure
  and excludes the lazy chunk; `hashNames: false` → fixed names + preloads;
  development → fixed names, shell bytes equal `public/index.html`; non-split
  production → output identical to today; hybrid + splitting → every
  prerendered page and SPA shell carries the hashed tags and preloads; static
  + splitting → hashed stylesheet in every page, no `app.js`; two builds of
  the same source → identical names; JS-imported CSS → `app-<H>.css` rewritten;
  shell without the entry tag → error and `dist/` untouched. Existing
  production splitting tests that read `dist/app.js` find the entry through
  the shell (one helper).
- **Preview**: `shapeWarning` with a hashed entry.
- **Example**: `go run ./compiler/cmd/puzzle build examples/blog` (production,
  splits) and check the shell's references resolve; `puzzle preview` it and
  load a lazy route in a browser.
- No codegen golden changes expected; the full suites from `CLAUDE.md` run
  green.

## Out of scope / follow-ups

- Hashing the static per-page `_puzzle/<slug>.js` modules and preloading their
  shared `_puzzle/chunks/` (the per-page entry URLs are written by the JS
  prerender before that pass runs, so it needs a post-pass rewrite of every
  page).
- Hashing public files the shell loads (Pyramid's `public/morph.css`).
- Long-cache headers in `puzzle preview` (it serves everything `no-cache`).

## Risks

- **Breaking for split apps' deploys**: anything outside the shell that names
  `/app.js` or `/styles.css` (another public page, an embed on another site, a
  CDN or `_headers` rule, a service worker precache list) breaks; the entry
  case fails the build only when the shell itself does not load `app.js`.
  CHANGELOG names `hashNames: false` as the escape.
- A shell that loads the entry under a base path (`/base/app.js`) is not
  matched and fails the build; the opt-out is the escape until base-path
  shells are a real need.
- The tag matcher is a regexp over HTML, like the SSG's `APP_BUNDLE_RE`;
  keep it to `<script>`/`<link>` start tags so text and attribute values
  elsewhere are never touched.

## Migration (Pyramid)

Delete `web/scripts/modulepreload.mjs`, `web/scripts/hash-entries.mjs` and
their tests, and drop both from `npm run build` (keep `hash-entries` only if
`public/morph.css` must stay a separate hashed file — or move it into the
stylesheet). `scripts/check-bundle.mjs` `firstLoad()` must find the entry
through `dist/index.html`'s module `src` instead of `dist/app.js`.
`server/internal/spa/spa.go`'s `hashedName`
(`[-.][A-Z2-7]{8,}\.[0-9a-z]+$`) already matches `app-XXXXXXXX.js` and
`styles-XXXXXXXX.css`, so the entry and stylesheet get a year + `immutable`
with no server change; `index.html` stays no-cache.
