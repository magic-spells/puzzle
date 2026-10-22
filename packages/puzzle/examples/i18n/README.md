# Puzzle Market (i18n example)

A small two-page shop that shows Puzzle's translations and per-language URLs.
Every string on the page comes from `app/locales/`, in English, Spanish and
Polish. Each language has its own URLs: English, the default, is unprefixed
(`/about`), Spanish and Polish live under `/es/…` and `/pl/…`. A switcher in the
header links each page to its other languages, and remembers the choice.

## Run it

```bash
npm install
npm run dev        # puzzle dev
npm run build      # puzzle build → dist/
```

Open `/es/` or `/pl/about` directly to land in that language. Try
`npx puzzle build --static` or `--hybrid` too: every page prerenders once per
language — `dist/about/index.html`, `dist/es/about/index.html`,
`dist/pl/about/index.html` — each with its own `<html lang>`, its own table
inline and `hreflang` alternates naming the others, so no visitor fetches
strings.

## What it showcases

| Feature in the app | Framework surface |
| --- | --- |
| Locale list, default and URL prefixes in one place | `i18n: { locales: ['en', 'es', 'pl'], defaultLocale: 'en', routing: 'prefix' }` in `puzzle.config.js` |
| Nested locale files (`home.cart.title`) | The compiler flattens nesting to dotted keys, fills missing keys from `en`, and emits one hashed `dist/locales/<tag>.<hash>.json` per locale; the browser fetches only the active one, and prerendered pages carry it inline |
| Plain strings in templates | `{ t('home.intro') }` |
| "Welcome back, Ada!" | Placeholders: `{ t('home.greeting', { name: user.name }) }` |
| "3 items" / "3 produkty" / "5 produktów" | Plural entries: a numeric `count` picks the form through `Intl.PluralRules` (Polish uses `one`/`few`/`many`/`other`), an exact 0 uses the entry's `zero` form, and `{count}` prints in the locale's number format |
| The order total and the "prices as of" date | `number_with_delimiter(total)` and `date(updated, 'long')` follow the active locale |
| Nav links stay in the language you are reading | `{ link('/about') }` adds the page's locale prefix (`/es/about`); `link(path, { locale: 'pl' })` targets one language and `{ locale: false }` skips the prefix for a file |
| English / Español / Polski links | `this.ctx.i18n.locales` — `{ locale, label, href, active }` per language, `href` being this page in that language. The links are real `<a href>`s a crawler follows; a plain click calls `setLocale(tag)`, which remembers the choice and loads the same page under the other prefix (`LocaleSwitcher.pzl`) |
| A first visit lands in your language | An unprefixed URL opened from another site is redirected once to the stored choice or the browser's language (`i18n.detect: false` turns it off) |
| The cart count survives a switch | The cart is a store record persisted to `localStorage` (`app.js`); a switch is a page load |
| A translated string read from script | `this.ctx.i18n.t('nav.about')` in `About.pzl` |
| `<html lang>` tracks the language | Set from the URL's locale |

The URL decides the language: `/es/…` is Spanish whatever was stored. Route
titles in `routes.js` are plain strings here; `meta: { title: { t: 'key' } }`
translates them.

## App structure

```
app/
├── app.js                  # PuzzleApp: routes + models + localStorage persistence
├── routes.js               # /, /about and the catch-all, all in one layout
├── locales/
│   ├── en.json             # the default locale; the source of any missing key
│   ├── es.json
│   └── pl.json             # four plural forms for the cart count
├── models/
│   ├── index.js            # model registry
│   └── cart.js             # the cart record (count)
├── layouts/
│   └── Default.pzl         # header, translated nav, LocaleSwitcher, <Slot/>
├── components/
│   └── LocaleSwitcher.pzl  # one link per configured locale; a click → setLocale()
├── views/
│   ├── Home.pzl            # greeting, plural cart count, locale-formatted number and date
│   ├── About.pzl           # reads ctx.i18n.t() and ctx.i18n.locale from script
│   └── NotFound.pzl
├── styles/styles.css       # Tailwind entry and color tokens
└── public/index.html       # mount target
```
