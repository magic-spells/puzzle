// @vitest-environment jsdom
//
// D175 service edges: a configured tag Intl rejects must not throw mid-render
// (plural selection), an overtaken setLocale never reports a switch that did not
// happen, and the dev-only "did you mean" suggestion for a missing key is
// computed only when its warning actually prints.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../client-runtime/formatters.js', async (importOriginal) => {
	const orig = await importOriginal();
	return { ...orig, nearestFormatter: vi.fn(orig.nearestFormatter) };
});

import { createI18n } from '../client-runtime/i18n.js';
import { nearestFormatter } from '../client-runtime/formatters.js';
import { setFormatLocale } from '../client-runtime/formatters/locale.js';

const EN = { 'nav.home': 'Home', items: { one: '{count} item', other: '{count} items' } };
const ES = { 'nav.home': 'Inicio', items: { one: '{count} artículo', other: '{count} artículos' } };
const MANIFEST = {
	defaultLocale: 'en',
	locales: { en: 'locales/en.json', es: 'locales/es.json', 'pt-BR': 'locales/pt-BR.json' },
};

function memoryStorage() {
	const map = new Map();
	return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

function stubFetch(byPath, { fail = [], gates = {} } = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url) => {
			const hit = Object.entries(byPath).find(([p]) => url.endsWith(p));
			const tag = hit?.[0];
			if (gates[tag]) await gates[tag];
			if (!hit || fail.includes(tag)) return { ok: false, status: 404, json: async () => ({}) };
			return { ok: true, status: 200, json: async () => hit[1] };
		})
	);
}

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => {
	setFormatLocale(undefined);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('a locale tag Intl rejects', () => {
	it('picks a plural form instead of throwing RangeError', async () => {
		const i18n = createI18n({
			manifest: { defaultLocale: 'en_US', locales: { en_US: 'locales/en_US.json' } },
			tables: { en_US: EN },
			locale: 'en_US',
		});
		await i18n.__ready();
		expect(() => new Intl.PluralRules('en_US')).toThrow(RangeError);
		expect(i18n.t('items', { count: 1 })).toBe('1 item');
		expect(i18n.t('items', { count: 3 })).toBe('3 items');
	});
});

describe('overlapping setLocale calls', () => {
	it('an overtaken call rejects when the call that overtook it fails', async () => {
		let releaseEs;
		const esGate = new Promise((r) => (releaseEs = r));
		stubFetch({ 'locales/es.json': ES }, { gates: { 'locales/es.json': esGate } });
		const refresh = vi.fn();
		const i18n = createI18n({ manifest: MANIFEST, tables: { en: EN }, locale: 'en', refresh });
		await i18n.__ready();

		const first = i18n.setLocale('es');
		const second = i18n.setLocale('pt-BR');
		await expect(second).rejects.toThrow(/failed to load/);
		releaseEs();

		await expect(first).rejects.toThrow(/failed to load/);
		expect(i18n.locale).toBe('en');
		expect(i18n.t('nav.home')).toBe('Home');
		expect(refresh).not.toHaveBeenCalled();
	});

	it('an overtaken call resolves once the call that overtook it has switched', async () => {
		let releaseEs;
		const esGate = new Promise((r) => (releaseEs = r));
		let releasePt;
		const ptGate = new Promise((r) => (releasePt = r));
		stubFetch(
			{ 'locales/es.json': ES, 'locales/pt-BR.json': { 'nav.home': 'Início' } },
			{ gates: { 'locales/es.json': esGate, 'locales/pt-BR.json': ptGate } }
		);
		const i18n = createI18n({ manifest: MANIFEST, tables: { en: EN }, locale: 'en' });
		await i18n.__ready();

		const first = i18n.setLocale('es');
		const second = i18n.setLocale('pt-BR');
		let firstSettled = false;
		first.then(() => (firstSettled = true));
		releaseEs();
		await new Promise((r) => setTimeout(r, 0));
		// The es table arrived and was dropped; the page has not switched yet.
		expect(firstSettled).toBe(false);
		expect(i18n.locale).toBe('en');

		releasePt();
		await first;
		await second;
		expect(i18n.locale).toBe('pt-BR');
	});
});

describe('dev missing-key warning', () => {
	it('computes the suggestion only for the warning that prints', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const i18n = createI18n({ manifest: MANIFEST, tables: { en: EN }, locale: 'en' });
		await i18n.__ready();
		nearestFormatter.mockClear();

		for (let i = 0; i < 5; i++) expect(i18n.t('nav.hom')).toBe('nav.hom');

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(/did you mean "nav.home"/);
		expect(nearestFormatter).toHaveBeenCalledTimes(1);
	});
});
