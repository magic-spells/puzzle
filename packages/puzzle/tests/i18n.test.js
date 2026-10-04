// @vitest-environment jsdom
// D175 — the i18n service: locale selection, lookup, single-pass substitution,
// plurals through Intl.PluralRules, the loader (island, fetch, fallback), and
// setLocale's fetch-first, last-wins switch. D177 — the locale-prefix helpers
// (urlLocale, localePath), the switcher list `i18n.locales`, and setLocale's
// navigation under prefix routing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createI18n,
	fillPlaceholders,
	installTranslate,
	islandLocale,
	LOCALE_STORAGE_KEY,
	localeLabel,
	localePath,
	samePath,
	assignSameOrigin,
	selectLocale,
	textDirection,
	urlLocale,
} from '../client-runtime/i18n.js';
import { makeFormatterRegistry } from '../client-runtime/formatters.js';
import * as f from '../client-runtime/formatters/builtins.js';
import { setFormatLocale } from '../client-runtime/formatters/locale.js';

const EN = {
	'cart.title': 'Your cart',
	greeting: 'Hello, {name}!',
	item_count: { one: '{count} item', other: '{count} items' },
	'nav.home': 'Home',
};
const ES = {
	'cart.title': 'Tu carrito',
	greeting: '¡Hola, {name}!',
	item_count: { one: '{count} artículo', other: '{count} artículos' },
	'nav.home': 'Inicio',
};
const MANIFEST = {
	defaultLocale: 'en',
	locales: { en: 'locales/en.AAAA.json', es: 'locales/es.BBBB.json', 'pt-BR': 'locales/pt-BR.CCCC.json' },
};

// A service over in-memory tables, no fetch, settled.
async function service(tables = { en: EN }, locale = 'en', extra = {}) {
	const manifest = {
		defaultLocale: 'en',
		locales: Object.fromEntries(Object.keys(tables).map((t) => [t, `locales/${t}.json`])),
	};
	const i18n = createI18n({ manifest, tables, locale, ...extra });
	await i18n.__ready();
	return i18n;
}

// A fetch stub serving the given tables by manifest path; `fail` names tags whose
// request 404s; `gate` holds a tag's response until released.
function stubFetch(byPath, { fail = [], gates = {} } = {}) {
	const calls = [];
	const fetch = vi.fn(async (url) => {
		calls.push(url);
		const hit = Object.entries(byPath).find(([p]) => url.endsWith(p));
		const tag = hit?.[0];
		if (gates[tag]) await gates[tag];
		if (!hit || fail.includes(tag)) return { ok: false, status: 404, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => hit[1] };
	});
	vi.stubGlobal('fetch', fetch);
	return { fetch, calls };
}

