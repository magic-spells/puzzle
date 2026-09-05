import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the select-dropdown WRAPPER family. There is nothing
// behavioural left to unit test in this repo: the listbox ARIA, the roving
// tabindex, typeahead, the disabled-option skipping and the panel positioning
// all live in @magic-spells/select-dropdown and are tested there. What can still
// regress here is the wiring — the manifest, the barrel, and the rules a wrapper
// piece has to keep.

const PACKAGE = '@magic-spells/select-dropdown';
const SPECIFIER = PACKAGE.replace('/', '\\/');

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const FILES = [
	'Select/Select.pzl',
	'Select/Option.pzl',
	'Select/Label.pzl',
	'Select/Divider.pzl',
	'Select/index.js',
];
const VIEWS = FILES.filter((file) => file.endsWith('.pzl'));

const templateOf = (source) => source.slice(0, source.indexOf('<script>'));

test('the select manifest declares its files and dependencies', async () => {
	const piece = await readJSON('../registry/ui/select/piece.json');
	assert.deepEqual(piece.files, FILES);
	assert.deepEqual(piece.registryDependencies, []);
	// morph-engine is GONE: the morph prop went with the port.
	assert.deepEqual(piece.dependencies, [PACKAGE]);
	assert.equal(piece.targetDir, 'app/components/ui');
});

test('registry.json mirrors the select manifest', async () => {
	const [piece, registry] = await Promise.all([
		readJSON('../registry/ui/select/piece.json'),
		readJSON('../registry/registry.json'),
	]);
	const row = registry.pieces.find((p) => p.name === 'select');
	assert.ok(row, 'registry.json has no select entry');
	assert.equal(row.description, piece.description);
	assert.deepEqual(row.files, piece.files);
	assert.deepEqual(row.registryDependencies, piece.registryDependencies);
	assert.deepEqual(row.dependencies, piece.dependencies);
	assert.equal(row.targetDir, piece.targetDir);
});

test('every select manifest file exists on disk', async () => {
	for (const file of FILES) {
		await access(new URL(`../registry/ui/select/${file}`, import.meta.url));
	}
});

