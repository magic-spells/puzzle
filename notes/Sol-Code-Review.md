# Puzzle 0.6.0 final review plan

## Goal

Close the two correctness gaps found in the static warm-rebuild path without
changing the architecture or adding new abstractions. Keep the fixes local,
preserve one-shot/static equivalence, and avoid speculative runtime-size work
before the release.

## Scope

1. Distinguish imported `public/` modules from copy-only public assets during
   static route classification.
2. Keep an empty static subset render from constructing application context or
   running `beforeMount`.
3. Update the existing Constellation prose to describe those already-intended
   contracts precisely.
4. Re-run the complete JavaScript and Go suites plus focused race/type checks.

No new cache, classifier layer, persistent Node worker, or browser-runtime
feature belongs in this fix.

## 1. Correct imported-public route classification

Affected code:

- `compiler/internal/build/route_deps.go`
- `compiler/internal/build/route_deps_test.go`
- Static-watch integration/equivalence tests where the existing public-asset
  cases live

Current failure:

`routeGraph.classify` skips every non-shell path below `public/` before asking
the committed esbuild graph whether the path is attributable to a route or is
render-wide. A JavaScript module imported from `public/` is therefore treated
like an unreferenced image: esbuild can rebuild the bundle while prerendering
selects zero routes and reuses stale HTML/data.

Implementation:

1. Keep the shell check first; `public/index.html` still forces a full render.
2. For another public path, consult the existing route graph before taking the
   copy-only fast path:
   - an attributable module adds its routes to the subset;
   - a render-wide module forces a full render;
   - only a path absent from both graph sets is copy-only and renders no routes.
3. Reuse the current `attribute`/`global` data and path normalization. Do not add
   another dependency map or duplicate the SPA watch classifier.
4. Preserve safe behavior for deletion/rename batches. A deleted imported
   module must not silently become an unimported public deletion; it should be
   recognized from the last committed graph so the rebuild either reports the
   compile failure or performs the required render.

Tests:

- An unimported public asset edit still selects zero routes.
- A public module imported by one page selects that page.
- A public module imported by render-wide application code selects a full
  render.
- Deleting an imported public module does not take the zero-route copy-only
  path.
- Include the root-level `public/` layout or symlink spelling in focused
  coverage only if the existing normalization tests do not already exercise
  the same lookup. Avoid redundant combinatorial cases.
- The static warm-rebuild equivalence test must compare the result with a clean
  one-shot `puzzle build --static`.

## 2. Make an empty subset truly context-free

Affected code:

- `client-runtime/ssg/index.js`
- `tests/static-prerender.test.js`

Current failure:

When `only` is an empty static filter, every page is correctly marked reused,
but the legacy zero-page fail-fast fallback still calls `createPageContext()`.
That runs `beforeMount` even though no route is being rendered, adding avoidable
work and allowing an unrelated public-asset save to fail on application setup.

Implementation:

1. Preserve the legacy fail-fast behavior for an ordinary full render whose
   route table produces no writable static pages.
2. Gate that fallback so it runs only when there is no subset filter
   (`only === null`), not when the caller explicitly supplied `only: []`.
3. Do not add a second lifecycle flag or move context ownership; the existing
   `builtContext` and normalized `only` state are sufficient.

Tests:

- Extend the existing empty-filter test with counted `beforeMount` and `data()`
  hooks and assert neither runs.
- Retain coverage proving a non-empty subset runs `beforeMount` once and
  `data()` only for rendered pages.
- Add or retain a full-render zero-page case proving the historical fail-fast
  behavior still executes `beforeMount`.
- Confirm hybrid mode continues to ignore the static-only filter.

## 3. Bring Constellation prose back into line

Before changing code, make the smallest wording corrections necessary in the
existing D155 neighborhood:

- `constellation/decision/DECISION-D155-ROUTE-LEVEL-INVALIDATION.md`: describe
  only **unimported** non-shell public assets as zero-render copy-only changes.
  Imported public modules already belong to the metafile classifier under
  D155/D156.
- `constellation/component/COMPONENT-DEV-SERVER.md`: make the same distinction
  if its current-state description implies that all public assets skip route
  rendering.
- `constellation/component/COMPONENT-SSG.md`: its current contract already says
  an `only` subset builds no context for excluded routes. Change it only if a
  short clarification about an empty subset is needed.

These are corrections to the existing D155/D156 contract, not a new behavior
decision, so no new numbered decision should be created. After implementation,
re-read the touched cards against the code and run `npx constellation lint`.

## 4. Verification and release gate

Run focused tests first, then the mandated full suites:

```bash
npx vitest run tests/static-prerender.test.js
cd compiler && go test ./internal/build
cd compiler && go test -race ./internal/build ./internal/plugin ./internal/dev
npm run test:types
npx constellation lint
npx vitest run
cd compiler && go test ./...
```

Acceptance criteria:

- Editing an imported public module cannot reuse stale prerendered HTML/data.
- Editing an unimported public asset remains a zero-route rebuild.
- `only: []` performs no application setup or route data work.
- Full-render zero-page lifecycle behavior remains unchanged.
- A warm rebuild and a clean one-shot static build remain byte-equivalent for
  the new imported-public cases.
- All checks above pass, with no unrelated source changes.

## JavaScript bundle-size conclusion

Do not add a separate runtime-slimming change for 0.6.0. The substantial new
JavaScript is in the Node-only SSG path, while the browser-runtime delta is
small. Splitting files, adding feature gates, or introducing another usage scan
would increase machinery without a meaningful shipped-size win. Revisit bundle
size only with a measured production bundle breakdown that identifies a
specific removable browser dependency.

## Release sequencing reminder

Publish `@magic-spells/puzzle-pieces@0.6.0` at or before the CLI packages. Then
publish the four platform packages, publish the root package from the tarball
produced by `release:prep`, and run `npm run verify:published`.