// Node 25 ships a global localStorage that shadows jsdom's and is inert without
// --localstorage-file, so the suite installs a plain in-memory Storage.
function memoryStorage() {
	const map = new Map();
	return {
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		clear: () => map.clear(),
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
	document.documentElement.removeAttribute('lang');
	document.body.innerHTML = '';
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('selectLocale', () => {
	const tags = ['en', 'es', 'pt-BR'];
	it('prefers a stored choice that is still configured', () => {
		expect(selectLocale(tags, 'en', 'es', ['en-US'])).toBe('es');
		expect(selectLocale(tags, 'en', 'fr', ['es'])).toBe('es');
	});
	it('tries each viewer language in order: exact, base, same-base configured tag', () => {
		expect(selectLocale(tags, 'en', null, ['pt-br'])).toBe('pt-BR');
		expect(selectLocale(tags, 'en', null, ['es-CO', 'en'])).toBe('es');
		expect(selectLocale(tags, 'en', null, ['pt'])).toBe('pt-BR');
		expect(selectLocale(tags, 'en', null, ['fr-FR', 'es'])).toBe('es');
	});
	it('falls back to the default locale', () => {
		expect(selectLocale(tags, 'en', null, ['fr', 'de'])).toBe('en');
		expect(selectLocale(tags, 'en', null, [])).toBe('en');
	});
	it('reads storage and navigator at startup when no locale is forced', async () => {
		localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
		const i18n = createI18n({ manifest: MANIFEST, tables: { en: EN, es: ES } });
		await i18n.__ready();
		expect(i18n.locale).toBe('es');
	});
});

describe('t — lookup', () => {
	it('looks a key up and prints a missing key as itself, with a did-you-mean', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = await service();
		expect(i18n.t('cart.title')).toBe('Your cart');
		expect(i18n.t('cart.titel')).toBe('cart.titel');
		expect(i18n.t('cart.titel')).toBe('cart.titel');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('did you mean "cart.title"');
	});
	it('prints nothing for a missing input and stringifies a number or boolean key', async () => {
		const i18n = await service({ en: { ...EN, 42: 'forty-two' } });
		expect(i18n.t(null)).toBe('');
		expect(i18n.t(undefined)).toBe('');
		expect(i18n.t(42)).toBe('forty-two');
		expect(i18n.t('status.' + 'shipped')).toBe('status.shipped');
	});
	it('prints a missing number key as itself, with the missing-key warning', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = await service();
		expect(i18n.t(7)).toBe('7');
		expect(i18n.t(true)).toBe('true');
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[0][0]).toContain('translation "7" is missing');
	});
	it('prints nothing for an object, list or function key and warns once to pass the key first (D176)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = await service();
		// The usual slip in the function spelling: the variables first.
		expect(i18n.t({ count: 2 }, 'item_count')).toBe('');
		expect(i18n.t(['cart.title'])).toBe('');
		expect(i18n.t(() => 'cart.title')).toBe('');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toBe(
			"[puzzle] t() takes the key first, as a string — got an object, so it prints nothing; call it as t('key', { name: value })"
		);
		// The registered library function behaves the same.
		const registry = makeFormatterRegistry();
		installTranslate(registry, i18n);
		expect(registry.getAll().t({ count: 2 }, 'item_count')).toBe('');
		expect(registry.getAll().t('item_count', { count: 2 })).toBe('2 items');
	});
	it('never reads an inherited property as a translation', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = await service();
		expect(i18n.t('toString')).toBe('toString');
		expect(i18n.t('__proto__')).toBe('__proto__');
	});
	it('prints the key before the strings load, with a warning', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch({});
		const i18n = createI18n({ manifest: MANIFEST, locale: 'en' });
		expect(i18n.t('cart.title')).toBe('cart.title');
		expect(warn.mock.calls[0][0]).toContain('before the translations loaded');
	});
});

describe('t — substitution', () => {
	it('fills placeholders in one pass, never re-substituting inserted text', async () => {
		const i18n = await service({ en: { a: '{x} and {y}' } });
		expect(i18n.t('a', { x: '{y}', y: 'Y' })).toBe('{y} and Y');
	});
	it('leaves an unknown placeholder visible and prints nothing for a missing value', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = await service();
		expect(i18n.t('greeting', {})).toBe('Hello, {name}!');
		expect(i18n.t('greeting', { name: null })).toBe('Hello, !');
		expect(i18n.t('greeting', { name: undefined })).toBe('Hello, !');
	});
	it('matches the exact name between the braces, with no trimming', () => {
		expect(fillPlaceholders('Hi { name }', { name: 'x' }, 'en')).toBe('Hi { name }');
		expect(fillPlaceholders('Hi {name', { name: 'x' }, 'en')).toBe('Hi {name');
		expect(fillPlaceholders('{a}{b}', { a: 1, b: true }, 'en')).toBe('1true');
	});
	it('ignores non-object variables with a warning', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = await service();
		expect(i18n.t('greeting', 'Ada')).toBe('Hello, {name}!');
		expect(i18n.t('greeting', ['Ada'])).toBe('Hello, {name}!');
		expect(warn.mock.calls[0][0]).toContain('variables must be an object');
	});
	it('never injects markup — output is text', async () => {
		const i18n = await service({ en: { b: '<b>{x}</b>' } });
		expect(i18n.t('b', { x: '<i>' })).toBe('<b><i></b>');
	});
});

