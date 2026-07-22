# Puzzle Framework

A SPA-first JavaScript framework with single-file components, reactive data binding, and Go-based compilation.

> **Status: 0.1.0 release candidate** (decisions D1–D76, shipped amendments
> through v1.43). The browser runtime, Go compiler, static generator, and CLI
> are implemented and covered by Go, Vitest/jsdom, type, package, example, and
> browser-focused checks. The first public npm release is being prepared.
>
> **[constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) is the canonical, frozen v1
> contract** — its per-amendment sections (§12–§41) are the source of truth for
> exactly what shipped when; if anything here conflicts with it, the spec wins.

## Features

- **Single-file components** (`.pzl`) with template + scripts + styles — optional TypeScript (`<scripts lang="ts">`), scoped styles (`<styles scoped>`), skeletons, comments, slots, and refs
- **Reactive data** with automatic view updates
- **Model/store architecture** with adapters, relationships, schema validation, persistence, and write sync
- **Liquid-style formatters** for data transformation
- **Nested routing** with view slots — history, hash, and memory modes; scroll restoration; base paths; anchors
- **Virtual DOM** with efficient diffing and pk-aware list keying
- **Built-in view & component animations** (Web Animations API), including visibility-triggered enters and app lifecycle hooks
- **Route transitions**: sequential by default; overlapping cross-fades and shared-element morphs *(experimental — see below)*
- **Go-based compiler** for fast builds and state-preserving live reload (store and JSON-safe local view state survive edits)
- **SPA-first output with optional static prerendering** — no request-time SSR server or hydration layer

