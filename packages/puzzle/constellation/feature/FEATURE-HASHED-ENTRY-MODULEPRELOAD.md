---
name: Hashed entry, stylesheet and page-module names + modulepreload
status: planned
change: feature
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

# Hashed entry, stylesheet and page-module names + modulepreload

A production build writes its entry modules and its stylesheet under fixed
names: the SPA's `dist/app.js`, `dist/styles.css`, and in static mode one
`dist/_puzzle/<slug>.js` per page. [[DECISION-D160-SPA-CODE-SPLITTING]] says
"the entry keeps its stable app.js name". Measured on Pyramid, that costs two
things:

1. **No modulepreload.** The browser learns the names of the chunks an entry
   imports statically only after it has downloaded and parsed the entry. That
   is one extra round trip (~450 ms in Pyramid's production trace, 77 chunks).
2. **Fixed names cannot be cached long.** A server has to send them
   `no-cache`, so every visit pays one revalidation per file. The hashed chunks
   and locale tables already get a year + `immutable`.

Pyramid works around both with two post-build scripts
(`web/scripts/hash-entries.mjs`, `web/scripts/modulepreload.mjs`). The build
should do this itself, so every app gets it and the scripts can go. The decision
record is a new **D180** (the next free number). D160's "stable app.js name"
sentence and its "On by default" alternative are rewritten in place to point
at it.

## Decisions (Cory, 2026-10-16)


- **`build.hashNames`, following `build.splitting` when unset; production
  only; `false` opts out.** A split app has already opted into a hashed,
  multi-file `dist/`. `hashNames: true` turns hashing on for an app that does
  not split, and `hashNames: false` turns it off for one that does (for
  example, a page on another site embeds `/app.js`). Development builds keep
  fixed names, because `puzzle dev` and HMR need stable URLs.
- **No compatibility code.** Cory: "no one else is using Puzzle yet, just us,
  so small breaking changes are fine". The plan carries no fallbacks or extra
  branches whose only job is to keep old shell shapes working. A shell with no
  `</head>` is an error rather than a fallback insertion point, and a hashed
  stylesheet is hashed whether or not the shell links it.
- **`public/` files are never hashed or renamed.** Cory, verbatim: "I think the
  stuff in public is designed to be static and not really change much. like you
  drop in a pacakge .js file for something and it's just there and rarely gets
  updated. it does't need to be folded into anything." Only compiler output is
  renamed.
- **Static mode is in scope.** Its per-page modules are hashed under the same
  `hashNames` rule, and they preload their shared chunks. Both land in this
  feature rather than a follow-up ("why not just do both now?").
- **Listed as a feature, not a breaking change.** The CHANGELOG describes the
  new names and the opt-out, with no migration section.

## Design


Every step below runs only when `!opts.Development`. Development output,
including all of `puzzle dev` and the static dev builder, stays byte-identical
to today. The rules are:

```
hash    := !dev && cfg.HashNames()   // unset → follows build.splitting
preload := !dev                       // whenever the emitting pass splits
```

### Names

- **SPA/hybrid entry.** `EntryNames: "[name]-[hash]"` on the browser pass
  produces `app-XXXXXXXX.js` and its `.js.map`. esbuild writes the
  `sourceMappingURL` itself. The hash shape matches the chunks: eight base32
  characters, `[A-Z2-7]`. esbuild folds the hashes of the imported chunks into
  the entry's hash. When the app's JS imports CSS, the entry's CSS bundle
  becomes `app-XXXXXXXX.css` under the same setting.
- **Stylesheet.** When hashing is on, `styles.css` (written by Go from
  `styles.Compose`) becomes `styles-XXXXXXXX.css`, whether or not the shell
  links it. The hash is 8 base32 characters of SHA-256 over the final bytes,
  the same hash the locale tables use. `locales.contentHash` moves to
  `fsutil.ContentHash` so both share it.
- **Static per-page modules.** `staticPagesBundleOptions` sets `EntryNames` to
  `[name]-[hash]` instead of `[name]`, which produces
  `_puzzle/<slug>-XXXXXXXX.js`. The options builder decides this itself, from
  `!dev && cfg.HashNames()`. The static dev builder (`watch_static.go`) always
  passes `dev=true`, so its warm tree is unchanged and the builder's signature
  does not change.
- In static mode the SPA pass's `app.js` is still deleted before the swap
  (`prerender_pages.go` step 5), so that pass leaves `EntryNames` unset.

### The shell rewrite (SPA, hybrid, and the static pages' shared shell)

There is one new step in `Build`, between `copyPublic` and the prerender
switch. It rewrites `staging/index.html`, the copy of the app's
`public/index.html`. Both prerender modes read the shell from that path
(`prerender.go` passes it as `shellPath`). So every hybrid page, every
`prerender: false` shell and every static page inherits the result, with no
change on the JavaScript side.

The code goes in a new `compiler/internal/build/shell.go` as plain functions.

- **Rename table.** It is built from what this build emitted: `app.js` maps to
  the hashed entry, `app.css` maps to its hashed CSS bundle when one was
  emitted, and `styles.css` maps to the hashed stylesheet. When nothing is
  hashed, the table is empty.
- **Which references are rewritten.** Every `src`/`href` on a `<script>` or
  `<link>` start tag (any `rel`) whose value, ignoring query and fragment, is
  exactly `name`, `./name` or `/name`. The prefix, query and fragment are kept.
  A nested public file (`/vendor/app.js`) and absolute or protocol-relative
  URLs never match.
- **The entry must be loaded by the shell.** In SPA or hybrid mode with the
  entry hashed, a shell with no `app.js` reference fails the build. The error
  names the shell and points to `build.hashNames: false`. A build with no
  `public/index.html` at all fails the same way. The check runs before the
  swap, so the last good `dist/` survives. In static mode the SSG strips the
  `/app.js` tag (`APP_BUNDLE_RE`), so the tag is left alone there.
- **SPA/hybrid modulepreload** applies when the pass splits. There is one
  `<link rel="modulepreload" href="…">` per chunk in the entry's transitive
  **static**-import closure. It is read from esbuild's metafile:
  `outputs[<entry>].imports`, kind `import-statement`, non-external. The walk
  is breadth-first in metafile order, de-duplicated, and never follows a
  `dynamic-import` edge, so lazy route chunks are not preloaded. No regex runs
  over emitted JavaScript.
  - This pass deliberately leaves `AbsWorkingDir` unanchored (D160), so the
    metafile keys are cwd-relative. They are resolved with `resolvePath` and
    compared against the EvalSymlinks'd staging path.
  - Each `href` is the entry tag's own `src` prefix plus the chunk's
    dist-relative path.
  - `crossorigin` is copied verbatim from the entry `<script>`. If the
    credentials mode differs from the script's, the browser fetches the chunk
    twice.
- **Insertion point.** Links go on their own lines immediately before
  `</head>`, indented like that line. A shell with no `</head>` is a build
  error. That is the simpler rule, and every shell in the repo has one.

### Static per-page rewrite

The JS prerender writes each page with the generated tag
`<script type="module" src="${base}/_puzzle/${slug}.js"></script>`
(`client-runtime/ssg/index.js`). That happens before the per-page esbuild pass
exists, so the Go side rewrites the pages after that pass. It runs in every
production static build: preloads always, and hashed names when `hashNames` is
on.

- `bundleStaticPages` turns on `Metafile` in production and returns it. That
  pass anchors `AbsWorkingDir` at staging, so its output keys are already
  staging-relative (`_puzzle/<slug>-H.js` or `_puzzle/<slug>.js`, and
  `_puzzle/chunks/…`).
- From the metafile, each slug maps to its module and to the static closure of
  `_puzzle/chunks/` it imports. Outputs are matched to slugs through
  `entryPoint`, the generated `.puzzle-prerender/entries/<slug>.js`.
- The rewrite is a new step 4b in `prerenderStaticPages`, after the per-page
  pass. It runs over each `summary.Written` page. Under D177 prefix routing,
  several locale pages share one slug, and each is rewritten.
  - Replace that page's module tag `src` with the emitted name (a no-op when
    the name is not hashed), keeping the `${base}` prefix that was matched.
  - Insert the page's modulepreload links before `</head>`, using the same
    prefix.
  - Exactly one module tag must match. The tag is generated, so a miss is an
    internal invariant failure and a build error.