describe('t — plurals', () => {
	it('picks the en one/other form and prints {count} in the locale number format', async () => {
		const i18n = await service();
		expect(i18n.t('item_count', { count: 1 })).toBe('1 item');
		expect(i18n.t('item_count', { count: 0 })).toBe('0 items');
		expect(i18n.t('item_count', { count: 1234 })).toBe('1,234 items');
	});
	it('uses the active locale for the category and the number', async () => {
		const i18n = await service({ en: EN, es: ES }, 'es');
		expect(i18n.t('item_count', { count: 12345 })).toBe('12.345 artículos');
	});
	it('handles a few locale (pl) and falls back to other for a missing category', async () => {
		const pl = { files: { one: '{count} plik', few: '{count} pliki', many: '{count} plików', other: '{count} pliku' } };
		const i18n = await service({ en: {}, pl }, 'pl');
		expect(i18n.t('files', { count: 1 })).toBe('1 plik');
		expect(i18n.t('files', { count: 3 })).toBe('3 pliki');
		expect(i18n.t('files', { count: 5 })).toBe('5 plików');
		const ar = { n: { zero: 'zero', two: 'two', other: 'other' } };
		const arabic = await service({ en: {}, ar }, 'ar');
		expect(arabic.t('n', { count: 0 })).toBe('zero');
		expect(arabic.t('n', { count: 2 })).toBe('two');
		expect(arabic.t('n', { count: 11 })).toBe('other'); // "many" is absent
	});
	it('an exact 0 uses the entry’s zero form, even where CLDR never selects zero (en)', async () => {
		const i18n = await service({
			en: { n: { zero: 'No items', one: '{count} item', other: '{count} items' }, m: { one: '{count} item', other: '{count} items' } },
		});
		expect(i18n.t('n', { count: 0 })).toBe('No items');
		expect(i18n.t('n', { count: '0' })).toBe('No items');
		expect(i18n.t('n', { count: 0.5 })).toBe('0.5 items');
		expect(i18n.t('n', { count: 1 })).toBe('1 item');
		// Without a zero form, 0 falls to the CLDR category as before.
		expect(i18n.t('m', { count: 0 })).toBe('0 items');
	});
	it('reads variables a model inherits (getters), never Object.prototype’s', async () => {
		const i18n = await service({ en: { a: 'Hi {fullName}, {constructor} {toString}' } });
		class Person {
			get fullName() {
				return 'Ada Lovelace';
			}
		}
		expect(i18n.t('a', new Person())).toBe('Hi Ada Lovelace, {constructor} {toString}');
	});
	it('renders other for a plural entry used without count, with a warning', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = await service();
		expect(i18n.t('item_count')).toBe('{count} items');
		expect(warn.mock.calls[0][0]).toContain('no count was passed');
	});
	it('substitutes a plain string entry used with count', async () => {
		const i18n = await service({ en: { s: 'Count: {count}' } });
		expect(i18n.t('s', { count: 3 })).toBe('Count: 3');
	});
});

describe('loading', () => {
	it('fetches the active locale through the url resolver', async () => {
		const { calls } = stubFetch({ 'locales/es.BBBB.json': ES });
		const i18n = createI18n({ manifest: MANIFEST, locale: 'es', url: (p) => '/base/' + p });
		await i18n.__ready();
		expect(calls).toEqual(['/base/locales/es.BBBB.json']);
		expect(i18n.t('nav.home')).toBe('Inicio');
		expect(document.documentElement.lang).toBe('es');
	});
	it('reads the build locale from the page island with no request', async () => {
		const { calls } = stubFetch({});
		document.body.innerHTML = `<script type="application/json" data-puzzle-locale="en">${JSON.stringify(EN)}</script>`;
		const i18n = createI18n({ manifest: MANIFEST, locale: 'en' });
		await i18n.__ready();
		expect(calls).toEqual([]);
		expect(i18n.t('cart.title')).toBe('Your cart');
	});
	it('falls back once to the default locale when the active file fails', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch({ 'locales/es.BBBB.json': ES, 'locales/en.AAAA.json': EN }, { fail: ['locales/es.BBBB.json'] });
		const i18n = createI18n({ manifest: MANIFEST, locale: 'es' });
		await i18n.__ready();
		expect(i18n.locale).toBe('en');
		expect(i18n.t('nav.home')).toBe('Home');
	});
	it('rejects when the default locale fails too', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		stubFetch({}, {});
		const i18n = createI18n({ manifest: MANIFEST, locale: 'es' });
		await expect(i18n.__ready()).rejects.toThrow(/failed to load/);
	});
});