> **Experimental in 0.1.0:** overlapping route transitions (`transitionMode:
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
for **macOS (arm64, x64)** and **Linux (x64, arm64)**; npm downloads only the one
matching your machine. Once installed, `puzzle` is on your `PATH` for npm scripts:

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

```bash
npx @magic-spells/puzzle init my-app   # or: npm exec @magic-spells/puzzle init my-app
cd my-app
npm install
npm run dev
```

### Unsupported platforms (e.g. Windows) or building from source

The prebuilt binary covers macOS and Linux. On any other platform — or if you
prefer to build the CLI yourself — install it from source with Go:

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
<!-- Conditionals (with {:else if} chaining, v1.9) -->
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

<!-- Multi-branch (v1.7) -->
{#case status}
  {:when 'loading'}
    <LoadingSpinner />
  {:when 'error'}
    <ErrorMessage />
  {:else}
    <SuccessContent />
{/case}

<!-- Inverted conditional (v1.7) -->
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
  <!-- Controlled form property; the handler updates component/store state -->
  <input value={ searchQuery } @input={ updateSearch(event) } />
  <select value={ selectedOption }></select>
</form>

<!-- Event modifiers (v1.7): prevent / stop / once + key filters, and they stack -->
<input @keydown:enter={ handleSubmit } @keydown:escape:prevent={ cancelEdit } />
<button @click:once={ claimReward }>Claim</button>
```

**Event modifiers (`prevent`, `stop`, `once`, and key filters like `:enter`/`:escape`) shipped in v1.7 (D38).** They stack; canonical order is key-gate → once-spend → preventDefault → stopPropagation → handler. See [constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) §5.

### Slots & Nested Routing

```html
<!-- Layout slot: the routed view renders at <Slot/> -->
<div class="user-layout">
  <nav><!-- user navigation --></nav>
  <Slot />
  <!-- routed view renders here -->
</div>

<!-- Named component slots (v1.21): static slot="name" on a direct child -->
<Card>
  <h2 slot="header">Card Title</h2>
  <p>Card content</p>
  <!-- no slot attr → default slot -->
</Card>
```

**Named slots shipped in v1.21 (D53).** The child declares regions with `<slot name="header">fallback</slot>`, and the call site routes a direct child into one with a static `slot="header"` attribute (stripped from the rendered output). Routed views fill the default slot only. See [constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) §24.

Reusable components declare default child content with `<children/>` (D74):

```html
<article class="card">
  <children><p>Fallback content</p></children>
</article>
```

## Built-in Formatters

Formatters transform data for display without modifying the underlying values.

### String Formatters

```html
{ text | trim }
<!-- Remove whitespace -->
{ name | capitalize }
<!-- First letter uppercase -->
{ title | upcase }
<!-- ALL UPPERCASE -->
{ title | downcase }
<!-- all lowercase -->
{ content | truncate(100) }
<!-- Limit to 100 chars -->
{ slug | replace('-', ' ') }
<!-- Replace characters -->
```

### Number Formatters

```html
{ price | currency('$', 2) }
<!-- $19.99 -->
{ progress | percentage }
<!-- 75% -->
{ count | number_with_delimiter }
<!-- 1,234,567 -->
{ rating | round(1) }
<!-- 4.3 -->
```

### Array Formatters

```html
{ names | join(', ') }
<!-- Join with commas -->
```

### Date Formatters

```html
{ createdAt | date('long') }
<!-- January 15, 2024 -->
{ updatedAt | date('short') }
<!-- 1/15/24 -->
{ publishedAt | timeago }
<!-- 2 hours ago -->
```

### Utility Formatters

```html
{ html | raw }
<!-- Skips entity escaping; still renders as text, not injected HTML -->
{ obj | json }
<!-- JSON stringify -->
```

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
    <children />
  </button>
</puzzle-view>

<scripts>
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

    // `click` is a callback prop (D16): a parent writes <Button @click={ handler }>
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
</scripts>

<styles>
  .btn { padding: 0.75rem 1.5rem; border: 1px solid transparent; border-radius:
  0.5rem; cursor: pointer; transition: all 0.2s; } .btn--primary { background:
  var(--primary-color); color: white; } .btn--medium { font-size: 1rem; }
</styles>
```

### Imports

Component imports live in `<scripts>` and can be relative or use `@`, the
built-in alias for your `app/` directory — no configuration, works from any
depth:

```js
import Icon from './Icon.pzl';              // relative
import Icon from '@/components/Icon.pzl';   // app/components/Icon.pzl
```

## Documentation

- **[User Guide](constellation/doc/DOC-USER-GUIDE.md)** - Complete guide to building Puzzle applications
- **[Component Reference](constellation/doc/DOC-PUZZLE-FILE.md)** - Complete .pzl component documentation
- **[Data Layer](constellation/doc/DOC-DATASTORE.md)** - Models, adapters, and store management
- **[Build Process](constellation/doc/DOC-COMPILATION-FLOW.md)** - Compiler and build system details

### AI project memory

This repository uses [Constellation MCP](https://github.com/ShiftinBits/constellation-mcp)
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

# Static prerendered pages plus the SPA bundle
puzzle build --static

# Upgrade the installed CLI, or only check what is available
puzzle upgrade
puzzle upgrade --check
```

Both commands are built and verified today. `puzzle build` compiles `.pzl` files and produces a working bundle; `puzzle dev` watches `app/`, rebuilds on change, and delivers full-page live reload over SSE (the reload client is injected into `index.html` at serve time). Both run the declared style pipeline automatically — `styles: { use: ['tailwindcss'] }` in `puzzle.config.js` (tailwindcss-only in v1) — so Tailwind output is included in the served/built `styles.css`.

On an interactive terminal, `build` and `dev` also use a cached, non-blocking
daily check to mention newer Puzzle releases. Set `PUZZLE_NO_UPDATE_CHECK=1` to
disable it; the check is skipped automatically when `CI` is set.

`puzzle upgrade` updates a project or global package-manager install;
`puzzle upgrade --check` only reports the current and latest versions.

The full CLI surface shipped in v1.4 (D32 — see [constellation/doc/DOC-SPEC.md](constellation/doc/DOC-SPEC.md) §13): `init`, `generate`, `add`, `doctor`, and `info` join `dev` and `build`.

```bash
# Scaffold a project; omitting the name prompts only in an interactive terminal
puzzle init my-app --template todos

# Generate a stub (component, view, layout, or model)
puzzle generate component UserCard --path components/ui/

# Wire up Tailwind, install a piece, or run diagnostics
puzzle add tailwind
puzzle add piece <name>
puzzle doctor
```

## License

Puzzle Framework is provided under a proprietary, source-available license. You may view the code for evaluation and internal use, but redistribution or commercial use requires written permission from the maintainers. See `LICENSE.txt` for full terms.
