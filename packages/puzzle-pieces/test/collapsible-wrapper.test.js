import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the collapsible-content WRAPPER families. There is nothing
// behavioural left to unit test in this repo: the height measurement, the
// distance-derived duration, the mid-animation reversal, the exclusive-group
// arbitration and every ARIA attribute live in @magic-spells/collapsible-content
// and are tested there. What can still regress here is the wiring — the
// manifests, the barrels, and the rules a wrapper piece has to keep.

const PACKAGE = '@magic-spells/collapsible-content';
const SPECIFIER = PACKAGE.replace('/', '\\/');

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const COLLAPSIBLE_FILES = [
	'Collapsible/Collapsible.pzl',
	'Collapsible/Trigger.pzl',
	'Collapsible/Content.pzl',
	'Collapsible/index.js',
];
const ACCORDION_FILES = [
	'Accordion/Accordion.pzl',
	'Accordion/Item.pzl',
	'Accordion/Trigger.pzl',
	'Accordion/Content.pzl',
	'Accordion/index.js',
];

const PIECES = [
	{
		piece: 'collapsible',
		manifest: '../registry/ui/collapsible/piece.json',
		files: COLLAPSIBLE_FILES,
		registryDependencies: [],
		dependencies: [PACKAGE],
	},
	{
		piece: 'accordion',
		manifest: '../registry/ui/accordion/piece.json',
		files: ACCORDION_FILES,
		// The npm package is inherited transitively through the collapsible
		// piece; the add CLI accumulates dependencies across the resolved set.
		registryDependencies: ['collapsible'],
		dependencies: [],
	},
];

const ALL = [
	...COLLAPSIBLE_FILES.map((file) => ['collapsible', file]),
	...ACCORDION_FILES.map((file) => ['accordion', file]),
];

