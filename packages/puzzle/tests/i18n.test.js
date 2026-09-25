// @vitest-environment jsdom
// D175 — the i18n service: locale selection, lookup, single-pass substitution,
// plurals through Intl.PluralRules, the loader (island, fetch, fallback), and
// setLocale's fetch-first, last-wins switch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createI18n,
	fillPlaceholders,
	installTranslate,
	LOCALE_STORAGE_KEY,
	selectLocale,
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
	it('prints nothing for a missing input and stringifies anything else', async () => {
		const i18n = await service({ en: { ...EN, 42: 'forty-two' } });
		expect(i18n.t(null)).toBe('');
		expect(i18n.t(undefined)).toBe('');
		expect(i18n.t(42)).toBe('forty-two');
		expect(i18n.t('status.' + 'shipped')).toBe('status.shipped');
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
