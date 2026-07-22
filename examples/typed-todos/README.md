# Typed Todos — Puzzle + TypeScript

A small todo app that uses TypeScript throughout, demonstrating Puzzle's
`<scripts lang="ts">` support (v1.22, D54).

## What's typed

- **Model** (`app/models/todo.ts`) — a `PuzzleModel` subclass with a typed schema,
  a typed computed getter, and a `TodoRecord` type re-used across the app.
- **Routes** (`app/routes.ts`) — typed with the `Route` interface from the package.
- **`.pzl` files** — every `<scripts>` block declares `lang="ts"`. `data()` returns
  a declared model interface, `props`/events are typed, and `getData<T>()` is
  parameterized.

## How it works

Puzzle is **transpile-only** for TypeScript, exactly like Vite: the compiler
threads `lang="ts"` through to esbuild, which strips the types during the build.
The Go compiler never parses TypeScript — `<scripts>` stays an opaque string.
There is no type-checking in the build; run `npm run typecheck` (plain `tsc`)
for that.

```bash
npm install
npm run dev        # dev server with live reload
npm run build      # production build (types stripped)
npm run typecheck  # tsc --noEmit (strict) — editor-grade checking
```

The app entry stays `app/app.js` (the build resolves that exact path); it imports
the extensionless `.ts` modules, which esbuild resolves natively.
