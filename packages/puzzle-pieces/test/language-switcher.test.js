import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// LanguageSwitcher and LanguageMenu (D177) — one input, one click contract, two
// layouts. Static guards on the manifests, the demo copies and the templates'
// attributes, plus behavioural ones that lift each <script> block out of its
// .pzl (the input-otp trick) and drive data() and the two click handlers
// against a stub ctx.i18n.

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const PIECES = [
	{ name: 'language-switcher', file: 'LanguageSwitcher.pzl', deps: [] },
	{ name: 'language-menu', file: 'LanguageMenu.pzl', deps: ['dropdown-menu'] },
];

for (const piece of PIECES) {
	piece.source = await readText(`../registry/ui/${piece.name}/${piece.file}`);
	piece.template = piece.source.slice(0, piece.source.indexOf('</puzzle-view>'));
	piece.script = piece.source.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
	assert.ok(piece.script, `${piece.file} contains a script block`);
	const moduleSource = piece.script
		.replace(
			"import { PuzzleView } from '@magic-spells/puzzle';",
			'class PuzzleView { constructor() { this.props = {}; this.ctx = {}; } }'
		)
		.replace("import DropdownMenu from './DropdownMenu/index.js';", 'const DropdownMenu = {};');
	piece.View = (
		await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
	).default;
}

// What the runtime's i18n.locales returns on /about, with and without prefix routing.
const prefixed = [
	{ locale: 'en', label: 'English', href: '/about', active: false },
	{ locale: 'es', label: 'Español', href: '/es/about', active: true },
];
const unprefixed = prefixed.map((entry) => ({ ...entry, href: '/about' }));