- It uses the same insertion and closure helpers as the shell rewrite in
  `shell.go`. There is one implementation of "static closure from a metafile"
  and one of "insert preloads".
- The summary's `entry` field (`_puzzle/<slug>.js`) is a JS-side contract that
  the vitest suite asserts. It stays as is. Only the written HTML changes.

### Config

`build.hashNames` is stored as `Config.Build.HashNames *bool`. It is decoded
and rejected like the other build booleans ("must be a boolean").
`Config.HashNames()` is the only place the default lives. When the key is
unset, it returns `Config.Splitting()`, the configured value. That means a
static app with no `splitting` key builds fixed names by default, but still
gets per-page modulepreload links in production.

| production build | entry JS | CSS | static page modules | modulepreload |
|---|---|---|---|---|
| SPA/hybrid, `hashNames` on | hashed | hashed | — | when splitting |
| SPA/hybrid, `hashNames` off | fixed | fixed | — | when splitting |
| static, `hashNames` on | — (no app.js) | hashed | hashed | every page |
| static, `hashNames` off | — | fixed | fixed | every page |

Development builds never hash and never preload.

## Files to change

- `compiler/internal/config/config.go` (+ test): the key, its decode, and the
  accessor.
- `compiler/internal/fsutil/`: `ContentHash`, moved from `locales/locales.go`,
  which calls it.
