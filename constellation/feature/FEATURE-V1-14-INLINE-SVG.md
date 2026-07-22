---
name: "v1.14 — {#svg} inline SVG assets"
status: verified
connections:
  - DECISION-D46-INLINE-SVG
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
verified_at: '2026-07-11T04:53:46.945Z'
verified_sha: 90c993d6d39c09b4794754baf574f883cf59f1e9
notes:
  - kind: verified
    text: >-
      Verified at 90c993d: shipped end-to-end (parser, codegen resolve pass, plugin WatchFiles,
      runtime string-children seed, pzlc --assets, scaffold icon); all suites green.
    sha: 90c993d6d39c09b4794754baf574f883cf59f1e9
  - kind: state
    text: >-
      SVG-asset DEDUP amendment (branch feat/svg-asset-dedup, stacked on
      fix/router-commit-window-and-store-guard). Emission-level optimization only — NO SPEC/D-number
      change, frozen D46 runtime contract preserved (byte-identical rendered DOM, island-frozen
      string-children seeded once, same .pzl-positioned missing/malformed-file errors, same
      WatchFiles rebuilds).


      Problem: the original v1.14 emission inlined each {#svg}'s root attrs + inner markup as string
      literals at EVERY use site, so a shared icon set duplicated massively in the bundle
      (pyramid-puzzle: ~75 icons, check.svg 24x / refresh-cw 21x / arrow-right·plus·minus 15x each).


      Design: bundled builds now dedup via esbuild virtual modules keyed by the resolved asset path,
      so each unique icon is stored ONCE across the whole bundle. Codegen (codegen.Options.SVGDedup,
      set true by the plugin) emits per use site an `import __svg_N from
      '@magic-spells/puzzle/svg-asset/<src>'` + a factory call `__svg_N([key])` instead of the
      inline ViewNode; a {#for}-body-root {#svg}'s reconciliation key rides through as the factory
      arg. The plugin (compiler/internal/plugin/svgasset.go) resolves that specifier to the abs svg
      path (Namespace `puzzle-svg-asset`) so esbuild dedups by file, and serves a shared module
      (codegen.SVGAssetModule) exporting `(key) => new ViewNode('svg',
      key===undefined?__a:{...__a,key}, __s)` — same vnode shape as inline. codegen still
      reads+scans the file at compile time (validation/errors/InlinedFiles unchanged); the plugin
      re-scans (same parser.ScanSVGFile) to build the module. parser.Element gained a sibling RawSrc
      field (set by codegen's resolve pass alongside RawInner).


      pzlc STANDALONE (--assets, no bundler) keeps inlining (SVGDedup off) so its output stays a
      self-contained module with no unresolved virtual imports — this is why inline_svg.golden.js is
      unchanged (golden = standalone path). Tests: codegen svgdedup_test.go (2 use sites → 1 import
      + refs; key passthrough; standalone-inline guard; SVGAssetModule shape) + plugin
      TestPluginSVGDedup (same icon across 2 files → markup stored once) + vitest inline-svg.test.js
      'shared-module factory shape (dedup)' block (fresh vnode per call, shared frozen seed,
      island-freeze on patch, key passthrough). 373 vitest + all Go packages green.


      Real-app proof (pyramid-puzzle, minified dist/app.js, both binaries real): WITH dev seed 506
      KB → 473 KB (-33 KB); seedless (dev seed stubbed) ~468 KB → 434.6 KB / 97.9 KB gzip. Browser
      sanity at :3461 (dev seed): board + task overlay + Studio (all icon sets) render, zero console
      errors. The prebuilt repo-root ./puzzle binary was rebuilt (go build -o puzzle
      ./compiler/cmd/puzzle) so ./puzzle build uses the new codegen.
---

# v1.14 — `{#svg}` inline SVG assets

`{#svg 'icons/cart.svg'}` inlines an SVG from `app/assets/` at compile time as an island-frozen `<svg>` vnode. Driven by [[DECISION-D46-INLINE-SVG]]; SPEC §18.

## Intent

The shared-icon workflow (Shopify's `{% render 'icon-cart' %}`): one `currentColor` SVG file, referenced by name from many templates, recolored by hover classes on the parent button — without hand-pasting markup or paying per-patch diff cost on icon internals.

## Scope

**In:**
- Parser: `InlineSVG` AST node; `{#svg 'path'}` as the first **void** block tag (dedicated stray-`{/svg}` error); `ScanSVGFile` (prolog/DOCTYPE strip, single depth-counted `<svg>` root, root-open-tag attr extraction, verbatim inner markup — contents never template-parsed).
- Codegen: `resolveInlineSVG` pass over template + skeleton ASTs; `Element.RawInner` → `new ViewNode('svg', {…}, "<inner>")` string children; `Options.AssetsDir`; `Compile` → `*Result{JS, InlinedFiles}` (populated even on error).
- Plugin/dev: `WatchFiles` from `InlinedFiles` — `.svg`-only edits rebuild under `puzzle dev`; missing-file builds recover when the file appears. `app/assets/` never copied to `dist/`.
- Runtime: string-typed vnode children seeded once via `innerHTML`, island-owned (D44) thereafter; root attrs/listeners patch normally; re-seed only on a changed string.
- CLI: `pzlc --assets`; `puzzle init` default template ships `app/assets/icons/heart.svg` used in `Home.pzl`.

**Out (rejected — see the decision card):** per-use attributes/params on the tag; `{@svg}`; generic `{#asset}`; parsing file contents into vnodes; a general raw-HTML vnode.

## Outcome

Shipped and verified end-to-end: all Go packages green (parser/codegen/plugin/build incl. the WatchFiles regression + recovery tests), vitest suite green with new string-children runtime tests, golden `inline_svg.golden.js`, and a live `puzzle init` → `puzzle build`/`puzzle dev` run confirming the inlined vnode in the bundle and `.svg`-edit live reload.