test(`exactly one dynamic import of ${PACKAGE}, in the family root`, async () => {
	const sources = await Promise.all(
		FILES.map(async (file) => [file, await readText(`../registry/ui/select/${file}`)])
	);

	const dynamic = new RegExp(`import\\(\\s*['"]${SPECIFIER}['"]\\s*\\)`);
	const holders = sources.filter(([, source]) => dynamic.test(source)).map(([file]) => file);
	assert.deepEqual(holders, ['Select/Select.pzl']);

	for (const [file, source] of sources) {
		// A top-level `import … from '<package>'` evaluates
		// `class extends HTMLElement` under Node and takes the whole prerender
		// pass down with a ReferenceError.
		assert.equal(
			new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${SPECIFIER}['"]`, 'm').test(source),
			false,
			`${file} must not import ${PACKAGE} at module scope`
		);
		assert.equal(source.includes('customElements'), false, `${file} registers nothing itself`);
		assert.equal(/^<style[\s>]/m.test(source), false, `${file} has a <style> block`);
		assert.equal(
			/[^&]#[0-9a-fA-F]{3,8}\b/.test(source.replace(/#\{/g, '')),
			false,
			`${file} has a hex color — semantic tokens only`
		);
	}
});

test('the dynamic import is inside mounted()', async () => {
	const source = await readText('../registry/ui/select/Select/Select.pzl');
	const mounted = source.slice(source.indexOf('  mounted()'), source.indexOf('  afterUpdate()'));
	assert.match(mounted, new RegExp(`import\\('${SPECIFIER}'\\)`));
	assert.match(mounted, /typeof window === 'undefined'/);
});

test('no template binds an attribute the component writes', async () => {
	// visible / selected / aria-selected / tabindex / role / aria-disabled /
	// aria-expanded / aria-controls / aria-haspopup / id-on-option are all
	// written by <select-dropdown> on every change; a live binding would fight
	// the patcher, and `value` would land as a PROPERTY (viewManager's PROPS set
	// is name-keyed, not tag-keyed) with no attribute at all.
	const banned = [
		'visible',
		'selected',
		'aria-selected',
		'tabindex',
		'role',
		'aria-disabled',
		'aria-expanded',
		'aria-controls',
		'aria-haspopup',
		'aria-labelledby',
		'value',
	];
	for (const file of VIEWS) {
		const template = templateOf(await readText(`../registry/ui/select/${file}`));
		for (const attr of banned) {
			assert.equal(
				new RegExp(`(^|[\\s"])${attr}\\s*=`, 'm').test(template),
				false,
				`${file} binds \`${attr}\` — that attribute is the component's`
			);
		}
	}
});

test('Select.Option writes its value attribute imperatively', async () => {
	// Puzzle routes `value` through the PROPERTY path for every element
	// (viewManager's PROPS set is name-keyed, not tag-keyed), which would assign
	// el.value and write no attribute — while upstream reads the option's value
	// with getAttribute('value') and silently falls back to the row's text.
	const source = await readText('../registry/ui/select/Select/Option.pzl');
	assert.match(source, /el\.setAttribute\('value', next\)/);
	assert.match(source, /el\.removeAttribute\('value'\)/);
});

test('the root writes the host value through the property, never a template binding', async () => {
	const source = await readText('../registry/ui/select/Select/Select.pzl');
	assert.match(source, /this\.element\.value = value;/);
	assert.match(source, /#syncing = true;/);
});

test('every select-dropdown event listener is target-guarded', async () => {
	const source = await readText('../registry/ui/select/Select/Select.pzl');
	for (const event of [
		'select-dropdown:change',
		'select-dropdown:show',
		'select-dropdown:hide',
	]) {
		assert.ok(source.includes(`'${event}'`), `the root does not listen for ${event}`);
	}
	assert.match(source, /return event\.target === this\.element;/);
	// The bare `change` event carries no detail and is upstream's native-form
	// echo — the family reads select-dropdown:change instead.
	assert.equal(
		/addEventListener\('change'/.test(source),
		false,
		'the root must ignore the bare `change` event'
	);
});

test('the root drives open edge-triggered, never level-triggered, and synchronously', async () => {
	const source = await readText('../registry/ui/select/Select/Select.pzl');
	assert.match(source, /if \(open !== this\.#lastOpen\)/);
	assert.match(source, /if \(value !== this\.#last\)/);
	// Upstream defers its own outside-click listener, so there is nothing left for
	// the wrapper to work around — and an rAF deferral would stall a parent-driven
	// open in a hidden tab.
	assert.equal(
		/requestAnimationFrame/.test(source),
		false,
		'show()/hide() must be called synchronously, like DropdownPanel'
	);
});

test('the trigger uses the D141 stock-chrome fallback body', async () => {
	const template = templateOf(await readText('../registry/ui/select/Select/Select.pzl'));
	assert.match(template, /<Slot name="trigger">/);
	// Upstream captures this text once, at connect, as the cleared / form-reset
	// label — an empty span would make "cleared" render as nothing.
	assert.match(template, /class=\{ labelClass \}>\{ triggerText \}<\/span>/);
	const source = await readText('../registry/ui/select/Select/Select.pzl');
	assert.match(source, /'select-label-text /);
	assert.match(source, /triggerText: label \|\| placeholder/);
});

test('the barrel exports the D167 Object.assign family shape', async () => {
	const source = await readText('../registry/ui/select/Select/index.js');
	assert.match(source, /export \{ Select, Option, Label, Divider \}/);
	assert.match(
		source,
		/export default Object\.assign\(Select, \{ Option, Label, Divider \}\)/
	);
});

test('the demo style entry imports the component stylesheet in the components layer', async () => {
	const styles = await readText('../demo/app/styles/styles.css');
	assert.match(styles, /@import "@magic-spells\/select-dropdown\/css" layer\(components\);/);
});
