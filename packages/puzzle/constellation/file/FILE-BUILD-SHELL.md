---
name: Production shell and page asset rewriting
status: built
path: compiler/internal/build/shell.go
language: go
summary: Metafile output names, static-import closures and production HTML modulepreloads.
connections:
  - FEATURE-HASHED-ENTRY-MODULEPRELOAD
  - FILE-BUILD
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-BUILD-OPTIONS
  - DOC-SPEC-BUILD
  - TEST-BUILD-AND-DEV-PIPELINE
notes:
  - kind: state
    text: >-
      shellHashSupport now returns a shellHashPlan: entry/styles (index.html can follow) plus
      entryPages/stylesPages (other public/**/*.html naming app.js|app.css / styles.css).
      rewriteShellHTMLRefs takes `strict`; only strict (explicit hashNames: true) makes a
      compiler-name reference with no emitted output an error. rewriteShell(…, strict, …) computes
      renames first, runs rewritePublicPages over every other copied public .html (rewrites only
      compiler-output references, no preloads, untouched when nothing changes), then the shell.
---

# shell.go

Shared production HTML helpers for the shell and generated static pages. The shell's emitted entry is matched by its source EntryPoint; its CSS bundle and the composed stylesheet supply the other rename targets. Fixed names remain no-op renames. Local script/link src/href references preserve deployment prefixes, queries and fragments; remote URLs stay unchanged. Copied public files take precedence over compiler names, including when their URL carries a deployment prefix. A reference to a fixed compiler asset with no emitted output fails the build before the staging swap.

`shellHashSupport` runs before bundling when `build.hashNames` is unset (hashing on by default): it reads `public/index.html` from the app's public dir (with its own walk of the public file set, since the copy into staging has not happened yet) and reports whether a `<script src>` loads `app.js` and whether any script/link tag references `styles.css`, through the same tag scan as the rewrite (`rewriteShellHTMLRefs` with nil renames). Build keeps the fixed name for whatever it cannot follow and prints `hashFallbackWarning` once per file. A missing shell supports neither.

Metafile output keys and import paths resolve against the emitting pass's working directory and the symlink-resolved staging tree. The SPA pass uses cwd; the page pass anchors at staging. Import arrays preserve breadth-first preload order; dynamic/external edges never enter the closure.

Preloads inherit the shell entry's prefix and verbatim crossorigin, or a static page's generated module base. A shell without a recognized entry skips preloads; when hashing the entry (only possible then with an explicit `hashNames: true`, or a shell that passed the pre-check), rewriteShell reports the missing reference. Missing-shell read errors suggest disabling hashNames; other read errors retain their I/O context. Links occupy their own lines before the closing head. A missing `</head>` is an error only when there are preloads to insert; a generated page with anything other than one module tag is a build error before the swap.
