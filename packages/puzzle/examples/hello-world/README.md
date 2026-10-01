# hello-world

The smallest possible [Puzzle](https://github.com/magic-spells/puzzle) app: boot
the runtime and paint one view. It exists as a **baseline for measuring the
framework's size** — the way Svelte and Vue publish a minimal "Hello World"
number — so there are deliberately no layouts, components, styles, formatters, or
extra routes to muddy the bundle.

## What ships in the bundle

`dist/app.js` is the Puzzle runtime (app + router + view engine) plus this app's
one view. That is the honest floor: `mount()` always constructs the router, so a
single static route is as small as a real Puzzle app gets.

## Measure it

```bash
npm install
npm run build           # production: minified, console-stripped
```

The build prints raw and gzip sizes per file, e.g.:

```
dist/app.js      66.9 KB │ 22.0 KB gzip
```

The `app.js` line is the framework size. `styles.css` is empty by design — this
app has no CSS, so nothing but the runtime is being weighed. The exact number
tracks whichever `@magic-spells/puzzle` version is installed. The CLI's gzip
figure runs slightly high: both gzip at level 9, but the framework's
`npm run measure:size` uses Node's zlib, which packs a little tighter, and
reports 21.9 KB for this 0.8.0 bundle, the figure the CHANGELOG cites.

## Files

```
hello-world/
├── app/
│   ├── app.js            # new PuzzleApp({ target, routes }); mount()
│   ├── public/index.html # the shell: #app + <script type="module" src="/app.js">
│   └── views/Home.pzl    # <h1>Hello World</h1>
├── puzzle.config.js      # {} — no styles pipeline
└── package.json
```

## Run it

```bash
npm run dev              # watch + live-reload dev server
```