for (const entry of PIECES) {
	test(`the ${entry.piece} manifest declares its files and dependencies`, async () => {
		const piece = await readJSON(entry.manifest);
		assert.deepEqual(piece.files, entry.files);
		assert.deepEqual(piece.registryDependencies, entry.registryDependencies);
		assert.deepEqual(piece.dependencies, entry.dependencies);
		assert.equal(piece.targetDir, 'app/components/ui');
	});

	test(`registry.json mirrors the ${entry.piece} manifest`, async () => {
		const [piece, registry] = await Promise.all([
			readJSON(entry.manifest),
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
}

test(`exactly two dynamic imports of ${PACKAGE}, one per family root`, async () => {
	const sources = await Promise.all(
		ALL.map(async ([piece, file]) => [
			`${piece}/${file}`,
			await readText(`../registry/ui/${piece}/${file}`),
		])
	);

	const dynamic = new RegExp(`import\\(\\s*['"]${SPECIFIER}['"]\\s*\\)`);
	const holders = sources.filter(([, source]) => dynamic.test(source)).map(([file]) => file);
	// An Accordion can mount with zero Collapsible members (Item renders the raw
	// element), so it needs its own upgrade import. The import is module-cached,
	// so the two together still cost one fetch — and a MEMBER that imported would
	// be a member you could not drop.
	assert.deepEqual(holders, [
		'collapsible/Collapsible/Collapsible.pzl',
		'accordion/Accordion/Accordion.pzl',
	]);

	for (const [file, source] of sources) {
		// A top-level `import … from '<package>'` evaluates
		// `class extends HTMLElement` under Node and takes the whole prerender
		// pass down with a ReferenceError.
		assert.equal(
			new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${SPECIFIER}['"]`, 'm').test(source),
			false,
			`${file} must not import ${PACKAGE} at module scope`
		);
		assert.equal(
			source.includes('customElements'),
			false,
			`${file} registers nothing itself`
		);
		assert.equal(/^<style[\s>]/m.test(source), false, `${file} has a <style> block`);
		assert.equal(
			/[^&]#[0-9a-fA-F]{3,8}\b/.test(source.replace(/#\{/g, '')),
			false,
			`${file} has a hex color — semantic tokens only`
		);
	}
});

test('no template binds the observed `open` attribute except the frozen seed', async () => {
	for (const [piece, file] of ALL.filter(([, f]) => f.endsWith('.pzl'))) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		const template = source.slice(0, source.indexOf('<script>'));
		const bindings = template.match(/\bopen\s*=\s*\{[^}]*\}/g) || [];
		const allowed =
			file === 'Collapsible/Content.pzl' ? ['open={ initialOpen }'] : [];
		assert.deepEqual(
			bindings,
			allowed,
			`${file} binds \`open\` — <collapsible-content> OBSERVES that attribute and its own \`collapsed\` setter writes it back, so a live binding fights the patcher every render. Drive it through show()/hide() instead.`
		);
	}
});

test('Collapsible.Content freezes the seed on the first data() call', async () => {
	const source = await readText('../registry/ui/collapsible/Collapsible/Content.pzl');
	assert.match(source, /#initialOpen\s*\?\?=/);
	assert.match(source, /initialOpen: this\.#initialOpen \|\| false/);
});

test('padding lives on an inner wrapper, not on the animating element', async () => {
	// <collapsible-content> animates its HEIGHT, and height is the content box: a
	// closed panel at height 0 still renders its own padding, so `pb-4` on the host
	// leaves dead space under every closed row.
	const source = await readText('../registry/ui/collapsible/Collapsible/Content.pzl');
	const template = source.slice(0, source.indexOf('<script>'));
	assert.match(
		template,
		/<collapsible-content(?![^>]*\bclass=)[^>]*><div class=\{ contentClass \}><Children\/><\/div><\/collapsible-content>/,
		'the host must carry no class of ours, and the padding must sit on the single inner <div>'
	);
});

test('the panel element carries no layout utilities of ours', async () => {
	// overflow:hidden, display:block and `transition: height` are the element
	// stylesheet's. Duplicating them here either fights the measurement or
	// silently pins the panel.
	for (const file of [
		'../registry/ui/collapsible/Collapsible/Content.pzl',
		'../registry/ui/accordion/Accordion/Content.pzl',
	]) {
		const source = await readText(file);
		for (const banned of ['overflow-hidden', 'transition-[height', 'h-auto']) {
			assert.equal(source.includes(`'${banned}`), false, `${file} sets ${banned}`);
		}
		const constLine = source.match(/^const CONTENT = .*$/m)?.[0] ?? '';
		assert.equal(/overflow|transition|\bh-/.test(constLine), false, constLine);
	}
});

test('both roots filter the bubbling collapsible:toggle by target', async () => {
	const collapsible = await readText('../registry/ui/collapsible/Collapsible/Collapsible.pzl');
	assert.match(
		collapsible,
		/if \(event\.target !== this\.#item\(\)\) return;/,
		'collapsible:toggle bubbles and is composed — without a target check a nested collapsible reports as its parent'
	);

	const accordion = await readText('../registry/ui/accordion/Accordion/Accordion.pzl');
	assert.match(
		accordion,
		/if \(item\.closest\('collapsible-group'\) !== this\.element\) return;/,
		"a nested accordion's items bubble straight through this element on their way up"
	);
	assert.match(
		accordion,
		/\.filter\(\s*\(el\) => el\.closest\('collapsible-group'\) === this\.element\s*\)/,
		'#items() must be direct members of THIS group only'
	);
	assert.match(
		accordion,
		/if \(!!item\.open === want\) return;/,
		'the no-op guard is what keeps a parent echoing back our value from animating a second time'
	);
});

test('Collapsible shields itself with a non-exclusive group root', async () => {
	const source = await readText('../registry/ui/collapsible/Collapsible/Collapsible.pzl');
	const template = source.slice(0, source.indexOf('<script>'));
	// A component joins its NEAREST <collapsible-group>. Without this wrapper a
	// standalone Collapsible nested in an accordion item would be slammed shut by
	// that accordion's exclusivity.
	assert.match(template, /<collapsible-group class=\{ rootClass \}><collapsible-component>/);
	assert.equal(/exclusive/.test(template), false, 'the standalone group is never exclusive');
});

test('Accordion.Item renders the raw element, not a nested Collapsible', async () => {
	const source = await readText('../registry/ui/accordion/Accordion/Item.pzl');
	const template = source.slice(0, source.indexOf('<script>'));
	assert.match(template, /<collapsible-component data-value=/);
	assert.equal(
		template.includes('collapsible-group'),
		false,
		"an Item inside its own group would shield itself from its own accordion's exclusivity"
	);
});

test('accordion composes the collapsible family from the right relative depth', async () => {
	// Both families land side by side under app/components/ui/, so a member sits
	// one directory down. Get the depth wrong and the copy resolves nothing.
	for (const file of ['Trigger.pzl', 'Content.pzl']) {
		const source = await readText(`../registry/ui/accordion/Accordion/${file}`);
		assert.match(source, /import Collapsible from '\.\.\/Collapsible\/index\.js';/, file);
	}
});

test('both barrels export the D167 Object.assign family shape', async () => {
	const collapsible = await readText('../registry/ui/collapsible/Collapsible/index.js');
	assert.match(collapsible, /export \{ Collapsible, Trigger, Content \}/);
	assert.match(collapsible, /export default Object\.assign\(Collapsible, \{ Trigger, Content \}\)/);

	const accordion = await readText('../registry/ui/accordion/Accordion/index.js');
	assert.match(accordion, /export \{ Accordion, Item, Trigger, Content \}/);
	assert.match(
		accordion,
		/export default Object\.assign\(Accordion, \{ Item, Trigger, Content \}\)/
	);
});

test('no piece re-authors the ARIA the component writes', async () => {
	// connectedCallback writes id, type, aria-controls, aria-expanded,
	// aria-labelledby, role="region", aria-hidden and inert, and overwrites
	// anything authored. Duplicating them is dead code that drifts.
	const written = ['aria-expanded=', 'aria-controls=', 'aria-labelledby=', 'role="region"'];
	for (const [piece, file] of ALL.filter(([, f]) => f.endsWith('.pzl'))) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		const template = source.slice(0, source.indexOf('<script>'));
		for (const attr of written) {
			assert.equal(template.includes(attr), false, `${file} authors ${attr}`);
		}
	}

	// aria-hidden="true" on a decorative chevron is ours and fine; on the panel
	// element it would fight the component, which keeps it in step with every
	// animation.
	for (const file of [
		'../registry/ui/collapsible/Collapsible/Content.pzl',
		'../registry/ui/accordion/Accordion/Content.pzl',
	]) {
		const source = await readText(file);
		const template = source.slice(0, source.indexOf('<script>'));
		for (const attr of ['aria-hidden=', 'inert=']) {
			assert.equal(template.includes(attr), false, `${file} authors ${attr}`);
		}
	}
});
