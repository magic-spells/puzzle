---
name: D180 — bounded runtime component selection
status: built
connections:
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - DOC-LANGUAGE-CORE
  - DOC-RELEASE-SURFACE
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-SSG
  - TEST-COMPILER-CODEGEN
  - TEST-RUNTIME-LIFECYCLE
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D167-COMPONENT-FAMILIES
  - FEATURE-COMPONENT-SLOT
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DOC-COMPILER-DESIGN
  - DOC-RUNTIME-KERNEL
  - DOC-PUZZLE-FILE
  - COMPONENT-ESBUILD-PLUGIN
  - TEST-DOM-PATCHING
  - TEST-COMPOSITION-MARKERS
  - TEST-PRERENDER-OUTPUT
  - FILE-COMPONENT-SLOT
  - FILE-CODEGEN-COMPONENT
  - FILE-CHECK-COMPONENT
  - DECISION-D173-CORE-SEMANTICS
  - FILE-CODEGEN-LOWER
---

# D180 — bounded runtime component selection

## Context

Applications render several known card types from runtime data. An explicit `{#case}` works but repeats each component invocation and its props. The set is finite: every possible component is imported by the file before rendering. Open-ended module lookup would weaken that load and tree-shaking contract.

## Decision

`<Component is={ expression }>` is the single reserved built-in form. The expression evaluates to an imported compiled Puzzle component constructor. `null` or `undefined` renders nothing; any other non-component value is an error. Children forward as ordinary default-slot content to the selected component. A script-side map uses ordinary lookup: `<Component is={ cards[key] }>`.

Only `is` may read `<script>` module-scope imports and simple declared bindings directly. The conservative opaque-script scan includes subsequent `const`/`let`/`var` declarators, including ASI-terminated uninitialized declarators, but not destructuring patterns; expose those values through `data()` or a simple module alias. Imports and `const` selector bindings preserve normal row caching: mutating a const map's entries in place is not observed by a cached row. A selector read of a mutable `let`/`var` binding marks enclosing cached loop sites volatile so a parent render re-evaluates the selection. Loop/snippet/arrow bindings win over module bindings, which win over same-named data fields. All other props, spread operands and children retain normal data scope; the expression grammar and call restrictions stay closed.

The `is` attribute must be an authored value expression; a spread cannot supply the required selector. Missing, valueless, string, number, boolean, template-literal or duplicate `is` is a positioned compile error, including those non-component literals written inside braces. Nullish selectors remain valid. `name` and `from` are ordinary forwarded component props when `is` exists; they do not select a component. `Component` and the `Component.*` family root are reserved before user-component resolution; a user component file/class or import used under that tag name gets a rename hint. `puzzle generate` refuses that file name for components, views, layouts and family roots or members before writing a scaffold.

Every non-selector attribute uses normal component semantics: reactive props, event callback props and attribute spreads. Written order determines spread overrides, except a loop row's key is emitted last and wins over spreads. `flip` on `<Component>` is a positioned compile error; put it on a real keyed element. A swap mounts the new constructor with the current props. `bind:` remains unsupported on components under [[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]].

The compiler emits no global registry, manifest or runtime string-to-module lookup. `Component` selects a constructor rather than declaring a fallback-bearing composition marker. `dynamicComponent` wraps the ordinary constructor vnode in a stable `#component` comment-bracketed range. A constructor change tears down the outgoing instance and all descendants synchronously before mounting the replacement, including pending mounts and out animations; this swap bypasses hide hooks and leave transitions, and cleanup owns subscriptions/effects, listeners and refs. Removing the slot itself instead uses the chosen child's normal hide/leave path; a conditional replacement mounts before the selected child's leaving element, matching plain components. A component whose template root is `<Component>` occupies the complete range, recursively through nested component roots: keyed moves, replacements and error recovery all use its range end. Same-constructor updates retain the instance and use the normal component patcher. `__PUZZLE_HAS_COMPONENT_SLOT__` removes range handling from apps without the tag. Prerender applies the same selection, props and default-slot rule without a DOM.

## Alternatives

- **`name` + `from` selectors** — redundant sugar for `is={ cards[key] }`; keep one selection form.
- **Require `{#if}`/`{#case}` for every finite selection** — repeats the common invocation and props; retain these blocks when branches need different markup.
- **Open-ended `<component is="module-name">` or lazy component discovery** — imports are the finite load boundary; the selector consumes a constructor, never a module-name string.
- **Retain the previous instance across a constructor change** — normal conditional teardown is the lifecycle contract; retention needs its own design.

## Consequences

The reserved name may require a user-component rename. All children compose normally; nullish selection is empty and leaves an enclosing slot unfilled. Selection adds no route-style lazy loading. Attribute spread is a template attribute form, not an expansion of the expression language's prohibition on spread inside expressions.

Prettier/ESLint section scanners already skip brace groups, so standalone `{...expr}` needs no lexer-port change. Prettier preserves the tag, selector and spreads; ESLint treats only `is` as a module read while ordinary props retain data scope. DevTools uses normal mount/destroy/snapshot tree events for selected and nested children, with no protocol extension. Separate editor grammars need `Component` highlighted and Zed's self-closing whitelist extended.
