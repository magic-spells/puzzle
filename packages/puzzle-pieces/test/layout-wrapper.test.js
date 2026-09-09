import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the three layout WRAPPER families (0.7.0). There is nothing
// behavioural left to unit test in this repo: the roving tabindex and panel
// visibility, the split geometry and snap math, and the panel stack's push/pop
// state machine all live in their web components and are tested there. What can
// still regress here is the wiring — the manifests, the barrels, and the rules a
// wrapper piece has to keep.

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const PIECES = [
	{
		piece: 'tabs',
		dir: 'Tabs',
		package: '@magic-spells/tab-group',
		root: 'Tabs/Tabs.pzl',
		files: ['Tabs/Tabs.pzl', 'Tabs/List.pzl', 'Tabs/Tab.pzl', 'Tabs/Panel.pzl', 'Tabs/index.js'],
		barrel: [
			/export \{ Tabs, List, Tab, Panel \}/,
			/export default Object\.assign\(Tabs, \{ List, Tab, Panel \}\)/,
		],
	},
	{
		piece: 'split-panel',
		dir: 'SplitPanel',
		package: '@magic-spells/split-panel',
		root: 'SplitPanel/SplitPanel.pzl',
		files: [
			'SplitPanel/SplitPanel.pzl',
			'SplitPanel/Pane.pzl',
			'SplitPanel/Divider.pzl',
			'SplitPanel/index.js',
		],
		barrel: [
			/export \{ SplitPanel, Pane, Divider \}/,
			/export default Object\.assign\(SplitPanel, \{ Pane, Divider \}\)/,
		],
	},
	{
		piece: 'panel-stack',
		dir: 'PanelStack',
		package: '@magic-spells/panel-stack',
		root: 'PanelStack/PanelStack.pzl',
		files: ['PanelStack/PanelStack.pzl', 'PanelStack/Panel.pzl', 'PanelStack/index.js'],
		barrel: [
			/export \{ PanelStack, Panel \}/,
			/export default Object\.assign\(PanelStack, \{ Panel \}\)/,
		],
	},
];

const ALL = PIECES.flatMap((entry) => entry.files.map((file) => [entry.piece, file]));

for (const entry of PIECES) {
	test(`the ${entry.piece} manifest declares its files and dependencies`, async () => {
		const piece = await readJSON(`../registry/ui/${entry.piece}/piece.json`);
		assert.deepEqual(piece.files, entry.files);
		assert.deepEqual(piece.registryDependencies, []);
		assert.deepEqual(piece.dependencies, [entry.package]);
		assert.equal(piece.targetDir, 'app/components/ui');
	});

	test(`registry.json mirrors the ${entry.piece} manifest`, async () => {
		const [piece, registry] = await Promise.all([
			readJSON(`../registry/ui/${entry.piece}/piece.json`),
			readJSON('../registry/registry.json'),
		]);
		const row = registry.pieces.find((p) => p.name === entry.piece);

		assert.ok(row, `registry.json has no ${entry.piece} entry`);
		assert.equal(row.description, piece.description);
		assert.deepEqual(row.files, piece.files);
		assert.deepEqual(row.registryDependencies, piece.registryDependencies);
		assert.deepEqual(row.dependencies, piece.dependencies);
		assert.equal(row.targetDir, piece.targetDir);
	});

	test(`every ${entry.piece} manifest file exists on disk`, async () => {
		for (const file of entry.files) {
			await access(new URL(`../registry/ui/${entry.piece}/${file}`, import.meta.url));
		}
	});

	test(`only the ${entry.piece} root imports ${entry.package}, and only dynamically`, async () => {
		const specifier = entry.package.replace('/', '\\/');
		const dynamic = new RegExp(`import\\(\\s*['"]${specifier}['"]\\s*\\)`);
		const holders = [];
		for (const file of entry.files) {
			const source = await readText(`../registry/ui/${entry.piece}/${file}`);
			if (dynamic.test(source)) holders.push(file);
			// A top-level `import … from '<package>'` evaluates
			// `class extends HTMLElement` under Node and takes the whole
			// prerender pass down with a ReferenceError.
			assert.equal(
				new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${specifier}['"]`, 'm').test(source),
				false,
				`${file} must not import ${entry.package} at module scope`
			);
		}
		assert.deepEqual(holders, [entry.root], `${entry.piece}: exactly one dynamic import`);
	});

	test(`the ${entry.piece} barrel exports the D167 Object.assign family shape`, async () => {
		const source = await readText(`../registry/ui/${entry.piece}/${entry.dir}/index.js`);
		for (const pattern of entry.barrel) assert.match(source, pattern);
	});
}

test('no layout member ships a <style> block, customElements, or a hex colour', async () => {
	for (const [piece, file] of ALL) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		assert.equal(/^<style[\s>]/m.test(source), false, `${file} has a <style> block`);
		assert.equal(source.includes('customElements'), false, `${file} registers nothing itself`);
		assert.equal(
			/[^&]#[0-9a-fA-F]{3,8}\b/.test(source.replace(/#\{/g, '')),
			false,
			`${file} has a hex color — semantic tokens only`
		);
	}
});

