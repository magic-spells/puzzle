# Puzzle Market (i18n example)

A small two-page shop that shows Puzzle's translations. Every string on
the page comes from `app/locales/`, in English, Spanish and Polish. A switcher
in the header changes the language in place: the new locale file loads, the
page rebuilds at the same URL with no history entry and no scroll jump, and the
choice is remembered on the next visit.

## Run it

```bash
npm install
npm run dev        # puzzle dev
npm run build      # puzzle build → dist/
```

Try `npx puzzle build --hybrid` too: the pages prerender in English and carry the
English table inline, so an English visitor makes no extra request.

## What it showcases

| Feature in the app | Framework surface |
| --- | --- |
| Locale list and default in one place | `i18n: { locales: ['en', 'es', 'pl'], defaultLocale: 'en' }` in `puzzle.config.js` |
| Nested locale files (`home.cart.title`) | The compiler flattens nesting to dotted keys, fills missing keys from `en`, and emits one hashed `dist/locales/<tag>.<hash>.json` per locale; the browser fetches only the active one |
| Plain strings in templates | `{ t('home.intro') }` |
| "Welcome back, Ada!" | Placeholders: `{ t('home.greeting', { name: user.name }) }` |
| "3 items" / "3 produkty" / "5 produktów" | Plural entries: a numeric `count` picks the form through `Intl.PluralRules` (Polish uses `one`/`few`/`many`/`other`), an exact 0 uses the entry's `zero` form, and `{count}` prints in the locale's number format |
| The order total and the "prices as of" date | `number_with_delimiter(total)` and `date(updated, 'long')` follow the active locale |
| English / Español / Polski buttons | `this.ctx.i18n.locale`, `.locales` and `.setLocale(tag)`, which rejects if the file fails to load or the page cannot rebuild (`LocaleSwitcher.pzl`) |
| The header and nav translate too | A switch rebuilds every routed level, layout included |
| The cart count survives a switch | The cart is a store record; local `setData()` state does not survive the rebuild |
| A translated string read from script | `this.ctx.i18n.t('nav.about')` in `About.pzl` |
| `<html lang>` tracks the language | Set by the runtime on load and on every switch |

The startup locale is the stored choice, then the browser's languages, then
`en`. Route titles in `routes.js` are plain strings: translated tab titles are
not supported yet.

## App structure

```
app/
├── app.js                  # PuzzleApp: routes + models; nothing i18n-specific
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
│   └── LocaleSwitcher.pzl  # one button per configured locale → setLocale()
├── views/
│   ├── Home.pzl            # greeting, plural cart count, locale-formatted number and date
│   ├── About.pzl           # reads ctx.i18n.t() and ctx.i18n.locale from script
│   └── NotFound.pzl
├── styles/styles.css       # Tailwind entry and color tokens
└── public/index.html       # mount target
```
