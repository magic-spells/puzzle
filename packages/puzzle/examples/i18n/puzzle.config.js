// Translations (D175): the locale list lives here because the compiler owns the
// locale files — it reads app/locales/<tag>.json for each one, flattens nesting
// to dotted keys, fills every locale's missing keys from defaultLocale, and emits
// one hashed dist/locales/<tag>.<hash>.json per locale. The browser fetches only
// the active one. `puzzle build --static` / `--hybrid` prerender every page in
// defaultLocale and carry its table inline.
export default {
	styles: {
		use: ['tailwindcss'],
	},
	i18n: {
		locales: ['en', 'es', 'pl'],
		defaultLocale: 'en',
	},
};
