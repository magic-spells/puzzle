# Deploying a Puzzle app

`puzzle build` writes a folder of static files, `dist/`, and any static host
can serve it. Two things need the host's help:

- **Routing.** An SPA (the default) and a `hybrid` build draw routes in the
  browser, so a refresh or a shared link on `/posts/42` must get the shell
  (`dist/index.html`), not the host's 404. A `static` build is the other way
  round: every page is a real file (`/about` is `dist/about/index.html`), and a
  path with no page must get `dist/404.html` with a 404 status, never the shell.
- **Caching.** Production builds content-hash their file names
  (`app-<hash>.js`, `styles-<hash>.css`, `chunks/chunk-<hash>.js`,
  `_puzzle/<slug>-<hash>.js`, `locales/<tag>.<hash>.json`), so those files can
  be cached for a year. HTML must be checked on every visit, or a browser keeps
  pointing at last week's bundle.

This folder holds one tested config per host that does both. Copy it in with
the CLI, or copy the file by hand from the folder; they are the same file.

```bash
puzzle add deploy                 # list the hosts
puzzle add deploy netlify         # write the config for your build's output mode
puzzle add deploy nginx --static  # pick the static template whatever the config says
```

The template follows the `output` key in `puzzle.config.js`: none or `'hybrid'`
gets the SPA template, `'static'` the static one. `--static` and `--hybrid`
choose instead, like the same flags on `puzzle build`. The command refuses to
overwrite a file you already have unless you pass `--force` (`-f`), and running
it again with the same template changes nothing.

| Host | Command | File it writes | Where the host reads it |
| --- | --- | --- | --- |
| Vercel | `puzzle add deploy vercel` | `vercel.json` | the repo root |
| Netlify | `puzzle add deploy netlify` | `netlify.toml` | the repo root |
| Cloudflare Pages | `puzzle add deploy cloudflare` | `app/public/_headers` | `dist/_headers` (the build copies it) |
| nginx | `puzzle add deploy nginx` | `nginx.conf` | your server config (paste the block) |
| Apache | `puzzle add deploy apache` | `app/public/.htaccess` | `dist/.htaccess` (the build copies it) |

The files that must sit in the published folder go in your public folder
(`app/public/`, or `public/` when that is the one your app has), because
`puzzle build` copies it into `dist/` as is.

## Vercel

`vercel.json` sets the build command (`npm run build`) and the output folder
(`dist`), then:

- **SPA and hybrid:** a rewrite sends every path to `/index.html`. Vercel
  checks for a real file first, so assets and hybrid's prerendered
  `dist/<path>/index.html` pages are served as they are.
- **Static:** no rewrite. Vercel serves `dist/404.html` with a 404 status for
  any path with no file. It serves only the top-level one, so under
  `i18n.routing: 'prefix'` a missing `/es/…` path gets the default locale's
  404 page.
- **Caching:** `Cache-Control: public, max-age=31536000, immutable` on
  `app-<hash>.js`, `app-<hash>.css`, `styles-<hash>.css`, `chunks/`,
  `_puzzle/chunks/` and `locales/`. Vercel matches paths without regard to
  case, so the rules name each hashed output rather than any `-<hash>` suffix,
  and static page modules keep the default revalidation, as on Netlify.

Commit `vercel.json` and import the repository in Vercel.

## Netlify

`netlify.toml` sets the build command and `publish = "dist"`, then:

- **SPA and hybrid:** `/*` rewrites to `/index.html` with a 200. Netlify never
  hides a real file behind a rule, so assets and prerendered pages win.
- **Static:** no rewrite; Netlify serves `dist/404.html` for missing paths by
  itself. Under `i18n.routing: 'prefix'`, add one rule per other locale (the
  file has the block commented out, and the CLI prints the exact lines):

  ```toml
  [[redirects]]
    from = "/es/*"
    to = "/es/404.html"
    status = 404
  ```

- **Caching:** a year on `app-*.js`, `app-*.css`, `styles-*.css`, `chunks/`,
  `_puzzle/chunks/` and `locales/`. Static page modules
  (`_puzzle/<slug>-<hash>.js`) keep Netlify's default revalidation, because
  `build.hashNames: false` gives them names a path pattern cannot tell apart.