describe('setLocale', () => {
	it('throws a RangeError naming the configured locales for an unknown tag', async () => {
		const i18n = await service();
		expect(() => i18n.setLocale('fr')).toThrow(RangeError);
		expect(() => i18n.setLocale('fr')).toThrow(/en/);
	});
	it('fetches first, then switches table, locale and <html lang> together, stores, refreshes', async () => {
		let release;
		const gate = new Promise((r) => (release = r));
		stubFetch({ 'locales/es.BBBB.json': ES }, { gates: { 'locales/es.BBBB.json': gate } });
		const refresh = vi.fn();
		const i18n = createI18n({ manifest: MANIFEST, tables: { en: EN }, locale: 'en', refresh });
		await i18n.__ready();
		const p = i18n.setLocale('ES');
		await Promise.resolve();
		expect(i18n.locale).toBe('en');
		expect(i18n.t('nav.home')).toBe('Home');
		release();
		await p;
		expect(i18n.locale).toBe('es');
		expect(i18n.t('nav.home')).toBe('Inicio');
		expect(document.documentElement.lang).toBe('es');
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es');
		expect(refresh).toHaveBeenCalledTimes(1);
	});
	it('a failed switch rejects and changes nothing', async () => {
		stubFetch({}, {});
		const refresh = vi.fn();
		const i18n = createI18n({ manifest: MANIFEST, tables: { en: EN }, locale: 'en', refresh });
		await i18n.__ready();
		await expect(i18n.setLocale('es')).rejects.toThrow(/failed to load/);
		expect(i18n.locale).toBe('en');
		expect(i18n.t('nav.home')).toBe('Home');
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(null);
		expect(refresh).not.toHaveBeenCalled();
	});
	it('overlapping switches resolve last-wins', async () => {
		let releaseEs;
		const esGate = new Promise((r) => (releaseEs = r));
		const PT = { 'nav.home': 'Início' };
		stubFetch(
			{ 'locales/es.BBBB.json': ES, 'locales/pt-BR.CCCC.json': PT },
			{ gates: { 'locales/es.BBBB.json': esGate } }
		);
		const refresh = vi.fn();
		const i18n = createI18n({ manifest: MANIFEST, tables: { en: EN }, locale: 'en', refresh });
		await i18n.__ready();
		const first = i18n.setLocale('es');
		await i18n.setLocale('pt-BR');
		releaseEs();
		await first;
		expect(i18n.locale).toBe('pt-BR');
		expect(i18n.t('nav.home')).toBe('Início');
		expect(refresh).toHaveBeenCalledTimes(1);
	});
	it('a switch before the startup load settles replaces it', async () => {
		let releaseEn;
		const enGate = new Promise((r) => (releaseEn = r));
		stubFetch(
			{ 'locales/en.AAAA.json': EN, 'locales/es.BBBB.json': ES },
			{ gates: { 'locales/en.AAAA.json': enGate } }
		);
		const i18n = createI18n({ manifest: MANIFEST, locale: 'en' });
		i18n.setLocale('es');
		const ready = i18n.__ready();
		releaseEn();
		await ready;
		expect(i18n.locale).toBe('es');
	});
});

describe('the t formatter', () => {
	it('registers over the service unless the app registered its own', async () => {
		const i18n = await service();
		const registry = makeFormatterRegistry();
		installTranslate(registry, i18n);
		expect(registry.getAll().t('greeting', { name: 'Ada' })).toBe('Hello, Ada!');
		expect(registry.getAll().t(null)).toBe('');

		const own = (v) => `own:${v}`;
		const custom = makeFormatterRegistry({ t: own });
		installTranslate(custom, i18n);
		expect(custom.getAll().t).toBe(own);
	});
	it('the D43 guard names i18n when t is used without translations', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const registry = makeFormatterRegistry();
		const t = registry.getAll().t || registry.getAll().__missing('t');
		expect(t('cart.title')).toBe('cart.title');
		expect(error.mock.calls[0][0]).toContain('needs translations');
		expect(error.mock.calls[0][0]).toContain('i18n');
	});
	it('createI18n returns null without a manifest (no translations configured)', () => {
		expect(createI18n()).toBe(null);
	});
});

