---
name: "D59 — Scoped styles: <style scoped> via native @scope wrapping"
status: verified
connections:
  - DECISION-D12-TAILWIND-FIRST
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D46-INLINE-SVG
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-PUZZLE-FILE
  - DOC-SPEC
verified_at: '2026-08-24T19:03:23.810Z'
code_refs:
  - compiler/internal/codegen/codegen.go
  - compiler/internal/plugin/plugin.go
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D59 — Scoped styles: `<style scoped>` via native `@scope` wrapping

A bare `scoped` attribute confines a `<style>` block to the component's own subtree by wrapping the verbatim CSS in a native `@scope` rule and stamping one static attribute on the template root. The compiler still never parses a CSS selector ([[DECISION-D12-TAILWIND-FIRST]]).

## Decision
- **Spelling: bare static `scoped`** — the only legal attribute on `<style>`. A valued `scoped="true"`/`scoped={x}` or any other attribute is a positioned compile error (did-you-mean where close). Without it, the block is global CSS.
- **Scope id:** `pzl-` + 8-hex FNV-1a of the compiler-relative, forward-slash-normalized path (`codegen.ScopeID`) — never the absolute path, so goldens reproduce across machines. Renaming a `.pzl` changes its id; CSS and stamp move together in the same rebuild.
- **Root-only stamp:** codegen adds the static attribute `data-<scopeId>` to the template root — the `<puzzle-view>` vnode in a view (so view skeletons are covered too), the single root element or component in a component (a component skeleton's root gets its own stamp). Descendants are covered by the cascade. **Exception:** a component whose single root is a resolved `{#svg}` takes no stamp — its root is the SVG file's shared markup ([[DECISION-D46-INLINE-SVG]]) — so a scoped block there matches nothing; wrap the `{#svg}` in a real element.
- **Wrapping:** the plugin's styles collector stores `@scope ([data-<scopeId>]) {\n<verbatim body>\n}` (`codegen.ScopedCSS` is the single source, so id and stamp always agree). Aggregation, pruning and the Tailwind pipeline treat it as plain CSS.
- **No lower boundary.** Scoped means "doesn't leak out"; the block still cascades into nested child components. `@scope` proximity already resolves the collision case: at equal specificity the nearer scope root wins, so two components with the same scoped selector do not affect each other.
- Browsers without `@scope` treat the block as global — fail-open, not breakage.

## Alternatives rejected
- Vue-style compile-time selector rewriting — requires parsing every selector (combinators, pseudo-classes, nested `@media`) in Go; `@scope` buys nearly all of the value for a fraction of the code.
- Auto-scoping every `<style>` — existing blocks legitimately target `body`, keyframes, resets and third-party markup.
- A hard child boundary (`@scope … to (…)`) now — needs a universal component-root marker; additive later if apps hit it.
- CSS Modules / `:deep()` piercing — out of scope.
