import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// LanguageSwitcher (D177). Two kinds of guard: static ones on the manifest, the
// demo copy and the template's attributes, and behavioural ones that lift the
// <script> block out of the .pzl (the input-otp trick) and drive data() and the
// two click handlers against a stub ctx.i18n.

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const SRC = '../registry/ui/language-switcher/LanguageSwitcher.pzl';
const source = await readText(SRC);
const template = source.slice(0, source.indexOf('</puzzle-view>'));
const script = source.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
assert.ok(script, 'LanguageSwitcher.pzl contains a script block');

const moduleSource = script
	.replace(
		"import { PuzzleView } from '@magic-spells/puzzle';",
		'class PuzzleView { constructor() { this.props = {}; this.ctx = {}; } }'
	)
	.replace("import DropdownMenu from './DropdownMenu/index.js';", 'const DropdownMenu = {};');
const { default: LanguageSwitcher } = await import(
	`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

// What the runtime's i18n.locales returns on /about, with and without prefix routing.
const prefixed = [
	{ locale: 'en', label: 'English', href: '/about', active: false },
	{ locale: 'es', label: 'Español', href: '/es/about', active: true },
];
const unprefixed = prefixed.map((entry) => ({ ...entry, href: '/about' }));

const mount = (props, i18n) => {
	const view = new LanguageSwitcher();
	view.props = props;
	if (i18n) view.ctx = { i18n };
	return view;
};
const stubI18n = () => {
	const calls = [];
	return { calls, setLocale: (tag) => (calls.push(tag), Promise.resolve()) };
};
const click = (extra = {}) => {
	const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, prevented: false, ...extra };
	event.preventDefault = () => (event.prevented = true);
	return event;
};

test('language-switcher: manifest, registry.json row and demo copy agree', async () => {
	const [piece, registry, copy] = await Promise.all([
		readJSON('../registry/ui/language-switcher/piece.json'),
		readJSON('../registry/registry.json'),
		readText('../demo/app/components/ui/LanguageSwitcher.pzl'),
	]);
	assert.deepEqual(piece.files, ['LanguageSwitcher.pzl']);
	assert.deepEqual(piece.registryDependencies, ['dropdown-menu']);
	assert.deepEqual(piece.dependencies, []);
	const row = registry.pieces.find((p) => p.name === 'language-switcher');
	assert.deepEqual(row, piece, "registry.json's language-switcher row has drifted from piece.json");
	assert.equal(copy, source, 'demo/app/components/ui/LanguageSwitcher.pzl has drifted');
});

test('language-switcher: the list is a prop — the piece never reads ctx.i18n.locales', () => {
	// A prop-less switcher inside a persistent layout reads the list once and
	// keeps the first page's hrefs after client-side navigation.
	assert.equal(/i18n\??\.locales/.test(script.replace(/^\s*\/\/.*$/gm, '')), false);
	assert.match(script, /props\.locales/);
});

test('language-switcher: links carry href, hreflang, lang and the string aria-current', () => {
	const links = [...template.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
	assert.equal(links.length, 2, 'one link row for the inline list, one for the menu');
	for (const link of links) {
		assert.match(link, /href=\{ option\.href \}/);
		assert.match(link, /hreflang=\{ option\.locale \}/);
		assert.match(link, /lang=\{ option\.locale \}/);
		assert.match(link, /aria-current=\{ option\.current \}/);
		assert.match(link, /@click=\{ follow\(event, option\.locale\) \}/);
	}
	const buttons = [...template.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
	assert.equal(buttons.length, 2);
	for (const button of buttons) {
		assert.match(button, /type="button"/);
		assert.match(button, /lang=\{ option\.locale \}/);
		assert.doesNotMatch(button, /hreflang/);
		assert.match(button, /@click=\{ pick\(event, option\.locale\) \}/);
	}
	// menu mode owns roles and the roving tabindex
	assert.equal(/\brole=|tabindex=/.test(template), false);
});

test('language-switcher: links under prefix routing, buttons when every href is the same page', () => {
	const routed = mount({ locales: prefixed }).data({}, { locales: prefixed });
	assert.equal(routed.routed, true);
	assert.deepEqual(
		routed.options.map((o) => [o.locale, o.label, o.href, o.current]),
		[
			['en', 'English', '/about', false],
			['es', 'Español', '/es/about', 'true'],
		]
	);
	assert.equal(routed.activeLabel, 'Español');
	assert.equal(routed.activeLocale, 'es');

	assert.equal(mount({}).data({}, { locales: unprefixed }).routed, false);
	// a host with no page to name gives every entry ''
	const blank = prefixed.map((entry) => ({ ...entry, href: '' }));
	assert.equal(mount({}).data({}, { locales: blank }).routed, false);
	assert.equal(mount({}).data({}, {}).routed, false);
	assert.deepEqual(mount({}).data({}, {}).options, []);
});

test('language-switcher: defaults — inline, label "Language", align start', () => {
	const data = mount({}).data({}, { locales: prefixed });
	assert.equal(data.menu, false);
	assert.equal(data.label, 'Language');
	assert.equal(data.align, 'start');
	const menu = mount({}).data({}, { locales: prefixed, variant: 'menu', align: 'end', label: 'Idioma' });
	assert.equal(menu.menu, true);
	assert.equal(menu.align, 'end');
	assert.equal(menu.labelPrefix, 'Idioma: ');
});

test('language-switcher: a plain link click prevents default and calls setLocale', () => {
	const i18n = stubI18n();
	const changes = [];
	const view = mount({ locales: prefixed, change: (tag) => changes.push(tag) }, i18n);
	const event = click();
	view.events.follow(event, 'en');
	assert.equal(event.prevented, true);
	assert.deepEqual(i18n.calls, ['en']);
	assert.deepEqual(changes, ['en']);
});

test('language-switcher: a modified or middle click is left to the browser', () => {
	for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
		const i18n = stubI18n();
		const view = mount({ locales: prefixed }, i18n);
		const event = click(extra);
		view.events.follow(event, 'en');
		assert.equal(event.prevented, false, JSON.stringify(extra));
		assert.deepEqual(i18n.calls, []);
	}
});

test('language-switcher: with no i18n and no @change, a link navigates as written', () => {
	const view = mount({ locales: prefixed });
	const event = click();
	view.events.follow(event, 'en');
	assert.equal(event.prevented, false);
});

test('language-switcher: a button calls setLocale', () => {
	const i18n = stubI18n();
	const view = mount({ locales: unprefixed }, i18n);
	view.events.pick(click({ shiftKey: true }), 'en');
	assert.deepEqual(i18n.calls, ['en']);
	// no i18n: the hook alone, and nothing throws
	const changes = [];
	mount({ locales: unprefixed, change: (tag) => changes.push(tag) }).events.pick(click(), 'es');
	assert.deepEqual(changes, ['es']);
});

test('language-switcher: tokens only — no hex colours and no arbitrary-value classes', () => {
	assert.equal(/#[0-9a-f]{3,8}\b/i.test(source), false, 'LanguageSwitcher.pzl contains a hex colour');
	assert.equal(/\b[a-z-]+-\[[^\]]+\]/.test(source), false, 'LanguageSwitcher.pzl uses an arbitrary-value class');
	assert.equal(/\bborder-[lse]-/.test(source), false, 'no edge accent bars');
});