// D175 item 8: the formatter locale. Every expectation names its locale, so none
// of them moves with the process locale.
describe('the formatter locale', () => {
	afterEach(() => {
		setFormatLocale(undefined);
		vi.useRealTimers();
	});

	it('drives the number, date and relative-time formatters, and rebuilds their caches on a switch', () => {
		vi.useFakeTimers({ now: new Date('2026-09-24T12:00:00Z') });
		setFormatLocale('de-DE');
		expect(f.number_with_delimiter(1234.5)).toBe('1.234,5');
		expect(f.pluralize(1234, 'Kommentar', 'Kommentare')).toBe('1.234 Kommentare');
		expect(f.compact_number(3400000)).toBe('3,4 Mio.');
		expect(f.date('2026-09-24', 'long')).toBe('24. September 2026');
		expect(f.timeago('2026-09-24T10:00:00Z')).toBe('vor 2 Stunden');

		setFormatLocale('en-US');
		expect(f.number_with_delimiter(1234.5)).toBe('1,234.5');
		expect(f.compact_number(3400000)).toBe('3.4M');
		expect(f.date('2026-09-24', 'long')).toBe('September 24, 2026');
		expect(f.timeago('2026-09-24T10:00:00Z')).toBe('2 hours ago');
	});

	it('lets an explicit locale argument win, and leaves currency alone', () => {
		setFormatLocale('de-DE');
		expect(f.date('2026-09-24', 'long', 'en-US')).toBe('September 24, 2026');
		expect(f.number_with_delimiter(1234.5, ',')).toBe('1,234.5');
		expect(f.currency(1234.5)).toBe('$1,234.50');
	});

	it('follows the active locale: set on load and on every switch', async () => {
		const i18n = await service({ en: EN, es: ES }, 'es');
		expect(f.number_with_delimiter(12345.5)).toBe('12.345,5');
		expect(i18n.t('item_count', { count: 12345.5 })).toBe('12.345,5 artículos');
		await i18n.setLocale('en');
		expect(f.number_with_delimiter(12345.5)).toBe('12,345.5');
	});
});

// D177 — prefix routing. `en` is the default (unprefixed); `es` and `pt-BR` live
// under their tags, verbatim and on a segment boundary.
const ROUTED = {
	defaultLocale: 'en',
	locales: { en: 'locales/en.json', es: 'locales/es.json', 'pt-BR': 'locales/pt-BR.json' },
	routing: 'prefix',
};

describe('urlLocale (D177)', () => {
	it.each([
		// [pathname, routerBase, expected]
		['/', '', null],
		['', '', null],
		['/about', '', null],
		['/es', '', 'es'],
		['/es/', '', 'es'],
		['/es/about', '', 'es'],
		['/es/about/', '', 'es'],
		['/es?q=1', '', 'es'],
		['/es#top', '', 'es'],
		['/esp', '', null],
		['/esp/about', '', null],
		['/ES/about', '', null],
		['/pt-BR/x', '', 'pt-BR'],
		['/pt-br/x', '', null],
		['/pt/x', '', null],
		['/en/about', '', null],
		['/about/es', '', null],
		['/docs/es/about', '/docs', 'es'],
		['/docs/es', '/docs', 'es'],
		['/docs/', '/docs', null],
		['/docs', '/docs', null],
		['/docs/about', '/docs', null],
		['/es/about', '/docs', null],
		['/docsx/es/about', '/docs', null],
		['/docs/es/about', 'docs/', 'es'],
		['/a/b/pt-BR/', '/a/b', 'pt-BR'],
	])('%j under base %j → %j', (pathname, base, expected) => {
		expect(urlLocale(pathname, base, ROUTED)).toBe(expected);
	});
});

