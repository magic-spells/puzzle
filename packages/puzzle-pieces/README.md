# Puzzle Pieces

Beautifully-behaved UI components for the [Puzzle framework](https://github.com/magic-spells/puzzle).
Tailwind-styled, accessible, morph-aware — and **copied into your app, not installed
from npm**. This package exists only as the transport for `puzzle add piece` — the CLI
downloads it and copies sources into your app; you never install or import it.

Part of the [`magic-spells/puzzle`](https://github.com/magic-spells/puzzle) monorepo —
this package lives at `packages/puzzle-pieces` and releases in lockstep with the framework.

**[▶ Browse the component library](https://magicspells.io/puzzle-pieces)** —
live docs and examples for every piece.

## Why copy-in?

Puzzle compiles `.pzl` single-file components. It can compile `.pzl` files from an
installed package that declares `@magic-spells/puzzle` as a peer dependency, but your
Tailwind scan covers only `app/`, so a piece imported from `node_modules` would render
unstyled, and it would not be yours to edit. So puzzle-pieces is copy-in: each piece is
source you copy into `app/components/ui/`.
Your `puzzle build` compiles it, your Tailwind scan picks up its classes, and the
code is yours to restyle and rework.

## Usage

The Puzzle CLI installs pieces straight from this registry:

```sh
puzzle add piece button select
```

That copies `Button.pzl` and the `Select/` family (`Select.pzl`, `Option.pzl`,
`Label.pzl`, `Divider.pzl` and an `index.js` barrel) into `app/components/ui/`,
path-preserving (plus any shared `lib/` helpers and sibling pieces they depend on,
resolved transitively), copies the `pieces.css` design tokens into your app if you
don't have them yet, and prints — never auto-runs — any npm install you need. That
line carries a version floor per package (`npm install
@magic-spells/collapsible-content@^1.2.0`) — the release the piece was built
against — so run it as printed rather than installing the bare name.
Existing files are never overwritten unless you pass `--overwrite`, and a
`pieces.lock` of content hashes is kept so a future `diff`/`update` command can tell
upstream changes from your local edits.

The alternate palettes copy in the same way:

```sh
puzzle add theme cool
```

`puzzle add theme` with no name lists the palettes (`default`, `cool`, `warm`,
`void`) with your app's state for each. The default one is the `pieces.css` that
`add piece` already copies; the others land in `app/styles/themes/<name>.css`,
are recorded in `pieces.lock` like any piece, and print the `@import` and
`data-scheme` lines for you to wire — a palette your `styles.css` already
imports from this package (`@magic-spells/puzzle-pieces/themes/cool.css`) is
reported and skipped rather than copied beside it.

A **family** piece imports as one unit and invokes with dot notation:

```js
import Select from '@/components/ui/Select';
```

```html
<Select value={ value } @change={ setValue }>
  <Select.Option value="a">Option A</Select.Option>
</Select>
```

You can also just copy files from `registry/ui/` by hand — every piece is plain
source with a `piece.json` manifest describing its files and dependencies.

## What's inside

**104 pieces**, from primitives (Button, Field, Select, Checkbox, Switch) through
overlays (Dialog, Sheet, Popover, DropdownMenu, Command), data display (DataTable,
Timeline, Tree, StatCard), charts (LineChart, BarChart, AreaChart, PieChart,
Sparkline), rich editing (RichTextEditor, MarkdownEditor), and app-scale composites
(Kanban, Sidebar, ChatScroller, Stepper, VirtualList).
Browse them all in the [live component library](https://magicspells.io/puzzle-pieces),
in [`registry/ui/`](./registry/ui/), or by running the docs app locally:

```sh
npm run build:compiler                  # once, at the monorepo root: the demo runs ../../puzzle/puzzle
cd demo && npm install && npm run dev   # http://localhost:3070
```

Every piece is a native Puzzle component compiling to plain semantic HTML with ARIA
and Tailwind utility classes against the semantic tokens in
[`registry/theme/pieces.css`](./registry/theme/pieces.css) — no hex colors,
controlled-component APIs throughout. Sixteen pieces are thin wrappers around a
`@magic-spells` web component (the sheets, the dialogs, the dropdown-panel family,
Tabs, Select, …); those declare the package in their `piece.json` and the CLI prints
the `npm install` for you.

## Themes

Four palettes × four styles, all in [`registry/theme/`](./registry/theme/), all
hand-written CSS — the files are the source of truth, there is no generator. The
values are the Magic Spells Design System's scheme × style grid.

| Scheme    | File               | Character                                                    |
| --------- | ------------------ | ------------------------------------------------------------ |
| `default` | `theme/pieces.css` | tasteful dark grey with a slight blue tint, indigo accent    |
| `cool`    | `theme/cool.css`   | a little more blue — after Constellation's Observatory scheme |
| `warm`    | `theme/warm.css`   | browns and oranges, a clay accent                            |
| `void`    | `theme/void.css`   | very black, dark greys and white type — high contrast        |

| Style   | `color-scheme` | What it is                                                     |
| ------- | -------------- | -------------------------------------------------------------- |
| `dark`  | dark           | everything dark                                                |
| `dim`   | dark           | between light and dark — lower contrast, more subtle           |
| `mixed` | light          | the darker sidebar with a white main panel                     |
| `light` | light          | everything lit                                                 |

`pieces.css` holds the Tailwind v4 `@theme` block: every token is a
`light-dark(light, dark)` pair, plus a `[data-theme='dim']` block (the tokens that
differ from dark) and a `[data-theme='mixed']` block (the frame — `surface-frame` and
the `bar-*` roles — at its dark values over the light half). The other three files
restate every token inside `[data-scheme='cool']` (etc.) with their own dim and mixed
blocks, and are inert until that attribute selects them. Two attributes on `<html>`
drive it:

- `data-scheme` — the **palette**: `cool | warm | void`; absent (or `default`) is the default.
- `data-theme` — the **style**: `dark | dim | mixed | light`; absent follows the OS
  between light and dark (the runtime field is still `mode`). `color-scheme` follows
  the style, so native controls agree.
  In `mixed`, anything drawn on the frame must use the `bar-*` / `rail-*` roles.

Put both attributes on any element to render just that subtree in another scheme × style
(the docs site's compare grid works this way). The 0.8 names still read from storage:
the `dim` palette is `cool` now and the `medium` mode is `dim`.

Import from the package or copy the files in:

```css
@import "tailwindcss";
@import "@magic-spells/puzzle-pieces/themes/default.css"; /* always — it holds @theme */
@import "@magic-spells/puzzle-pieces/themes/warm.css";    /* any palettes you offer   */
```

```js
import { boot, set, current, subscribe } from '@magic-spells/puzzle-pieces/appearance';
boot();                                   // first thing in app.js
set({ scheme: 'warm', mode: 'mixed' });   // persists to localStorage['puzzle:appearance']
set({ mode: null });                      // follow the OS again
```

Inline `@magic-spells/puzzle-pieces/pre-paint` in `<head>` before the stylesheet
(`<script data-key="puzzle:appearance" data-default-mode="dark">…</script>`) so a dark
account never sees a white flash. Every palette × style passes WCAG 2.2 AA on every
declared pair (`npm test` — `test/contrast.test.mjs`); the docs site's `/themes/*`
panels show the live values and ratios. To add a palette: copy a scheme file, rename its
selectors, retune the values, list it in `registry.json` `themes`, and add it to
`SCHEMES` in `appearance.js` and `pre-paint.js` (and the demo's `tokenNames.js`); the
tests enforce identical token sets and AA for the new file.

## License

[MIT](./LICENSE)
