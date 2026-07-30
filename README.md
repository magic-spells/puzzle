# Puzzle Pieces

Beautifully-behaved UI components for the [Puzzle framework](https://github.com/magic-spells/puzzle).
Tailwind-styled, accessible, morph-aware — and **copied into your app, not installed
from npm**.

**[▶ Browse the component library](https://magic-spells.github.io/puzzle-pieces/)** —
live docs and examples for every piece.

## Why copy-in?

Puzzle compiles `.pzl` single-file components, and `.pzl` files can't live in
`node_modules` — the compiler doesn't scan there. So instead of fighting that,
puzzle-pieces embraces it: each piece is source you copy into `app/components/ui/`.
Your `puzzle build` compiles it, your Tailwind scan picks up its classes, and the
code is yours to restyle and rework.

## Usage

The Puzzle CLI installs pieces straight from this registry:

```sh
puzzle add piece button select
```

That copies `Button.pzl` and `Select.pzl` into `app/components/ui/` (plus any shared
`lib/` helpers and sibling pieces they depend on, resolved transitively), copies the
`pieces.css` design tokens into your app if you don't have them yet, and prints —
never auto-runs — any npm install you need. Existing files are never overwritten
unless you pass `--overwrite`, and a `pieces.lock` of content hashes is kept so a
future `diff`/`update` command can tell upstream changes from your local edits.

You can also just copy files from `registry/ui/` by hand — every piece is plain
source with a `piece.json` manifest describing its files and dependencies.

## What's inside

**90 pieces**, from primitives (Button, Field, Select, Checkbox, Switch) through
overlays (Dialog, Sheet, Popover, DropdownMenu, Command), data display (DataTable,
Timeline, Tree, StatCard), charts (LineChart, BarChart, AreaChart, PieChart,
Sparkline), and app-scale composites (Kanban, Sidebar, ChatScroller, Stepper).
Browse them all in the [live component library](https://magic-spells.github.io/puzzle-pieces/),
in [`registry/ui/`](./registry/ui/), or by running the docs app locally:

```sh
cd demo && npm install && npm run dev   # http://localhost:3070
```

Every piece is a native Puzzle component compiling to plain semantic HTML with ARIA
and Tailwind utility classes against the semantic tokens in
[`registry/theme/pieces.css`](./registry/theme/pieces.css) — no custom elements, no
hex colors, controlled-component APIs throughout.

## License

[MIT](./LICENSE)
