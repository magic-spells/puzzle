---
name: D198 — deploy templates and `puzzle add deploy <host>`
status: verified
connections:
  - DECISION-D32-CLI-TOOLING
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC-BUILD
  - DECISION-D200-MINIMUM-NODE
code_refs:
  - deploy/embed.go
  - deploy/README.md
  - compiler/cmd/puzzle/add_deploy.go
  - compiler/cmd/puzzle/add_deploy_test.go
notes:
  - kind: gotcha
    text: >-
      Cloudflare Pages does not read `package.json` `engines`, and its default Node can be below the
      D200 floor, so `deploy/README.md` says to set `NODE_VERSION`.
verified_at: '2026-11-21T18:57:28.823Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# D198 — deploy templates and `puzzle add deploy <host>`

`dist/` is plain static files, but every host needs two rules Puzzle can't
write into `dist/` by itself: the routing fallback (SPA/hybrid → the shell;
static → a real 404, never the shell) and a year-long cache on the
content-hashed names D181 made the default. People wrote these by hand per
host and got them subtly wrong (the classic: Cloudflare's `/* /index.html 200`
serving the shell in place of JavaScript). `packages/puzzle/deploy/` holds one
tested config per host, and `puzzle add deploy <host>` copies it in.

## Rules

- **Hosts:** `vercel` (`vercel.json`, app root), `netlify` (`netlify.toml`,
  app root), `cloudflare` (`_headers`, public folder), `nginx` (`nginx.conf`,
  app root — a `server` block to paste), `apache` (`.htaccess`, public folder).
  The table is `deploy.Hosts`; a test fails when a template in the folder has
  no row or a row has no template.
- **One template per output shape.** SPA and `hybrid` share one (prerendered
  `dist/<path>/index.html` is a real file every host serves before its
  fallback); `static` has its own. The flag (`--static` / `--hybrid`, the same
  `outputFlag` as `build`) wins, else `cfg.Output` from `puzzle.config.js`. A
  config that fails to load is an error, not a guess: the wrong template ships
  a site that 404s on refresh or serves the shell for missing pages.
- **Public-folder files follow the build's rule**: `app/public/` unless only
  `public/` exists, so the build copies them into `dist/`.
- **Hash pattern.** Where a host has regex (nginx, Apache) the cache rule is
  case-sensitive `[-.][A-Z2-7]{8}\.(js|css|json)$`, the build's 8-char
  upper-case base32 hash, so fixed dev/`hashNames:false` names never match.
  Glob hosts (Netlify, Cloudflare) and Vercel (case-insensitive matching) name
  each hashed output instead: `app-*`, `styles-*.css`, `chunks/`,
  `_puzzle/chunks/`, `locales/`. Static page modules (`_puzzle/<slug>-*.js`)
  keep the host's default revalidation there, because `hashNames:false` names
  can't be told apart by a glob.
- **Cloudflare ships no `_redirects`.** Pages applies `_redirects` over files,
  and with no top-level `404.html` it already serves the shell for non-files;
  in static mode it serves the nearest `404.html` up the tree. The CLI warns
  when an SPA has `app/public/404.html` (it would switch Pages to 404 mode).
  Pages does not read `engines`, so the printed steps name the `NODE_VERSION`
  to set (`minNodeMajor`).
- **Per-locale 404s** (`i18n.routing: 'prefix'`, static): Cloudflare does it
  natively; Netlify, nginx and Apache carry a commented example block, and the
  CLI prints the exact line per non-default locale. Vercel can't (only the
  top-level `404.html`), and the CLI says so.
- **Writes like `add piece`**: all destinations are checked before the first
  write; identical bytes are "already matches … nothing to do"; differing
  bytes are refused without `--force`. One host per run. No name lists the
  hosts. D3 holds: the command writes whole template files and never edits a
  user file in place; host-side steps are printed.
- **go:embed needs `all:`** so `_headers` and `.htaccess` are embedded.
- **Magic Spells Sites is not a host here**: its deploy config isn't
  documented in the repo. Add a row when it is.

## Verification (2026-11-19)

Checked against built `examples/i18n` SPA/hybrid/static dists: Cloudflare with
`wrangler pages dev`, Netlify with `netlify dev` plus its own headers parser,
Vercel with `@vercel/routing-utils` (`getTransformedRoutes`, rewrite after
`handle: filesystem`), nginx with crossplane's parser. Apache was checked by
reading only (no binary available).

## Alternatives rejected

- **A docs page with snippets only** — snippets drift from the build's names
  (D181 changed every one of them); embedded templates are tested against the
  host table and the hash pattern.
- **Writing `_redirects` for Cloudflare** — breaks asset serving (rules apply
  over files).
- **One generic `-<hash>` glob everywhere** — catches `my-favicon.png`-style
  names on case-insensitive or glob-only matchers; naming the outputs is exact.