- `compiler/internal/build/options.go`: `bundleFlags.HashEntry` sets
  `EntryNames`. It rides on the flags, never on shared options, because the
  node prerender pass writes with `Outfile`. Rewrite the D160 comment there.
- `compiler/internal/build/build.go`:
  - Resolve `hash`, `hashEntry` (`hash && mode != "static"`) and `preload`.
  - Set `buildOpts.Metafile` when `opts.Metafile != nil || !opts.Development`.
  - Write the hashed stylesheet.
  - Call the shell rewrite after `copyPublic`.
  - Update the comments that say the shell links `/styles.css` verbatim.
  - `reservedOutputNames` stays, because dev still writes the fixed names.
- `compiler/internal/build/shell.go` (new) + `shell_test.go`: the rename table,
  tag rewrite, metafile static closure, preload insertion, and the static
  page-tag rewrite.
- `compiler/internal/build/prerender_pages.go`:
  - `staticPagesBundleOptions`: hashed `EntryNames` and `Metafile` in
    production.
  - `bundleStaticPages` returns the metafile.
  - New step 4b rewrites the pages.
  - Update the `EntryNames` comment.
- `compiler/internal/preview/preview.go` (+ test): `shapeWarning` treats
  `app-<hash>.js` as "ships app.js".
- `compiler/cmd/puzzle/main.go`: the `build` help text.
- Docs:
  - `README.md`: the splitting section (~L687–700) and the dist layout.
  - `skills/puzzle/SKILL.md`: ~L72–85 and the static section around L967.
  - `CHANGELOG.md`: a 0.9.0 feature entry.
  - `packages/puzzle/CLAUDE.md`: next free decision number becomes D181.
- Cards:
  - New `DECISION-D180-…` and `FILE-BUILD-SHELL`.
  - Rewrite D160 in place.
  - Update `DOC-SPEC-BUILD`, `FLOW-BUILD`, `FLOW-PRERENDER`, `FILE-BUILD`,
    `FILE-BUILD-OPTIONS`, `FILE-BUILD-PRERENDER-PAGES`, `FILE-CONFIG`,
    `DOC-RELEASE-SURFACE` and `TEST-BUILD-AND-DEV-PIPELINE`.

These stay unchanged:

- the i18n manifest. Its base logic keys off `/chunks/…-HASH.js`, never an
  entry name.
- `route_deps`
- the watch builders
- `release:prep`
- the scaffold shell. It keeps `/app.js` and `/styles.css`, and the build
  rewrites them.
- `measure:size`, which sums every `.js`
- `e2e-pack` and `build:blog`, which build in development

## Test plan