const mount = (View, props, i18n) => {
	const view = new View();
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

test('language-switcher has no dependencies of any kind', async () => {
	const piece = await readJSON('../registry/ui/language-switcher/piece.json');
	assert.deepEqual(piece.registryDependencies, []);
	assert.deepEqual(piece.dependencies, []);
	const { source } = PIECES[0];
	assert.equal(/^import\b/m.test(source.replace("import { PuzzleView } from '@magic-spells/puzzle';", '')), false);
});

for (const { name, file, deps, source, template, script, View } of PIECES) {
	test(`${name}: manifest, registry.json row and demo copy agree`, async () => {
		const [piece, registry, copy] = await Promise.all([
			readJSON(`../registry/ui/${name}/piece.json`),
			readJSON('../registry/registry.json'),
			readText(`../demo/app/components/ui/${file}`),
		]);
		assert.deepEqual(piece.files, [file]);
		assert.deepEqual(piece.registryDependencies, deps);
		assert.deepEqual(piece.dependencies, []);
		const row = registry.pieces.find((p) => p.name === name);
		assert.deepEqual(row, piece, `registry.json's ${name} row has drifted from piece.json`);
		assert.equal(copy, source, `demo/app/components/ui/${file} has drifted`);
	});

	test(`${name}: the list is a prop — the piece never reads ctx.i18n.locales`, () => {
		// A prop-less switcher inside a persistent layout reads the list once and
		// keeps the first page's hrefs after client-side navigation.
		assert.equal(/i18n\??\.locales/.test(script.replace(/^\s*\/\/.*$/gm, '')), false);
		assert.match(script, /props\.locales/);
	});

	test(`${name}: links carry href, hreflang, lang and the string aria-current; buttons are type=button`, () => {
		const links = [...template.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
		assert.equal(links.length, 1);
		assert.match(links[0], /href=\{ option\.href \}/);
		assert.match(links[0], /hreflang=\{ option\.locale \}/);
		assert.match(links[0], /lang=\{ option\.locale \}/);
		assert.match(links[0], /aria-current=\{ option\.current \}/);
		assert.match(links[0], /@click=\{ follow\(event, option\.locale\) \}/);
		const buttons = [...template.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]);
		assert.equal(buttons.length, 1);
		assert.match(buttons[0], /type="button"/);
		assert.match(buttons[0], /lang=\{ option\.locale \}/);
		assert.doesNotMatch(buttons[0], /hreflang/);
		assert.match(buttons[0], /@click=\{ pick\(option\.locale\) \}/);
		// menu mode owns roles and the roving tabindex
		assert.equal(/\brole=|tabindex=/.test(template), false);
	});

	test(`${name}: links under prefix routing, buttons when every href is the same page`, () => {
		const routed = mount(View, {}).data({}, { locales: prefixed });
		assert.equal(routed.routed, true);
		assert.deepEqual(
			routed.options.map((o) => [o.locale, o.label, o.href, o.current]),
			[
				['en', 'English', '/about', false],
				['es', 'Español', '/es/about', 'true'],
			]
		);
		assert.equal(mount(View, {}).data({}, { locales: unprefixed }).routed, false);
		// a host with no page to name gives every entry ''
		const blank = prefixed.map((entry) => ({ ...entry, href: '' }));
		assert.equal(mount(View, {}).data({}, { locales: blank }).routed, false);
		assert.equal(mount(View, {}).data({}, {}).routed, false);
		assert.deepEqual(mount(View, {}).data({}, {}).options, []);
	});

	test(`${name}: a plain link click fires the hook, prevents default and calls setLocale`, () => {
		const i18n = stubI18n();
		const changes = [];
		const view = mount(View, { locales: prefixed, change: (tag) => changes.push(tag) }, i18n);
		const event = click();
		view.events.follow(event, 'en');
		assert.equal(event.prevented, true);
		assert.deepEqual(i18n.calls, ['en']);
		assert.deepEqual(changes, ['en']);
	});

	test(`${name}: a modified or middle click is left to the browser`, () => {
		for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
			const i18n = stubI18n();
			const changes = [];
			const view = mount(View, { locales: prefixed, change: (tag) => changes.push(tag) }, i18n);
			const event = click(extra);
			view.events.follow(event, 'en');
			assert.equal(event.prevented, false, JSON.stringify(extra));
			assert.deepEqual(i18n.calls, []);
			assert.deepEqual(changes, []);
		}
	});

	test(`${name}: @change is a pure hook — with no i18n a link navigates as written`, () => {
		const changes = [];
		const view = mount(View, { locales: prefixed, change: (tag) => changes.push(tag) });
		const event = click();
		view.events.follow(event, 'en');
		assert.equal(event.prevented, false);
		assert.deepEqual(changes, ['en']);
		const bare = click();
		mount(View, { locales: prefixed }).events.follow(bare, 'en');
		assert.equal(bare.prevented, false);
	});

	test(`${name}: a button calls setLocale`, () => {
		const i18n = stubI18n();
		mount(View, { locales: unprefixed }, i18n).events.pick('en');
		assert.deepEqual(i18n.calls, ['en']);
		// no i18n: the hook alone, and nothing throws
		const changes = [];
		mount(View, { locales: unprefixed, change: (tag) => changes.push(tag) }).events.pick('es');
		assert.deepEqual(changes, ['es']);
	});

	test(`${name}: tokens only — no hex colours, arbitrary values or edge accent bars`, () => {
		assert.equal(/#[0-9a-f]{3,8}\b/i.test(source), false, `${file} contains a hex colour`);
		assert.equal(/\b[a-z-]+-\[[^\]]+\]/.test(source), false, `${file} uses an arbitrary-value class`);
		assert.equal(/\bborder-[lse]-/.test(source), false, 'no edge accent bars');
	});
}

test('language-switcher: label defaults to "Language"', () => {
	const { View } = PIECES[0];
	assert.equal(mount(View, {}).data({}, { locales: prefixed }).label, 'Language');
	assert.equal(mount(View, {}).data({}, { locales: prefixed, label: 'Idioma' }).label, 'Idioma');
});

test('language-menu: trigger shows the active language, align defaults to start', () => {
	const { View } = PIECES[1];
	const data = mount(View, {}).data({}, { locales: prefixed });
	assert.equal(data.activeLabel, 'Español');
	assert.equal(data.activeLocale, 'es');
	assert.equal(data.labelPrefix, 'Language: ');
	assert.equal(data.align, 'start');
	const end = mount(View, {}).data({}, { locales: prefixed, align: 'end', label: 'Idioma' });
	assert.equal(end.align, 'end');
	assert.equal(end.labelPrefix, 'Idioma: ');
});
