---
name: Compilation and build flow
status: verified
verified_at: '2026-07-22T00:04:05.207Z'
connections:
  - DOC-SPEC
  - DOC-COMPILER-DESIGN
  - FLOW-BUILD
  - COMPONENT-COMPILER-CLI
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-SSG
  - COMPONENT-DEV-SERVER
---

# Compilation and build flow

This is the contributor-facing trace from a Puzzle app to `dist/`. See
[[FLOW-BUILD]] for guarantees and [[DOC-COMPILER-DESIGN]] for parser/codegen
internals.

## Inputs

A project contains:

```text
app/
  app.js
  routes.js
  components/
  layouts/
  views/
  assets/
  public/
  styles/
puzzle.config.js
package.json
```

`app/app.js` is the esbuild entry. Its imports discover routes, models, and
`.pzl` components. `puzzle.config.js` controls build/style/output behavior;
`@/` resolves to the app directory.

## Pipeline

1. Resolve the project and config, validate the mode, and reject reserved public
   output names before pruning anything.
2. Create esbuild options and install the `.pzl` plugin.
3. For each imported component, extract sections, parse the template, and emit
   the unchanged script plus its prototype render assignment.
4. Let esbuild resolve and bundle the complete module graph, including the
   Puzzle runtime and any TypeScript syntax.
5. Tree-shake the formatter registry from actual template usage.
6. Compose Tailwind output and collected component styles. Scoped blocks are
   wrapped in native `@scope`; unscoped blocks remain global.
7. Copy public files and write the JS, linked source map, CSS, and assets into a
   staging directory.
8. For static mode, run the prerender bundle over eligible routes and serialize
   route HTML, directory pages, and the catch-all `404.html`.
9. Atomically swap staging into `dist/`.

A failure at any step preserves the last good `dist/`.

## Component transformation

Input:

```html
<puzzle-view><h1>{ title }</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle'
export default class Home extends PuzzleView {
  data() { return { title: 'Home' } }
}
</script>
```

Conceptual plugin output:

```js
import { PuzzleView } from '@magic-spells/puzzle'
export default class Home extends PuzzleView {
  data() { return { title: 'Home' } }
}

Home.prototype.render = function () {
  // generated ViewNode tree
}
```

The real output also carries source mapping and imports needed by generated
nodes. User class semantics are not rewritten.

## Modes

- `puzzle build`: production ES2022 ESM, minified, linked map, console calls
  stripped by default.
- `puzzle build --mode development`: one readable development build.
- `puzzle build --static`: true static pages — build-time route HTML plus one
  per-page mount module, no `app.js` (D81).
- `puzzle build --hybrid`: production SPA bundle plus build-time route HTML the
  router takes over at navigation zero (D67).
- `puzzle dev`: incremental development build, recursive watch, static server,
  SPA fallback, and state-preserving SSE reload.

Static pages are an initial document optimization. The browser app takes over
at navigation zero; there is no runtime SSR server or hydration protocol.
