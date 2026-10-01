# Typed Todos — Puzzle + TypeScript

A small todo app that uses TypeScript throughout, demonstrating Puzzle's
`<script lang="ts">` support (v1.22, D54).

## What's typed

- **Model** (`app/models/todo.ts`) — a `PuzzleModel` subclass with a typed schema,
  a typed computed getter, and a `TodoRecord` type re-used across the app.
- **Routes** (`app/routes.ts`) — typed with the `Route` interface from the package.
- **`.pzl` files** — every `<script>` block declares `lang="ts"`. `data()` returns
  a declared model interface, `props`/events are typed, and `getData<T>()` is
  parameterized.

## How it works

Puzzle is **transpile-only** for TypeScript, exactly like Vite: the compiler
threads `lang="ts"` through to esbuild, which strips the types during the build.
The Go compiler never parses TypeScript — `<script>` stays an opaque string.
There is no type-checking in the build. `npm run typecheck` (plain `tsc`) checks
the app's `.ts`/`.js` files and declarations, but not the `<script>` bodies
inside `.pzl` files. `npx puzzle check` (D165) covers those as well: it
type-checks the `.ts` modules, every `.pzl` script, and the template
expressions, using the app's own TypeScript.

```bash
npm install
npm run dev        # dev server with live reload
npm run build      # production build (types stripped)
npm run typecheck  # tsc --noEmit (strict) — .ts/.js files and declarations
npx puzzle check   # .ts modules, .pzl scripts and template expressions
```

The app entry is `app/app.ts` — the build starts from `app/app.ts` when it
exists, otherwise `app/app.js`, and refuses an app that has both. It imports the
extensionless `.ts` modules, which esbuild resolves natively.
