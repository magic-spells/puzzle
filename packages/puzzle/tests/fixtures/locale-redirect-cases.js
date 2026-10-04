// The first-visit redirect decision table (D177). Three implementations run it:
// selectLocale (i18n.js) for the `locale` column, the prerendered pages' inline
// script (ssg/redirect.js, tests/i18n-ssg.test.js) and the SPA's mount-time
// redirect (app.js, tests/i18n-app.test.js). `expected` is the redirect target,
// or null for none. A `referrer` of SAME_ORIGIN means the runner's own origin.

export const REDIRECT_MANIFEST = {
	defaultLocale: 'en',
	locales: { en: 'locales/en.AAAA.json', es: 'locales/es.BBBB.json', 'pt-BR': 'locales/pt-BR.CCCC.json' },
	routing: 'prefix',
};

export const SAME_ORIGIN = Symbol('same origin');

/**
 * `locale` is selectLocale's answer, given where the URL, base and referrer let
 * the matching decide at all.
 * @type {Array<{ name: string, url: string, routerBase?: string, stored?: string | null,
 *   languages: string[], referrer?: string | symbol, locale?: string, expected: string | null }>}
 */
export const REDIRECT_CASES = [
	{ name: 'a browser-language match', url: '/about?q=1#top', languages: ['es-MX', 'en'], locale: 'es', expected: '/es/about?q=1#top' },
	{ name: 'the root page', url: '/', languages: ['es'], locale: 'es', expected: '/es/' },
	{ name: 'the first browser language wins', url: '/about', languages: ['en-US', 'es'], locale: 'en', expected: null },
	{ name: 'a base-language match to a regional tag', url: '/about', languages: ['pt'], locale: 'pt-BR', expected: '/pt-BR/about' },
	{ name: 'tags match case-insensitively', url: '/about', languages: ['PT-br'], locale: 'pt-BR', expected: '/pt-BR/about' },
	{ name: 'a regional variant falls to its base tag', url: '/about', languages: ['pt-PT'], locale: 'pt-BR', expected: '/pt-BR/about' },
	{ name: 'an empty language entry is skipped', url: '/about', languages: ['', 'es'], locale: 'es', expected: '/es/about' },
	{ name: 'no browser match', url: '/about', languages: ['fr', 'de'], locale: 'en', expected: null },
	{ name: 'a stored choice, over the browser', url: '/about', stored: 'es', languages: ['en-US'], locale: 'es', expected: '/es/about' },
	{ name: 'a stored choice in another case', url: '/about', stored: 'ES', languages: ['en'], locale: 'es', expected: '/es/about' },
	{ name: 'an unconfigured stored choice falls to the browser', url: '/about', stored: 'fr', languages: ['es'], locale: 'es', expected: '/es/about' },
	{ name: 'a stored default choice suppresses it', url: '/about', stored: 'en', languages: ['es'], locale: 'en', expected: null },
	{ name: 'a same-origin referrer', url: '/about', languages: ['es'], referrer: SAME_ORIGIN, expected: null },
	{ name: 'another origin referrer', url: '/about', languages: ['es'], referrer: 'https://search.example/q', locale: 'es', expected: '/es/about' },
	{ name: 'an unparsable referrer', url: '/about', languages: ['es'], referrer: 'not a url', locale: 'es', expected: '/es/about' },
	{ name: 'an already-prefixed URL', url: '/es/about', languages: ['pt'], expected: null },
	{ name: 'an already-prefixed regional URL', url: '/pt-BR/', languages: ['es'], expected: null },
	{ name: '/esp is not the es prefix', url: '/esp', languages: ['es'], locale: 'es', expected: '/es/esp' },
	{ name: 'under routerBase', url: '/docs/about', routerBase: '/docs', languages: ['es'], locale: 'es', expected: '/docs/es/about' },
	{ name: 'the routerBase root', url: '/docs', routerBase: '/docs', languages: ['es'], locale: 'es', expected: '/docs/es/' },
	{ name: 'prefixed under routerBase', url: '/docs/es/x', routerBase: '/docs', languages: ['pt'], expected: null },
	{ name: 'outside routerBase', url: '/elsewhere', routerBase: '/docs', languages: ['es'], expected: null },
];
