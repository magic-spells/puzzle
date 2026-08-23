---
name: "D59 — Scoped styles: <style scoped> via native @scope wrapping"
status: verified
connections:
  - FEATURE-SCOPED-STYLES
  - DECISION-D12-TAILWIND-FIRST
  - DECISION-D35-NO-SASS
  - DECISION-D44-DOM-ISLANDS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-PUZZLE-FILE
  - DOC-SPEC
verified_at: '2026-07-14T07:08:05.177Z'
notes:
  - kind: verified
    text: >-
      Verified at ship: parseStylesScoped (bare-only, positioned errors + did-you-mean), shared
      codegen.ScopeID (FNV-1a over slash-normalized relative path), root-only stamp covering
      view/component/skeleton renders, plugin-side @scope wrapping with an id-agreement test;
      unscoped goldens byte-identical; 540 vitest + all Go green.
---

# D59 — Scoped styles: `<style scoped>` via native `@scope` wrapping

Settled (v1.27). A bare `scoped` attribute on `<style>` confines the block to
the component's own subtree — implemented by **wrapping the verbatim CSS in a
native `@scope` rule** and stamping one static attribute on the template root.
The Go compiler still never parses a single CSS selector.

## Context

[[FEATURE-SCOPED-STYLES]] was the lowest-priority backlog card ("may resolve
won't-build") because Tailwind-first apps rarely write `<style>` at all
(D12), and the classic implementation — Vue-style compile-time selector
rewriting (`.card h2` → `.card h2[data-x]`) — required a real CSS selector
transformer in Go, breaking the deliberate "compiler never parses CSS"
simplicity that killed Sass (D35). What changed: **native `@scope` reached
cross-engine Baseline** (Chrome/Edge 118, Safari 17.4, Firefox enabled by
default in 2025), making scoping a *wrapping* problem instead of a *parsing*
problem. At that price the card flipped from "maybe never" to "worth
shipping": the minority of apps writing real CSS get collision safety for
seven characters of opt-in.

## Decision

- **Spelling: bare static `scoped`** — the only legal attribute on
  `<style>`, mirroring `island` (D44) and `<puzzle-skeleton
  min-duration>` (D52) exactly: a valued `scoped="true"`/`scoped={x}` or any
  other attribute is a positioned compile error (did-you-mean where close).
  Absent → today's global emission, **byte-identical** (existing goldens
  unchanged).
- **Mechanism:**
  1. The compiler derives a stable scope id per `.pzl`: `pzl-` + 8-hex FNV-1a
     of the **compiler-relative path, forward-slash normalized** (never the
     absolute path — golden byte-reproducibility across machines; same
     stability posture as the {#svg} asset keys, D46).
  2. Codegen adds one **static attribute** `data-<scopeId>` to the template
     root element's attrs (the `<puzzle-view>` tag's vnode). Root-only — with
     `@scope`, descendants are covered by the cascade; there is no Vue-style
     per-node stamping. View-mode skeletons reuse the `<puzzle-view>` root
     attrs (D39), so skeleton renders are covered for free.
  3. The esbuild plugin's per-file styles collector stores the block wrapped:
     `@scope ([data-<scopeId>]) {\n<verbatim body>\n}`. Aggregation, sorting,
     pruning, and the Tailwind pipeline are untouched — `@scope` is plain CSS
     to everything downstream.
- **No lower boundary in the first cut.** Scoped means "doesn't leak OUT";
  the block still cascades INTO nested child components like normal CSS.
  Deliberate: (a) it's how CSS authors expect descent to work; (b) `@scope`'s
  proximity rule already resolves the acceptance case — when a child declares
  its own scoped rule for the same selector at equal specificity, the child's
  nearer scope root **wins the tie automatically**, so two components with
  colliding scoped selectors do not affect each other; (c) a hard boundary
  (`to (…)`) needs a universal component-root marker attribute and
  self-exclusion gymnastics — additive later if real apps hit it.
- **Docs carry one support sentence:** the `@scope` rule ships verbatim in
  the bundle; targets are the Baseline engines above. Un-supporting browsers
  treat the block as global (fail-open to v1 behavior, not breakage).

## Rejected alternatives

- **Compile-time selector rewriting (Vue-style attribute suffixing):** correct
  and boundary-precise, but requires parsing every selector (combinators,
  pseudo-classes, `@media` nesting) in Go — the exact complexity D35 refused
  for Sass. `@scope` buys ~95% of the value for ~2% of the code.
- **Auto-scoping every `<style>` block (no attribute):** breaking change to
  the frozen SPEC — existing blocks legitimately target `body`, keyframes,
  resets, third-party markup. Opt-in matches the framework's escape-hatch
  grammar (`island`, `min-duration`).
- **Hard child boundary now (`@scope … to (…)`):** see above; deferred, not
  rejected forever.
- **CSS Modules / `:deep()` piercing:** out of scope entirely (per the
  feature card).

## Consequences

- First-ever attribute on `<style>`; `parseAttrString`-family validation now
  runs for the styles section (previously attrs were silently discarded —
  that silent acceptance ends; stray attrs become loud).
- The scope id is derived from the path: **renaming a `.pzl` changes its
  scope id** — invisible in practice (id and CSS move together in the same
  rebuild).
- `<style scoped>` on a file whose root also carries `island` or morph
  attrs composes fine (one more static attr on the root vnode).