describe('localePath (D177)', () => {
	it.each([
		// [href, routerBase, target locale, expected]
		['/', '', 'en', '/'],
		['/', '', 'es', '/es/'],
		['', '', 'es', '/es/'],
		['/es', '', 'en', '/'],
		['/es', '', 'es', '/es/'],
		['/es/', '', 'en', '/'],
		['/es/', '', 'pt-BR', '/pt-BR/'],
		['/about', '', 'es', '/es/about'],
		['/about/', '', 'es', '/es/about/'],
		['/es/about', '', 'en', '/about'],
		['/es/about/', '', 'en', '/about/'],
		['/es/about', '', 'pt-BR', '/pt-BR/about'],
		['/pt-BR/blog/x', '', 'es', '/es/blog/x'],
		['/esp/x', '', 'es', '/es/esp/x'],
		['/esp/x', '', 'en', '/esp/x'],
		['/en/about', '', 'es', '/es/en/about'],
		['/about?q=1#h', '', 'es', '/es/about?q=1#h'],
		['/es/about?q=a/b#x/y', '', 'en', '/about?q=a/b#x/y'],
		['/es?q=1', '', 'en', '/?q=1'],
		['/docs', '/docs', 'es', '/docs/es/'],
		['/docs/', '/docs', 'es', '/docs/es/'],
		['/docs/', '/docs', 'en', '/docs/'],
		['/docs/es', '/docs', 'en', '/docs/'],
		['/docs/es/about?q=1#h', '/docs', 'en', '/docs/about?q=1#h'],
		['/docs/about', '/docs/', 'pt-BR', '/docs/pt-BR/about'],
		['/elsewhere/es/x', '/docs', 'en', '/elsewhere/es/x'],
	])('%j under base %j in %j → %j', (href, base, locale, expected) => {
		expect(localePath(href, base, locale, ROUTED)).toBe(expected);
	});
});

describe('localeLabel (D177)', () => {
	it("names each language in its own language, first letter upper-cased", () => {
		expect(localeLabel('en')).toBe('English');
		expect(localeLabel('es')).toBe('Español');
		expect(localeLabel('pt-BR')).toBe('Português (Brasil)');
	});
	it('falls back to the tag when Intl.DisplayNames is missing or rejects the tag', () => {
		vi.stubGlobal('Intl', { ...Intl, DisplayNames: undefined });
		expect(localeLabel('fi')).toBe('fi');
		vi.unstubAllGlobals();
		expect(localeLabel('en_US')).toBe('en_US');
	});
	it('keeps a tag Intl only echoes back (unknown language) verbatim, not capitalised', () => {
		expect(localeLabel('zz')).toBe('zz');
		expect(localeLabel('ZZ')).toBe('ZZ');
	});
});

describe('i18n.locales (D177)', () => {
	it('lists every configured locale in config order: tag, own name, current page, active', async () => {
		const i18n = await service({ en: EN, es: ES }, 'es', { page: () => '/shop/cart?x=1' });
		expect(i18n.locales).toEqual([
			{ locale: 'en', label: 'English', href: '/shop/cart?x=1', active: false },
			{ locale: 'es', label: 'Español', href: '/shop/cart?x=1', active: true },
		]);
	});
	it("is the current document ('') when the host supplies no page", async () => {
		const i18n = await service({ en: EN, es: ES });
		expect(i18n.locales.map((entry) => entry.href)).toEqual(['', '']);
	});
	it('is read lazily: the page and the active flag are the ones at read time', async () => {
		let here = '/a';
		const i18n = await service({ en: EN, es: ES }, 'en', { page: () => here });
		expect(i18n.locales[0].href).toBe('/a');
		here = '/b';
		await i18n.setLocale('es');
		expect(i18n.locales).toEqual([
			{ locale: 'en', label: 'English', href: '/b', active: false },
			{ locale: 'es', label: 'Español', href: '/b', active: true },
		]);
	});
	it('under prefix routing, is the current page under each locale’s prefix (routerBase kept)', async () => {
		const i18n = createI18n({
			manifest: ROUTED,
			tables: { es: ES },
			locale: 'es',
			routerBase: '/docs',
			page: () => '/docs/es/guide/?tab=2#install',
		});
		await i18n.__ready();
		expect(i18n.locales).toEqual([
			{ locale: 'en', label: 'English', href: '/docs/guide/?tab=2#install', active: false },
			{ locale: 'es', label: 'Español', href: '/docs/es/guide/?tab=2#install', active: true },
			{ locale: 'pt-BR', label: 'Português (Brasil)', href: '/docs/pt-BR/guide/?tab=2#install', active: false },
		]);
	});
});

