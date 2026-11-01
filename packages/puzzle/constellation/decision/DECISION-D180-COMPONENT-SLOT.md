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
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DOC-COMPILER-DESIGN
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

Apps render one of several known card types from runtime data. An explicit `{#case}` works but repeats each component invocation and its props. The set is finite: every possible component is imported by the file before rendering. An open-ended module lookup would break that load and tree-shaking contract.

## Decision

### The form

`<Component is={ expression }>` is the single reserved built-in form. The expression evaluates to an imported compiled Puzzle component constructor. `null` or `undefined` renders nothing (an enclosing slot stays unfilled); any other non-component value is an error. Children forward as ordinary default-slot content to the selected component. A script-side map uses ordinary lookup: `<Component is={ cards[key] }>`.

### What `is` may read

Only `is` may read `<script>` module-scope imports and simple declared bindings directly. The opaque-script scan includes later `const`/`let`/`var` declarators, ASI-terminated uninitialized ones included, but not destructuring patterns; expose those through `data()` or a simple module alias. Lookup order: loop/snippet/arrow bindings, then module bindings, then same-named data fields. All other props, spread operands and children keep normal data scope; the expression grammar and its call restrictions stay closed.

Imports and `const` selectors keep normal row caching, so mutating a const map's entries in place is not observed by a cached row. A selector that reads a mutable `let`/`var` binding marks enclosing cached loop sites volatile, so a parent render re-evaluates the selection.

### Compile errors and reserved names

`is` must be an authored value expression; a spread cannot supply it. Missing, valueless, string, number, boolean, template-literal or duplicate `is` is a positioned compile error, including those non-component literals written inside braces. Nullish selectors are valid. `name` and `from` are ordinary forwarded props; they do not select a component.

`Component` and the `Component.*` family root are reserved before user-component resolution; a user component file/class or import used under that tag name gets a rename hint. `puzzle generate` refuses that name for components, views, layouts and family roots or members before writing a scaffold.

`flip` on `<Component>` is a positioned compile error; put it on a real keyed element. `bind:` stays unsupported on components ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]).

### Props and slots

Every non-selector attribute uses normal component semantics: reactive props, event callback props and attribute spreads. Written order decides spread overrides, except a loop row's key is emitted last and wins over spreads.

A direct `<Component slot="x" is={ current }>` child takes part in named-slot routing through its outer selection range; the consumed routing attribute is stripped from the selected child's props. Outside that position, `slot` is an ordinary forwarded prop.

### Runtime

There is no global registry, manifest or runtime string-to-module lookup. The compiler-support helper `dynamicComponent` (`client-runtime/views/componentSlot.js`) wraps the ordinary constructor vnode in a stable comment-bracketed range (tag `COMPONENT_SLOT_TAG`, `'#component'`, in `ViewNode.js`). `__PUZZLE_HAS_COMPONENT_SLOT__` removes the range handling from apps without the tag.

- **Same constructor**: the instance is kept and patched by the normal component patcher.
- **Constructor change**: the outgoing instance and all its descendants are torn down synchronously, pending mounts and out animations included, then the new constructor mounts with the current props. This swap bypasses hide hooks and leave transitions; normal cleanup releases subscriptions, effects, listeners and refs.
- **Removing the slot itself** uses the chosen child's normal hide/leave path. A conditional replacement captures the old DOM range before unmount and mounts before its first node still in the parent, matching plain components, through dispatcher and nested component roots too.
- **A component whose template root is `<Component>`** occupies the whole range, recursively through nested component roots: keyed moves, replacements and error recovery all use its range end.

Prerender applies the same selection, props and default-slot rule without a DOM.

## Alternatives rejected

- **`name` + `from` selectors**: redundant sugar for `is={ cards[key] }`; keep one selection form.
- **Require `{#if}`/`{#case}` for every finite selection**: repeats the common invocation and props. Those blocks remain the tool when branches need different markup.
- **Open-ended `<component is="module-name">` or lazy component discovery**: imports are the finite load boundary; the selector takes a constructor, never a module-name string.
- **A fallback-bearing composition marker**: `Component` selects a constructor; it is not a marker like `<Slot>`.
- **Keep the previous instance across a constructor change**: normal conditional teardown is the lifecycle contract; retention would need its own design.

## Consequences

The reserved name may force a user-component rename. Selection adds no route-style lazy loading. Attribute spread is a template attribute form, not an exception to the expression language's ban on spread inside expressions.

Tooling: the Prettier/ESLint section scanners already skip brace groups, so `{...expr}` needs no lexer-port change. Prettier preserves the tag, selector and spreads; ESLint treats only `is` as a module read. DevTools sees selected and nested children through the normal mount/destroy/snapshot tree events, with no protocol extension. The editor grammars highlight `Component`, and Zed's self-closing whitelist includes it.
