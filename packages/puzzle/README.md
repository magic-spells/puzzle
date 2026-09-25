# Puzzle

A SPA-first JavaScript framework with single-file components, reactive data binding, and Go-based compilation.

**[▶ Live demo](https://puzzle-music-demo.vercel.app/)** — the [music example app](examples/music) built with Puzzle.

- **~200 ms production builds** — compile, bundle, Tailwind, and minify, end to end (todos example, Apple Silicon)
- **Small apps, honestly measured** — a minimal app is 20.8 KB gzip with the router, store, and validation included, not just a view layer; the complete todos example ships at 23.8 KB gzip. Regenerated every release by `npm run measure:size`
- **Zero JavaScript toolchain** — the CLI is one prebuilt Go binary; no Babel, no bundler config, no postinstall scripts

## Quick start

Install the `puzzle` CLI once (a prebuilt Go binary — no toolchain needed):

```bash
npm install -g @magic-spells/puzzle
```

Then scaffold and run a new app:

```bash
puzzle init my-app
cd my-app
npm install

puzzle dev     # develop with live reload
puzzle build   # build for production
```

Or add Puzzle to an existing project — one dev dependency gives you both the
client runtime and the CLI:

```bash
npm install -D @magic-spells/puzzle
```

> **Status: 0.7.0** — the current release. The browser runtime, Go
> compiler, static generator, and CLI are implemented and covered by Go,
> Vitest/jsdom, type, package, example, and browser-focused checks.
>
> Puzzle is pre-1.0, so **0.x minor bumps may carry breaking changes** — caret
> ranges do not cross them. See
> [CHANGELOG.md](CHANGELOG.md#upgrading-across-versions) before upgrading.
>
> **[constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) is the canonical, frozen v1
> contract** — its per-amendment sections (§12–§41) are the source of truth for
> exactly what shipped when; if anything here conflicts with it, the spec wins.

## Features

- **Single-file components** (`.pzl`) with template + scripts + styles — optional TypeScript (`<script lang="ts">`), scoped styles (`<style scoped>`), skeletons, comments, slots, and refs
- **Snippets** — `<Snippet fits="row" user>…</Snippet>` hands a component a template it can stamp repeatedly with its own data; parameters are declared as bare attributes, and a snippet forwards through a wrapper's `<Children/>`
- **Component families** — related components import as one unit and invoke with dot notation (`<Frame.Wrapper>`), scaffolded by `puzzle generate component Frame --family Wrapper,Content`
- **Reactive data** with automatic view updates
- **Two-way form binding with no directive** — `value={ draft }` and `checked={ todo.completed }` read *and* write; the compiler synthesizes the handler, so there is no `bind:` prefix and no mirror handler to maintain
- **Model/store architecture** with adapters, relationships, schema validation, persistence, and read/write server sync — opt-in via the `@magic-spells/puzzle/adapter` subpath (local-only apps ship none of it)
- **Server data with no loading code** — `findOne`/`findMany` inside a view's `data()` fetch whatever the store is missing and settle before the view commits, so a committed `null` always means "does not exist", never "still loading"
- **Chainable display formatters** — `{ title | downcase | truncate(40) }`
- **Translations** — `{ 'cart.title' | t }` with one `app/locales/<tag>.json` per language: nested files, CLDR plurals through `Intl.PluralRules`, missing keys filled from the default at build time, and only the active locale's hashed file downloaded; `this.ctx.i18n.setLocale('es')` switches in place. Apps without `i18n` configured ship none of it
- **Raw template blocks** — `{#raw}…{/raw}` turns off template-expression parsing so JSON, JavaScript, CSS, and syntax examples with literal braces compile as-is (HTML inside still renders normally)
- **Nested routing** with view slots — path routing by default, hash/memory via `hashRouter()`/`memoryRouter()` from `@magic-spells/puzzle/router-modes`; scroll restoration; base paths; anchors; mode-agnostic path-shaped hrefs via the built-in `link` formatter
- **On-demand route views** — `view: lazy(() => import('./views/Admin.pzl'))` in the route table downloads a view or layout the first time a navigation needs it, guards first
- **Virtual DOM** with efficient diffing and pk-aware list keying
- **Built-in view & component animations** (Web Animations API), including visibility-triggered enters and app lifecycle hooks
- **Route transitions**: sequential by default; overlapping cross-fades and shared-element morphs *(experimental — see below)*
- **App-level error handling** — one compiled `errorView` replaces a failed view in place with `{ error, info, retry }`; the `onError` hook funnels every framework-contained error
- **Go-based compiler** for fast builds and state-preserving live reload (store and JSON-safe local view state survive edits)
- **Type-checked templates** — `puzzle check` runs the app's own TypeScript over every `.pzl`, so a typo in `{ user.nmae }` is a type error reported at its real line and column
- **SPA-first output with two optional prerender modes** — `output: 'hybrid'` (prerendered pages the SPA takes over) and `output: 'static'` (true static pages, no router or `app.js`); no request-time SSR server or hydration layer
- **[Puzzle Pieces](https://github.com/magic-spells/puzzle-pieces) component library** — ready-made `.pzl` components installed with `puzzle add piece <name>` ([browse the catalog](https://magic-spells.github.io/puzzle-pieces/))

> **Experimental:** overlapping route transitions (`transitionMode:
> 'overlap'`) and shared-element morph transitions (`@magic-spells/puzzle/morph`)
> work and are tested individually, but their interaction matrix with other
> opt-in features (nested reused layouts, hash/base-path routing, anchors) has
> had less real-world mileage than the core. They're safe to try — just expect
> rougher edges there, and prefer the default sequential transitions where
> stability matters most.

## Installation

Install Puzzle as a dev dependency. This one package gives you **both** the client
runtime (`import { PuzzleView } from '@magic-spells/puzzle'`) and the `puzzle` CLI:

```bash
npm install -D @magic-spells/puzzle
```

The CLI is a prebuilt Go binary delivered through per-platform optional
dependencies (no compiler toolchain, no postinstall step). Prebuilt binaries ship
for **macOS (arm64, x64)**, **Linux (x64, arm64)**, and **Windows (x64)**; npm
downloads only the one matching your machine. Windows-on-ARM runs the x64 binary
under emulation. Once installed, `puzzle` is on your `PATH` for npm scripts:

```jsonc
// package.json
{
  "scripts": {
    "dev": "puzzle dev",
    "build": "puzzle build"
  }
}
```

### Scaffold a new project

With the CLI installed globally (`npm install -g @magic-spells/puzzle`):

```bash
puzzle init my-app
cd my-app
npm install
npm run dev
```

The generated app depends on `@magic-spells/puzzle` locally, so collaborators
who clone it only need `npm install` — no global CLI required.

### Other platforms, or building from source

The prebuilt binaries cover macOS, Linux, and Windows. On any other platform — or
if you prefer to build the CLI yourself — install it from source with Go:

```bash
go install github.com/magic-spells/puzzle/compiler/cmd/puzzle@latest
```

## Project Structure

```
my-puzzle-app/
├── app/
│   ├── app.js                # App initialization
│   ├── routes.js             # Route definitions
│   ├── models/               # Optional models and adapters
│   ├── views/                # Routed .pzl views
│   ├── components/           # Reusable .pzl components
│   ├── layouts/              # Route layouts with <Slot/>
│   ├── assets/               # Source assets, including {#svg} files
│   ├── styles/               # Tailwind entry + global CSS
│   └── public/               # Static assets + index.html
├── puzzle.config.js          # Compiler, styles, and output config
└── package.json
```

## Template Syntax

### Basic Interpolation

```html
<p>{ user.name }</p>
<h1>{ title | capitalize }</h1>
```

A literal brace is escaped with a backslash — `\{` and `\}` — anywhere an
expression could appear, attribute values included:

```html
<input pattern="[0-9]\{5\}" />
<p>Use \{ name \} to interpolate.</p>
```

For a whole block of literal braces (JSON, CSS, a syntax example) use
`{#raw}…{/raw}` instead — but `{#raw}` is not allowed inside an attribute
value, so the escape is the only way out there.

### Comments

```html
{## Single-line hash comments ##} {## Multi-line hash comments work too These
are useful for documentation ##}

<div class="user-card">
  {## TODO: Add user avatar ##}
  <h2>{ user.name }</h2>

  {#comment}
  <div class="temporarily-disabled">
    <p>{ user.bio }</p>
  </div>
  {/comment}
</div>
```

### Control Flow

```html
<!-- Conditionals with {:else if} chaining -->
{#if loggedIn}
  <p>Welcome back!</p>
{:else if loading}
  <p>Loading...</p>
{:else}
  <p>Please log in</p>
{/if}

<!-- Loops -->
{#for item in items}
  <li>{ item.name }</li>
{/for}

<!-- Multi-branch; a {:when} takes comma-separated values, matching any of them -->
{#case status}
  {:when 'loading', 'paused'}
    <LoadingSpinner />
  {:when 'error', 'no-connection'}
    <ErrorMessage />
  {:else}
    <SuccessContent />
{/case}

<!-- Inverted conditional -->
{#unless user.isAdmin}
  <p>Access denied</p>
{/unless}
```

See [constellation/doc/DOC-TEMPLATE-SYNTAX.md](constellation/doc/DOC-TEMPLATE-SYNTAX.md) for the full grammar.

### Events & Binding

```html
<!-- Event handlers -->
<button @click={ handleClick }>Click me</button>
<form @submit={ handleForm(event) }>
  <!-- Two-way: reads searchQuery AND writes the user's edit back. No handler. -->
  <input value={ searchQuery } />
  <select value={ selectedOption }></select>
</form>

<!-- A one-member path writes the record itself, through validated update() -->
<input type="checkbox" checked={ todo.completed } />

<!-- Event modifiers: prevent / stop / once + key filters, and they stack -->
<input @keydown:enter={ handleSubmit } @keydown:escape:prevent={ cancelEdit } />
<button @click:once={ claimReward }>Claim</button>
```

**Two-way binding** (D147): `value=` and `checked=` on a plain `<input>`, `<textarea>`, or `<select>` bind in both directions when the expression is a bare identifier or a one-member path — the compiler synthesizes the write-back handler. A bare identifier writes local state; a path writes the record through validated `update()`. Opt out with your own `@input`/`@change`, a non-path expression (`value={ String(x) }`), or a static `readonly`. Handlers on other events (`@blur`, `@keydown:enter`) coexist with the bind.

**Event modifiers** (`prevent`, `stop`, `once`, and key filters like `:enter`/`:escape`) stack; the canonical order is key-gate → once-spend → preventDefault → stopPropagation → handler. See [constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) §5.

### Slots & Nested Routing

```html
<!-- Layout slot: the routed view renders at <Slot/> -->
<div class="user-layout">
  <nav><!-- user navigation --></nav>
  <Slot />
  <!-- routed view renders here -->
</div>

<!-- Named component slots: static slot="name" on a direct child -->
<Card>
  <h2 slot="header">Card Title</h2>
  <p>Card content</p>
  <!-- no slot attr → default slot -->
</Card>
```

**Named slots.** The child declares regions with `<Slot name="header"/>`, and the call site routes a direct child into one with a static `slot="header"` attribute (stripped from the rendered output). An unfilled marker renders its fallback body — the content between paired marker tags — or nothing when self-closing; routed views fill the default marker only. See [constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) §24.

Reusable components declare default child content with `<Children/>`, and a paired marker's body is the fallback shown when the caller supplies nothing:

```html
<article class="card">
  <Children/>
  <footer><Slot name="footer"><button>OK</button></Slot></footer>
</article>
```

## Built-in Formatters

Formatters transform data for display without modifying the underlying values.
They chain left to right with `|`, so each one receives the previous result:

```html
{ title | downcase | replace('-', ' ') }
<!-- "My-Blog-Post" → "my blog post" -->
{ post.body | trim | truncate(140) | capitalize }
<!-- Chains can be any length; arguments go in parentheses -->
```

An unregistered formatter name never crashes a render — the value passes
through that step unchanged and a single `console.error` names the offender.

The built-ins are the **standard set** — the same names, arguments and meaning
in PuzzleKit and in Sites — plus the browser-only `link`, `timeago` and
`in_timezone`. There are no list-shaping formatters: sort, filter and pick
items in `data()` or a plain expression (`items[0]`, `items.at(-1)`). An app
formatter may reuse a standard name (the app's function wins), with a
development warning.

### String Formatters

```html
{ text | trim }
<!-- Remove whitespace -->
{ name | capitalize }
<!-- First character uppercase, the rest untouched: iPhone → IPhone -->
{ title | upcase }
<!-- ALL UPPERCASE -->
{ title | downcase }
<!-- all lowercase -->
{ content | truncate(100) }
<!-- At most 100 characters, the … included -->
{ slug | replace('-', ' ') }
<!-- Replace every occurrence -->
{ count | pluralize('comment') }
<!-- 1 comment / 3 comments; irregular: pluralize('person', 'people') -->
```

### Number Formatters

```html
{ price | currency('$', 2) }
<!-- $1,219.99 -->
{ progress | percentage }
<!-- 75.4 → 75% (the number as written) -->
{ count | number_with_delimiter }
<!-- 1,234,567 in the viewer's locale; number_with_delimiter(',') forces one -->
{ followers | compact_number }
<!-- 1.2K, 45K, 3.4M -->
{ rating | round(1) }
<!-- 4.3 -->
```

### Value Formatters

```html
{ names | join(', ') }
<!-- Join with commas -->
{ tags | size }
<!-- Items in a list, characters in text -->
{ subtitle | default('Untitled') }
<!-- Fallback for a missing, false, empty or [] value; 0 is kept -->
{ obj | json }
<!-- JSON with sorted keys -->
```

### Markup Formatters

Every interpolation is text unless it ends in one of these two, and both are
safe by construction:

```html
{ post.bodyHtml | raw }
<!-- Real HTML, always through an allowlist sanitizer -->
{ comment.text | newline_to_br }
<!-- Escaped text with a real <br> per line break -->
```

`raw` keeps document markup, links and images, `class` and `id` (DOMPurify's
defaults; no `id` on `<img>` and none starting with `__`), and
`target="_blank"` on links (always with `rel="noopener noreferrer"`; any other
target is dropped). It removes `<script>` (with its contents), `<style>`,
`<iframe>`, `<object>`, `<embed>`, `<svg>`, forms, every `on*` handler,
`style`, `name`, and any URL that is not relative or `http(s)` (links also keep
`mailto:` and `tel:`). Because `class` and `id` survive, sanitized content can
use your app's CSS and name its elements — for untrusted user HTML that is a
UI-overlay and naming risk (a `fixed inset-0` block over your page, an `id`
that shadows an undefined global), not code execution. A markup formatter must be the last formatter of a text
interpolation — in an attribute, a prop, a block subject or mid-chain it is a
compile error — so an app formatter can never inject markup. Apps that never
use either formatter ship none of this code.

### Date Formatters

`date`, `time` and `datetime` take the presets `short`, `medium` (the default),
`long` and `iso`, in the viewer's locale and time zone:

```html
{ createdAt | date }
<!-- Sep 24, 2026 -->
{ createdAt | date('long') }
<!-- September 24, 2026 -->
{ updatedAt | datetime('short') }
<!-- 9/24/26, 3:04 PM -->
{ updatedAt | datetime('iso') }
<!-- 2026-09-24T15:04:05-04:00 -->
{ publishedAt | timeago }
<!-- 2 hours ago -->
```

### Translations

With `i18n: { locales: ['en', 'es'], defaultLocale: 'en' }` in
`puzzle.config.js` and one `app/locales/<tag>.json` per locale:

```json
{
  "cart": {
    "title": "Your cart",
    "items": { "one": "{count} item", "other": "{count} items" }
  },
  "greeting": "Hello, {name}!"
}
```

```html
{ 'cart.title' | t }
<!-- Your cart -->
{ 'greeting' | t({ name: user.name }) }
<!-- Hello, Ada! — fills {name} -->
{ 'cart.items' | t({ count: cart.count }) }
<!-- 3 items — a numeric `count` picks the plural form -->
```

A missing key prints the key itself. Dates and numbers (`date`,
`number_with_delimiter`, `compact_number`, …) follow the active locale. Switch
languages with
`this.ctx.i18n.setLocale('es')`: the new file loads first, then the page
rebuilds in place and the choice is remembered. See `examples/i18n`.

## Single-File Components

```html
<!-- Button.pzl -->
<puzzle-view>
  <button
    class="btn { variantClass } { sizeClass }"
    @click={ handleClick }
    disabled={ disabled }>
    {#if icon}
    <Icon name={ icon } />
    {/if}
    <Children />
  </button>
</puzzle-view>

<script>
  import { PuzzleView } from '@magic-spells/puzzle';
  import Icon from './Icon.pzl';

  export default class Button extends PuzzleView {
    data(params, props) {
      const variant = props.variant || 'default'
      const size = props.size || 'medium'
      const icon = props.icon || null
      const disabled = !!props.disabled

      return {
        variant,
        size,
        icon,
        disabled,
        variantClass: `btn--${variant}`,
        sizeClass: `btn--${size}`
      }
    }

    // `click` is a callback prop: a parent writes <Button @click={ handler }>
    // and the compiler hands the child a function on this.props.click. There is
    // no this.$emit — the child gates the event, the parent's function does the work.
    events = {
      handleClick: (event) => {
        const { disabled } = this.getData()
        const { click } = this.props
        if (!disabled && typeof click === 'function') {
          click(event)
        }
      }
    }
  }
</script>

<style>
  .btn { padding: 0.75rem 1.5rem; border: 1px solid transparent; border-radius:
  0.5rem; cursor: pointer; transition: all 0.2s; } .btn--primary { background:
  var(--primary-color); color: white; } .btn--medium { font-size: 1rem; }
</style>
```

### Imports

Component imports live in `<script>` and can be relative or use `@`, the
built-in alias for your `app/` directory — no configuration, works from any
depth:

```js
import Icon from './Icon.pzl';              // relative
import Icon from '@/components/Icon.pzl';   // app/components/Icon.pzl
```

### Component families

Related components can import as one unit and invoke with dot notation. Group
them in a directory with a plain JS barrel — `.pzl` stays one class per file:

```
app/components/Frame/
  Frame.pzl  Wrapper.pzl  Content.pzl  index.js
```

```js
// index.js
import Frame from './Frame.pzl';
import Wrapper from './Wrapper.pzl';
import Content from './Content.pzl';

export { Frame, Wrapper, Content };
export default Object.assign(Frame, { Wrapper, Content });
```

```html
<script>
  import Frame from '@/components/Frame';
</script>

<Frame>
  <Frame.Wrapper>
    <Frame.Content>…</Frame.Content>
  </Frame.Wrapper>
</Frame>
```

A dotted tag is an ordinary member expression resolved against module scope —
no registry, no compiler magic. `puzzle generate component Frame --family
Wrapper,Content` scaffolds the whole directory, barrel included.

## Monorepo

The framework lives at `packages/puzzle` in the `magic-spells/puzzle`
repository; the repo root is a private shell whose scripts delegate here.
`packages/` holds everything that releases in lockstep with it:

- [`packages/puzzle-lang`](../puzzle-lang) — the Puzzle template language
  (lexer, section splitter, AST, positioned errors) as its own Go module, which
  the compiler imports
- [`packages/puzzle-pieces`](../puzzle-pieces) — the official component
  library (published to npm as `@magic-spells/puzzle-pieces`)
- [`packages/puzzle-devtools`](../puzzle-devtools) — the Chrome DevTools
  extension (ships as an extension zip, not npm)
- [`packages/puzzle-eslint`](../puzzle-eslint) and
  [`packages/puzzle-prettier`](../puzzle-prettier) — the `.pzl` lint and format
  plugins

Editor grammars live in their own repos — see Syntax Highlighting below.

## Puzzle Pieces

[Puzzle Pieces](../puzzle-pieces) is the official component library for
Puzzle — ready-made `.pzl` components (and their styles) you can drop into any
app. It lives in this monorepo and releases in lockstep with the framework:

```bash
puzzle add piece <name>
```

Pieces are fetched from the `@magic-spells/puzzle-pieces` npm package,
version-matched to your CLI — puzzle 0.7.x pulls the newest pieces 0.7.x — so a
piece is always authored for the compiler installing it. `--pieces-version`
pins an exact release; `--registry` accepts `npm:pkg[@version]`, a local
directory, or an http(s) URL.

A piece that is a component family installs path-preserving: its members land in
their own directory under the manifest's target
(`app/components/ui/NavigationMenu/Item.pzl`), barrel included, and
`pieces.lock` records each member by its full app-relative path.

Preview every piece in the live catalog at
[magicspells.io/puzzle-pieces](https://magicspells.io/puzzle-pieces).

## Syntax Highlighting

Editor extensions provide full `.pzl` highlighting — native HTML, JavaScript/TypeScript, and CSS per section, plus Puzzle's template expressions, directives, event bindings, and formatter chains:

- **[puzzle-vscode](https://github.com/magic-spells/puzzle-vscode)** - Visual Studio Code extension with snippets and completions
- **[puzzle-sublime](https://github.com/magic-spells/puzzle-sublime)** - Sublime Text 4 syntax package
- **[puzzle-zed](https://github.com/magic-spells/puzzle-zed)** - Zed extension (tree-sitter grammar)

Install instructions are in each repository's README.

## Documentation

- **[User Guide](constellation/doc/DOC-USER-GUIDE.md)** - Complete guide to building Puzzle applications
- **[Component Reference](constellation/doc/DOC-PUZZLE-FILE.md)** - Complete .pzl component documentation
- **[Data Layer](constellation/doc/DOC-DATASTORE.md)** - Models, adapters, and store management
- **[Build Process](constellation/doc/DOC-COMPILATION-FLOW.md)** - Compiler and build system details

### AI project memory

This repository uses [Constellation MCP](https://github.com/magic-spells/constellation)
as long-term project memory for AI-assisted development. The cards in
`constellation/` preserve decisions, features, data structures, component and
file relationships, flows, and plans so future AI conversations can recover the
full project context and build better plans without re-deriving earlier work.

## CLI Commands

```bash
# Development server with live reload
puzzle dev --port 3000

# Production build (default)
puzzle build

# True static pages (no router, no app.js; per-page mount module)
puzzle build --static

# Prerendered pages plus the SPA bundle the router takes over
puzzle build --hybrid

# Type-check .pzl scripts and template expressions with the app's own TypeScript
puzzle check

# Serve an existing build the way a production host will
puzzle preview
puzzle preview ./my-app --port 4000

# Per-phase timing tables for builds and dev rebuilds
puzzle build --profile-build
puzzle dev --profile-build

# Upgrade the installed CLI, or only check what is available
puzzle upgrade
puzzle upgrade --check

# Install the Puzzle agent skill for your coding tools, or refresh it later
puzzle add skills
puzzle upgrade skills
```

Every command above is built and verified today. `puzzle build` compiles `.pzl` files and produces a working bundle; `puzzle dev` watches `app/`, rebuilds on change, and delivers full-page live reload over SSE (the reload client is injected into `index.html` at serve time). Both run the declared style pipeline automatically — `styles: { use: ['tailwindcss'] }` in `puzzle.config.js` (tailwindcss-only in v1) — so Tailwind output is included in the served/built `styles.css`.

By default a build emits one `dist/app.js`, and a dynamic `import()` is inlined
into it. Set `build: { splitting: true }` in `puzzle.config.js` and each dynamic
`import()` becomes a lazy chunk under `dist/chunks/` that the browser fetches
only when that code path runs — the way to keep a heavy on-demand dependency (a
chart library, a diagram renderer, an editor) off the first page load. The entry
keeps its `app.js` name, static imports are unaffected, and total shipped bytes
do not grow: esbuild's ESM splitting has no chunk-loader runtime. The build's
size banner also names your largest dependencies and, in production builds,
flags any single one over 200 KB (the threshold assumes minified bytes, so dev
builds never warn).

Splitting adds one deployment rule: chunk filenames are content-hashed, so a
new deploy writes new ones, and a tab still holding the previous `app.js` will
ask for the chunk names that entry graph was built with. Keep the previous
`dist/chunks/` files available for a support window after a deploy, or deploy
immutably (each build to its own directory, with the old one still served). If a
lazy chunk does 404, the failure is contained the way any other pre-commit route
failure is: nothing commits, the page the user is on stays put, and the loader
rejection reports through `onError` as the `navigation` phase. A rejected import
is never cached, so the next attempt loads again — and once the client reloads,
it asks for the chunk names the current build wrote.

On an interactive terminal, `build` and `dev` also mention newer Puzzle releases.
The notice is printed from a cached answer and **never waits on the network** —
no build pays registry latency, ever. When that answer is more than an hour old
the command starts a detached background process to refresh it and exits without
waiting, so a release published since your last check is mentioned on the run
after the refresh lands rather than on the run that fetched it. A failed refresh
is not retried for fifteen minutes, so an unreachable registry costs one
short-lived process every quarter hour rather than one per command. Set
`PUZZLE_NO_UPDATE_CHECK=1` to disable it; the check is skipped automatically
when `CI` is set or output is not a terminal.

`puzzle preview` serves a build you already produced, with no watcher, no live
reload, and no `dev.proxy` — the artifact is checked exactly as it sits on disk.
Its optional argument is the **project** directory (its `dist/` is found for
you), not the output directory.
It serves per the resolved output mode: an SPA gets history-API fallback, hybrid
serves the prerendered page first and the shell otherwise, and static gets clean
URLs and a real `404.html` rather than the shell. It defaults to port 4000 so it
runs alongside `puzzle dev`.

`puzzle upgrade` updates the CLI you are running, resolved from the executable's
own install context rather than the current directory — bumping a project's
`@magic-spells/puzzle` dependency is npm's job, not the CLI's.
`puzzle upgrade --check` only reports the current and latest versions.

### Agent skill

`puzzle add skills` installs the Puzzle agent skill — how to write `.pzl` files,
routing, the data layer, static output — into every Claude Code, Codex, and
Cursor config directory it finds (`~/.claude`, `~/.codex`, `~/.cursor`). On an
interactive terminal you pick the targets from a checklist; scripts install to
all of them.

The skill is compiled into the CLI binary, so it always matches the version that
wrote it. Each install records which version that was, so re-running the command
is how you refresh it:

- An install matching your current CLI is skipped as up to date.
- An older one asks before it is replaced. Declining leaves it alone but still
  installs anywhere that has no skill yet.
- On a non-interactive terminal an older install is refused rather than asked
  about, and needs `--overwrite`.
- A symlinked install (a dev checkout linked into your config dir) is reported
  and left alone unless you pass `--overwrite`.

`puzzle upgrade skills` refreshes only the installs you already have, and
`puzzle upgrade` offers the same refresh automatically after it installs a new
version.

`puzzle check` type-checks every `.pzl` file with the TypeScript the app itself
has installed — Puzzle never installs one for you. A `lang="ts"` script is
checked as written; every template expression is re-emitted as typed statements,
so a typo in `{ user.nmae }` is a type error reported at its real `.pzl` line and
column. A plain-JavaScript component gets its template expressions checked and
its script body left alone.

The full CLI surface (see [constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) §13): `init`, `generate`, `add`, `check`, `doctor`, and `info` join `dev` and `build`.

```bash
# Scaffold a project; omitting the name prompts only in an interactive terminal
puzzle init my-app --template todos

# Generate a stub (component, view, layout, or model)
puzzle generate component UserCard --path components/ui/

# Wire up Tailwind, install a piece (see Puzzle Pieces above), or run diagnostics
puzzle add tailwind
puzzle add piece <name>
puzzle add skills
puzzle doctor
```

## License

Puzzle is released under the [MIT License](LICENSE.txt).

---

<p align="center">
  Made by <a href="https://github.com/coryschulz">Cory Schulz</a>
</p>
