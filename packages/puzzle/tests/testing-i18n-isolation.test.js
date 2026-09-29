// @vitest-environment jsdom
//
// The `/testing` `i18n` option must not leak into later tests (D175).
//
// The formatter locale and `<html lang>` are page-wide slots: the i18n service
// sets both when it loads a locale, and destroying the app or view resets
// neither. Vitest isolates modules and jsdom per FILE, so a translated test used
// to leave every later test in the same file formatting numbers and dates in
// that locale — contradicting D175's "without i18n they keep browser-locale
// behavior" — with no public way to reset it. The handles now restore both.
//
// ORDER MATTERS: each test relies on the one before it having run and been
// destroyed. Only the public entry points are used.
import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleView, ViewNode } from '../client-runtime/index.js';
import { createTestApp, mountView } from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

class Prices extends PuzzleView {
	render() {
		const f = this.ctx.formatters.getAll();
		return h('p', {}, [text(f.number_with_delimiter(1234.5) + ' | ' + f.pluralize(1234.5, 'item'))]);
	}
}

// What the viewer's (Intl default) locale prints for the same values.
const viewerNumber = new Intl.NumberFormat(undefined, {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
}).format(1234.5);
const viewerText = `${viewerNumber} | ${viewerNumber} items`;

const handles = [];
afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
});

describe('/testing restores the formatter locale and <html lang> on destroy', () => {
	it('1. mountView with i18n renders in that locale', async () => {
		const view = await mountView(Prices, { i18n: { locale: 'de', strings: {} } });
		handles.push(view);
		expect(view.element.textContent).toBe('1.234,5 | 1.234,5 items');
		expect(document.documentElement.lang).toBe('de');
	});

	it('2. a later mountView without i18n is back to the viewer locale', async () => {
		const view = await mountView(Prices);
		handles.push(view);
		expect(view.element.textContent).toBe(viewerText);
		expect(document.documentElement.getAttribute('lang')).toBeNull();
	});

	it('3. createTestApp with i18n restores both once destroyed', async () => {
		const app = await createTestApp({
			routes: [{ path: '/', view: Prices }],
			i18n: { locale: 'fr', strings: {} },
		});
		expect(document.documentElement.lang).toBe('fr');
		app.destroy();
		expect(document.documentElement.getAttribute('lang')).toBeNull();

		const view = await mountView(Prices);
		handles.push(view);
		expect(view.element.textContent).toBe(viewerText);
	});

	it('4. overlapping handles destroyed out of order restore the pre-handle state', async () => {
		const de = await mountView(Prices, { i18n: { locale: 'de', strings: {} } });
		const fr = await mountView(Prices, { i18n: { locale: 'fr', strings: {} } });
		handles.push(de, fr); // cleanup if an assertion below fails (destroy is idempotent)
		expect(document.documentElement.lang).toBe('fr');

		// The first handle goes first: the second is still live and keeps its locale.
		de.destroy();
		expect(document.documentElement.lang).toBe('fr');
		fr.destroy();
		expect(document.documentElement.getAttribute('lang')).toBeNull();
	});

	it('5. …so the next test is back to the viewer locale', async () => {
		const view = await mountView(Prices);
		handles.push(view);
		expect(view.element.textContent).toBe(viewerText);
	});
});