test('no template binds a reflected attribute except the frozen PanelStack seed', async () => {
	// <tab-group> observes AND reflects `active`; <panel-stack> does the same
	// with `current`; <tab-panel>'s `hidden` is written by its group. A live
	// binding on any of them fights the patcher every render.
	for (const [piece, file] of ALL.filter(([, f]) => f.endsWith('.pzl'))) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		const template = source.slice(0, source.indexOf('<script>'));
		const bindings = template.match(/\b(active|current|hidden)\s*=\s*\{[^}]*\}/g) || [];
		const allowed =
			file === 'PanelStack/PanelStack.pzl' ? ['current={ initialCurrent }'] : [];
		assert.deepEqual(bindings, allowed, `${file} binds a reflected attribute`);
	}
});

test('PanelStack freezes its seed on the first data() call', async () => {
	const source = await readText('../registry/ui/panel-stack/PanelStack/PanelStack.pzl');
	assert.match(source, /this\.#initialCurrent \?\?=/);
});

test('PanelStack reports @change from the post-mutation panel-stack:change', async () => {
	// push and pop fire BEFORE the stack moves, so their handle is the old one.
	// panel-stack:change fires from upstream's reflect funnel after it settles.
	const source = await readText('../registry/ui/panel-stack/PanelStack/PanelStack.pzl');
	assert.match(source, /addEventListener\('panel-stack:change', this\.#onChange\)/);
	assert.match(source, /this\.props\.change\?\.\(event\.detail\?\.handle\)/);
	assert.equal(source.includes('queueMicrotask'), false, 'no deferred derivation left');
});

test('every root filters its bubbling events by target', async () => {
	// tabchange, split-panel:* and panel-stack:* all bubble and are composed, so
	// without a target check a nested instance reports as its parent.
	for (const root of [
		'../registry/ui/tabs/Tabs/Tabs.pzl',
		'../registry/ui/split-panel/SplitPanel/SplitPanel.pzl',
		'../registry/ui/panel-stack/PanelStack/PanelStack.pzl',
	]) {
		const source = await readText(root);
		assert.match(source, /if \(event\.target !== this\.element\) return;/, root);
		assert.match(source, /if \(this\.#syncing\) return;/, root);
	}
});

test('Tabs scopes its lookups to its own group', async () => {
	const source = await readText('../registry/ui/tabs/Tabs/Tabs.pzl');
	assert.match(source, /:scope > tab-list > tab-button\[data-value\]/);
	assert.match(source, /:scope > tab-panel\[data-value\]/);
	// Tailwind's disabled: variant compiles to :disabled and never matches a
	// custom element.
	const tab = await readText('../registry/ui/tabs/Tabs/Tab.pzl');
	assert.match(tab, /\[&\[disabled\]\]:opacity-50/);
	const tabConst = tab.slice(tab.indexOf('const TAB ='), tab.indexOf('export default'));
	assert.equal(
		/[\s']disabled:/.test(tabConst),
		false,
		"Tab must not use Tailwind's disabled: variant — it compiles to :disabled"
	);
	// A display utility on <tab-panel> outranks tab-panel[hidden] and leaves
	// every panel visible.
	const panel = await readText('../registry/ui/tabs/Tabs/Panel.pzl');
	assert.equal(/const PANEL =/.test(panel), false, 'Tabs.Panel carries no chrome of its own');
});

test('no piece re-authors the ARIA its component writes', async () => {
	const written = [
		'role=',
		'aria-selected=',
		'aria-controls=',
		'aria-labelledby=',
		'aria-orientation=',
		'aria-valuenow=',
		'tabindex=',
		'inert=',
		'state=',
	];
	for (const [piece, file] of ALL.filter(([, f]) => f.endsWith('.pzl'))) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		const template = source.slice(0, source.indexOf('<script>'));
		for (const attr of written) {
			assert.equal(template.includes(attr), false, `${file} authors ${attr}`);
		}
	}
});

test('lib/panel-stack.js is gone from the registry, the demo and the index', async () => {
	const registry = await readText('../registry/registry.json');
	assert.equal(registry.includes('lib/panel-stack.js'), false, 'registry.json still lists it');

	for (const path of ['../registry/lib/panel-stack.js', '../demo/app/lib/panel-stack.js']) {
		await assert.rejects(
			access(new URL(path, import.meta.url)),
			`${path} still exists — the component's per-state custom properties replaced it`
		);
	}
});