- **Unit (`shell_test.go`)**
  - **Tag rewrite cases:**
    - attribute quoting: double, single, unquoted
    - prefixes: `/`, `./`, bare
    - query and fragment kept
    - a `rel=preload` link is rewritten
    - `/vendor/app.js` and `https://cdn/app.js` are untouched
    - a missing entry tag fails the build
    - a missing `</head>` fails the build
  - **Preload insertion:** indentation, and `crossorigin` bare, valued and
    absent.
  - **Metafile closure** on synthetic JSON:
    - transitive chunk→chunk
    - a diamond is de-duplicated
    - dynamic edges are excluded
    - externals are skipped
    - the order is stable
    - both key styles: cwd-relative (SPA) and staging-relative (static)
  - **Static page-tag rewrite:**
    - with `${base}` empty and `/app`
    - zero matches is an error
- **Config:** `hashNames` true, false, null and non-boolean. When unset, it
  follows `splitting` (true → true, absent → false).
- **Build integration (`build_test.go`, `prerender_test.go`,
  `static_pages_test.go`)**
  - **Production SPA, splitting on:**
    - `app-<H>.js` and `styles-<H>.css` exist, and there is no `app.js`.
    - The preload set equals the metafile's static closure and excludes the
      lazy chunk.
  - **Production SPA, splitting off:**
    - Output is unchanged: fixed names, no preloads, shell bytes equal
      `public/index.html`.
    - With `hashNames: true`, the names are hashed.
  - **`hashNames: false` with splitting on:** fixed names, and preloads are
    still emitted.
  - **Development:** fixed names, and the shell bytes equal
    `public/index.html`.
  - **Hybrid + splitting:** every prerendered page and SPA shell carries the
    hashed tags and preloads.
  - **Static, default config:**
    - Fixed names.
    - Every page still gets preloads for its shared `_puzzle/chunks/`.
  - **Static with `hashNames: true`:**
    - Every page's module `src` is hashed and exists on disk.
    - The stylesheet is hashed.
    - There is no `app.js`.
    - Under prefix routing, each locale page of a slug is rewritten.
  - **Determinism:** two builds of the same source produce the same names.
  - **JS-imported CSS:** `app-<H>.css` is rewritten in the shell.
  - **Missing entry tag:** a shell without one fails the build, and `dist/` is
    untouched.
  - **Existing tests:** production split tests that read `dist/app.js` or
    `dist/styles.css` switch to one helper that reads the names from the built
    HTML.
- **Preview:** `shapeWarning` with a hashed entry.
- **Examples:**
  - Production builds of `examples/blog` (SPA, splits, so hashed) and
    `examples/static-docs` (static, fixed names plus preloads). Every
    `src`/`href` naming `app-*`, `styles-*`, `chunks/` or `_puzzle/` must exist
    on disk.
  - `puzzle preview` each one, then load a lazy route and a static page in a
    browser.
- The full suites from `CLAUDE.md` pass. `build:static-docs` is a production
  build, so its pages gain preload links. Any vitest assertion on exact page
  bytes must account for them.

## Risks

- Anything outside the shell that names `/app.js`, `/styles.css` or
  `/_puzzle/<slug>.js` breaks: another public page, a CDN rule, a service
  worker list. The build catches only the case where the shell itself does not
  load `app.js`. Everything else goes through `hashNames: false`.
- An SPA shell that loads the entry under a base path (`/base/app.js`) is not
  matched and fails the build. Static pages are unaffected, because their
  `${base}` prefix comes from the generated tag.
- The tag matcher is a regexp over HTML, like the SSG's `APP_BUNDLE_RE`. It is
  limited to `<script>`/`<link>` start tags so that no other text is touched.

## Migration (Pyramid)

- **Delete the scripts.** Remove `web/scripts/modulepreload.mjs` and
  `web/scripts/hash-entries.mjs` with their tests, and drop both from
  `npm run build`.
- **`public/morph.css`.** It is a public file, so it is no longer hashed. Leave
  it as a no-cache public file or import it into the stylesheet; that is
  Pyramid's call.
- **`check-bundle.mjs`.** `firstLoad()` must find the entry through the module
  `src` in `dist/index.html` instead of `dist/app.js`.
- **The Go server needs no change.** The `hashedName` rule in
  `server/internal/spa/spa.go` (`[-.][A-Z2-7]{8,}\.[0-9a-z]+$`) already matches
  `app-XXXXXXXX.js` and `styles-XXXXXXXX.css`, so both get a year +
  `immutable`. `index.html` stays no-cache.