describe('setLocale under prefix routing (D177)', () => {
	async function routed(navigate, locale = 'es', manifest = ROUTED) {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const refresh = vi.fn();
		const i18n = createI18n({
			manifest,
			tables: { en: EN, es: ES },
			locale,
			page: () => '/es/cart?step=2#pay',
			navigate,
			refresh,
		});
		await i18n.__ready();
		return { i18n, fetch, refresh };
	}

	it('stores the choice and navigates to the same page under the new prefix — no fetch, no re-render', async () => {
		const navigate = vi.fn();
		const { i18n, fetch, refresh } = await routed(navigate);
		await expect(i18n.setLocale('pt-br')).resolves.toBeUndefined();
		expect(navigate).toHaveBeenCalledWith('/pt-BR/cart?step=2#pay');
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pt-BR');
		expect(fetch).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		// The page itself is unchanged until the browser loads the other one.
		expect(i18n.locale).toBe('es');
		expect(i18n.t('nav.home')).toBe('Inicio');

		await i18n.setLocale('en');
		expect(navigate).toHaveBeenLastCalledWith('/cart?step=2#pay');
	});
	it('the active locale again is a no-op that still stores the choice', async () => {
		const navigate = vi.fn();
		const { i18n } = await routed(navigate);
		await i18n.setLocale('es');
		expect(navigate).not.toHaveBeenCalled();
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es');
	});
	it('an unconfigured tag throws the same RangeError and navigates nowhere', async () => {
		const navigate = vi.fn();
		const { i18n } = await routed(navigate);
		expect(() => i18n.setLocale('fr')).toThrow(RangeError);
		expect(() => i18n.setLocale('fr')).toThrow(/en, es, pt-BR/);
		expect(navigate).not.toHaveBeenCalled();
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(null);
	});
	it('switches in place as before without prefix routing, even with a navigate', async () => {
		const navigate = vi.fn();
		const { routing, ...plain } = ROUTED;
		void routing;
		const { i18n, refresh } = await routed(navigate, 'en', plain);
		await i18n.setLocale('es');
		expect(navigate).not.toHaveBeenCalled();
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(i18n.locale).toBe('es');
	});
	it('switches in place when the host supplies no navigate', async () => {
		const { i18n, refresh } = await routed(undefined, 'en');
		await i18n.setLocale('es');
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(i18n.locale).toBe('es');
	});
});

// A prefix swap must never produce a protocol-relative URL: stripping `/es` off
// `/es//evil.example/` would leave `//evil.example/`, which a browser loads from
// evil.example. Every result stays a same-origin path.
describe('prefix swaps stay on the site (D177, open redirect)', () => {
	it.each([
		// [href, routerBase, target locale, expected]
		['/es//evil.example/', '', 'en', '/evil.example/'],
		['/es//evil.example/', '', 'pt-BR', '/pt-BR//evil.example/'],
		['/es/\\evil.example', '', 'en', '/evil.example'],
		['/es/\\\\evil.example/x', '', 'en', '/evil.example/x'],
		['/es/\t/evil.example', '', 'en', '/evil.example'],
		['/es/%2F%2Fevil.example', '', 'en', '/%2F%2Fevil.example'],
		['//evil.example/es/x', '', 'en', '/evil.example/es/x'],
		['//evil.example/es/x', '', 'es', '/es//evil.example/es/x'],
		['/\\evil.example', '', 'en', '/evil.example'],
		['/es//evil.example?q=1#h', '', 'en', '/evil.example?q=1#h'],
		// Under routerBase the base stays in front, so the result already starts on-site…
		['/docs/es//evil.example/', '/docs', 'en', '/docs//evil.example/'],
		['/docs/es/\\evil.example', '/docs', 'en', '/docs/\\evil.example'],
		// …and an href outside the base keeps its path, but never as //host.
		['//evil.example/', '/docs', 'en', '/evil.example/'],
		['/\\evil.example/docs/es', '/docs', 'es', '/evil.example/docs/es'],
	])('%j under base %j in %j → %j', (href, base, locale, expected) => {
		const out = localePath(href, base, locale, ROUTED);
		expect(out).toBe(expected);
		expect(new URL(out, 'https://site.test').origin).toBe('https://site.test');
	});

	it('samePath collapses a leading slash/backslash run and leaves the rest alone', () => {
		expect(samePath('//evil.example/')).toBe('/evil.example/');
		expect(samePath('/\\/\\evil.example')).toBe('/evil.example');
		expect(samePath('/a//b')).toBe('/a//b');
		expect(samePath('')).toBe('');
		expect(samePath('#/x')).toBe('#/x');
		expect(samePath('?q=//x')).toBe('?q=//x');
	});

	it('i18n.locales hrefs stay on the site, with and without prefix routing', async () => {
		const routed = createI18n({
			manifest: ROUTED,
			tables: { es: ES },
			locale: 'es',
			page: () => '/es//evil.example/',
		});
		await routed.__ready();
		for (const { href } of routed.locales) {
			expect(new URL(href, 'https://site.test').origin).toBe('https://site.test');
		}
		expect(routed.locales[0].href).toBe('/evil.example/');

		const plain = await service({ en: EN, es: ES }, 'en', { page: () => '//evil.example/x' });
		expect(plain.locales.map((entry) => entry.href)).toEqual(['/evil.example/x', '/evil.example/x']);
	});

	it('setLocale navigates on-site from /es//evil.example/', async () => {
		const navigate = vi.fn();
		const i18n = createI18n({
			manifest: ROUTED,
			tables: { es: ES },
			locale: 'es',
			page: () => '/es//evil.example/',
			navigate,
		});
		await i18n.__ready();
		await i18n.setLocale('en');
		expect(navigate).toHaveBeenCalledWith('/evil.example/');
	});

	it('assignSameOrigin refuses another origin, with a development warning', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const before = location.href;
		assignSameOrigin('https://evil.example/');
		assignSameOrigin('//evil.example/');
		expect(location.href).toBe(before);
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[0][0]).toMatch(/refusing to navigate off the site/);
		// A same-origin target is loaded (a fragment change is one jsdom performs).
		assignSameOrigin(location.pathname + '#langs');
		expect(location.hash).toBe('#langs');
		history.replaceState(null, '', before);
	});
});

