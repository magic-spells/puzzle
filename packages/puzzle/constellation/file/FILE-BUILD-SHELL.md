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

Shared production HTML helpers for the shell and generated static pages. The shell's emitted entry is matched by its source EntryPoint; its CSS bundle and the composed stylesheet supply the other rename targets. Fixed names remain no-op renames. Only script/link start-tag src/href attributes referencing the three supported local spellings are renamed.

Metafile output keys and import paths resolve against the emitting pass's working directory and the symlink-resolved staging tree. The SPA pass uses cwd; the page pass anchors at staging. Import arrays preserve breadth-first preload order; dynamic/external edges never enter the closure.

Preloads inherit the shell entry's prefix and verbatim crossorigin, or a static page's generated module base. A shell without a recognized entry skips preloads; when hashing the entry, rewriteShell reports the missing reference. Missing-shell read errors suggest disabling hashNames; other read errors retain their I/O context. Links occupy their own lines before the closing head. Missing head and a generated page with anything other than one module tag are build errors before the swap.
