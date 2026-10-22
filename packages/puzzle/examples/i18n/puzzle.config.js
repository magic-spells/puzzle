// Translations (D175): the locale list lives here because the compiler owns the
// locale files — it reads app/locales/<tag>.json for each one, flattens nesting
// to dotted keys, fills every locale's missing keys from defaultLocale, and emits
// one hashed dist/locales/<tag>.<hash>.json per locale.
//
// Locale URL prefixes (D177): `routing: 'prefix'` gives every language its own
// URLs. English, the default, is unprefixed (/about); Spanish and Polish live
// under /es/… and /pl/…. `link()` adds the prefix, the URL decides the language,
// and `puzzle build --static` / `--hybrid` prerender every page once per locale
// (dist/about/index.html, dist/es/about/index.html, …), each with its own table
// inline. A first visit to an unprefixed URL is redirected once to the visitor's
// language; `detect: false` turns that off.
export default {
	styles: {
		use: ['tailwindcss'],
	},
	i18n: {
		locales: ['en', 'es', 'pl'],
		defaultLocale: 'en',
		routing: 'prefix',
	},
};
