---
name: D190 — `env` config values, read as `import.meta.env.KEY`
status: built
connections:
  - FILE-CONFIG
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-BUILD-WATCH
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-DEV-SERVER
  - FILE-PACKAGE
  - COMPONENT-DEV-SERVER
  - DOC-SPEC-ANATOMY
  - DOC-SPEC-BUILD
  - DOC-RELEASE-SURFACE
  - DECISION-D54-TYPESCRIPT-SCRIPTS
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D175-TRANSLATIONS
  - TEST-BUILD-AND-DEV-PIPELINE
notes:
  - kind: gotcha
    text: >-
      The node script's JSON.stringify replacer keeps an unset value as `null` only inside `env`
      (`this === c.env`), so `validate` can name the key (`env.API_URL … got null`) instead of the
      key silently vanishing. Every other key keeps JSON's drop-undefined behaviour, which existing
      configs rely on: `dev: { proxy: { '/api': process.env.API_ORIGIN } }` with the variable unset
      must still build. A whole-config replacer turns that target into null, it fails proxy
      validation, and every command stops; TestLoadConfigNullBehavesAsUnset has a `proxy target
      undefined` row for it.
---

# D190 — `env` config values, read as `import.meta.env.KEY`

## Context

An app needs values that differ per environment: an API origin, a feature flag, a public key. `import.meta.env.KEY` is the spelling authors arriving from Vite already type. Without a define it builds unchanged and throws in the browser, and `puzzle check` rejects it.

## Decision

- **Config.** `env` is a top-level flat object in `puzzle.config.js`. Keys are JavaScript identifiers (`expr.IsIdentifier`: reserved words and non-ASCII names work); values are strings, numbers or booleans. `validate` checks both in Go and reports one line, like every other key (`puzzle.config.js: env.API_URL must be a string, number or boolean; got null`); a non-object `env` gets `env must be a flat object of strings, numbers or booleans; got …`. Absent, `null` or `undefined` means unset. The config is JavaScript, so it reads `process.env` itself.
- **Defines.** `bundleDefines` ([[FILE-BUILD-OPTIONS]]) maps each `import.meta.env.KEY` to its JSON literal and the bare `import.meta.env` to the whole object (`{}` without `env`). Every bundle the compiler makes goes through it: build, dev, both prerender passes, static pages, both dev builders. A direct read compiles to its literal alone; destructuring, a computed key, an undeclared key or `typeof import.meta.env` pulls in the full object. An undeclared key reads `undefined` and never throws.
- **Public.** The values are written into the shipped JavaScript, so secrets do not belong in `env`. Compile-time substitution only: no runtime code.
- **Types.** The root `puzzle-env.d.ts` (`/puzzle-env`) declares `ImportMetaEnv` (index signature `string | number | boolean | undefined`) and `ImportMeta.env`; an app augments `ImportMetaEnv` with its exact keys. It is the one file the exports map, the `puzzle check` shim and the scaffold tsconfig load.
- **Threading.** `cfg.Env` enters where `i18n` does: `passContext.env` for a one-shot build, `WatchOptions.Env` for `puzzle dev`, `StaticWatchBuilder.cfg` for static dev; it reaches `bundleDefines` on `bundleFlags.Env`.
- **Dev.** `puzzle dev` reads the config once; an `env` edit prints the restart advisory like any other key. A config that fails to load drops `env` with everything else, and the fallback warning names it.
- **Not built:** modes, `.env` file loading, `DEV`/`PROD`/`MODE` built-ins, prefix filtering, a function-form config. A view test under Vitest sees Vitest's own `import.meta.env`.

## Alternatives rejected

- **Bare `import.meta.env` always `{}`**: destructuring and computed reads would see no values.
- **Define the bare object only when the source mentions `import.meta.env`** (a usage bit beside `HasLazy`, [[DECISION-D89-FEATURE-USAGE-TREESHAKE]]): byte-identical bundles for apps that never read it, but about ten lines of scan code to avoid a renaming permutation, and a package in `node_modules` that reads `import.meta.env` would throw again.
- **Define it only when `env` is set**: no code, but an app without `env` throws on any read.
- **Carry env on the plugin** (a field plus `SetEnv`, read through `pl` in `bundleDefines`): it touches fewer signatures but measured 7 lines larger than threading it beside `i18n`.
- **Validate values in the node script**: a throw there reaches the user as node's uncaught-exception dump of the compiler's internal script, not a config error.

## Consequences

- The minified names of every bundle permute, even in an app that never reads `import.meta.env`. esbuild turns any non-primitive define into an injected `<define:import.meta.env>` module and adds an import of its symbol to every file it parses; unused, it is tree-shaken and emits nothing, but the extra source and symbols change the minifier's slot order (hello-world +6 raw bytes, gzip unchanged). A primitive define changes no bytes.
- A Vite-style library in `node_modules` that reads `import.meta.env.X` gets `undefined` instead of a TypeError.