describe('islandLocale (D177)', () => {
	it("reads the page's table island tag, or null without one", () => {
		expect(islandLocale()).toBe(null);
		document.body.innerHTML = '<script type="application/json" data-puzzle-locale="pt-BR">{}</script>';
		expect(islandLocale()).toBe('pt-BR');
	});
});

describe('text direction (D177)', () => {
	afterEach(() => {
		document.documentElement.removeAttribute('dir');
		document.documentElement.removeAttribute('lang');
	});

	it.each([
		['ar', 'rtl'],
		['ar-EG', 'rtl'],
		['he', 'rtl'],
		['iw', 'rtl'],
		['ks', 'rtl'],
		['ks-Deva', 'ltr'],
		['fa-IR', 'rtl'],
		['ur', 'rtl'],
		['ckb', 'rtl'],
		['yi', 'rtl'],
		['ku', 'ltr'],
		['ku-Arab', 'rtl'],
		['ku-Latn-TR', 'ltr'],
		['az-Arab', 'rtl'],
		['pa-Guru', 'ltr'],
		['ff-Adlm', 'rtl'],
		['ar-Latn', 'ltr'],
		['en', 'ltr'],
		['pt-BR', 'ltr'],
		['de-1996', 'ltr'],
		['zh-Hant-TW', 'ltr'],
	])('%s is %s', (tag, dir) => {
		expect(textDirection(tag)).toBe(dir);
	});

	it('exposes i18n.dir and sets <html dir> on a switch, removing it again for an ltr locale', async () => {
		const AR = { 'nav.home': 'الرئيسية' };
		const i18n = await service({ en: EN, ar: AR });
		expect(i18n.dir).toBe('ltr');
		expect(document.documentElement.hasAttribute('dir')).toBe(false);
		await i18n.setLocale('ar');
		expect(i18n.dir).toBe('rtl');
		expect(document.documentElement.getAttribute('dir')).toBe('rtl');
		expect(document.documentElement.lang).toBe('ar');
		await i18n.setLocale('en');
		expect(i18n.dir).toBe('ltr');
		expect(document.documentElement.hasAttribute('dir')).toBe(false);
	});

	it("leaves a shell's own dir alone for an ltr locale", async () => {
		document.documentElement.setAttribute('dir', 'auto');
		await service({ en: EN });
		expect(document.documentElement.getAttribute('dir')).toBe('auto');
	});
});
