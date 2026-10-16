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
---

# shell.go

Shared production HTML helpers for the shell and generated static pages. Names come from actual esbuild output records, including the entry's CSS bundle; the composed stylesheet contributes its own ContentHash name. Only script/link start-tag src/href attributes referencing the three supported local spellings are renamed.

Metafile output keys and import paths resolve against the emitting pass's working directory and the symlink-resolved staging tree. The SPA pass uses cwd; the page pass anchors at staging. Import arrays preserve breadth-first preload order; dynamic/external edges never enter the closure.

Preloads inherit the shell entry's prefix and verbatim crossorigin, or a static page's generated module base. They occupy their own lines before the closing head. Missing head, missing hashed entry reference and a generated page with anything other than one module tag are build errors before the swap.