Commit `netlify.toml` and link the repository in Netlify.

## Cloudflare Pages

Cloudflare Pages needs no routing rules, and the template has none on purpose:
its `_redirects` rules apply even when a file exists, so the usual
`/* /index.html 200` would serve the shell in place of your JavaScript.

- **SPA:** with no top-level `404.html` in `dist/`, Pages serves the shell for
  every path that is not a file. Keep it that way: an `app/public/404.html` in
  an SPA switches Pages to 404 mode and breaks every client route. The CLI
  warns when it finds one.
- **Static:** Pages serves the nearest `404.html` up the folder tree with a 404
  status, so `dist/es/404.html` answers missing `/es/…` paths with no extra
  rule.
- **Hybrid:** with a catch-all route, the build writes `dist/404.html`, so a path
  with no prerendered page answers 404 with that page, and the router then
  draws the right route. Prerendered routes answer 200.
- **Trailing slashes:** Pages redirects `/about` to `/about/` before serving
  `about/index.html`. The router treats both the same.
- **Caching:** `_headers` sets a year on `app-*.js`, `app-*.css`,
  `styles-*.css`, `chunks/`, `_puzzle/chunks/` and `locales/`.

Set the build command to `npm run build` and the output directory to `dist`.

## nginx

`nginx.conf` is a `server` block to paste into your config. Set `server_name`
and `root` (the folder you upload `dist/` to), then run `nginx -t` and reload.

- **SPA and hybrid:** `try_files $uri $uri/ /index.html` serves a file, then a
  folder's `index.html` (hybrid's pages), then the shell.
- **Static:** `try_files $uri $uri/ =404` with `error_page 404 /404.html`.
  Under `i18n.routing: 'prefix'`, add a `location /es/ { … }` block per other
  locale with its own `error_page` (commented in the file).
- **Caching:** a case-sensitive regex location matches the build's hash
  (`-` or `.`, then eight upper-case base32 characters) on `.js`, `.css` and
  `.json`, and caches those for a year. A missing hashed file is a plain 404,
  never the shell. Everything else gets `Cache-Control: no-cache`.

## Apache

`.htaccess` goes in `dist/`. It needs `mod_rewrite` and a server that allows
overrides for that folder (`AllowOverride All`, or at least `FileInfo`).

- **SPA and hybrid:** a folder with an `index.html` is served from it, and any
  other path that is not a file gets the shell.
- **Static:** the same folder rule, no shell, and `ErrorDocument 404 /404.html`.
  Under `i18n.routing: 'prefix'`, add an `<If>` block per other locale
  (commented in the file; Apache 2.4 or later).
- **No redirect to `/about/`:** `DirectorySlash Off` lets `/about` serve
  `about/index.html` straight away.
- **Caching:** `mod_headers` sets a year on the same hashed names as nginx, and
  `no-cache` on `.html`.

## Things every host shares

- **Environment values** (`env` in `puzzle.config.js`, read as
  `import.meta.env.KEY`) are written into the JavaScript at build time. When
  the host runs the build, set the variables your config reads from
  `process.env` in the host's build settings. They are public: never put a
  secret in `env`.
- **A sub-path deploy** (`routerBase: '/app'`) needs the host's rules moved
  under that path: the fallback becomes `/app/index.html`, and the static 404
  becomes `/app/404.html`. The templates assume the app is served from `/`.
- **Lazy chunks across a deploy:** with `build.splitting`, a tab opened before
  a deploy asks for the old chunk names. Hosts that keep each deploy's files
  (Vercel, Netlify and Cloudflare Pages do) serve them. On your own server,
  keep the previous `dist/chunks/` for a while after uploading the new build.
- **Hash routing** (`routerMode: hashRouter()`) needs no fallback at all, since
  the route lives after the `#`; the caching rules still help.
- **Magic Spells Sites** has no template yet: its config format is not
  documented in this repository.

Check any build locally with `puzzle preview`, which serves `dist/` with the
same rules these files give the host.
