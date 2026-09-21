import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the split-text WRAPPER piece. The splitter, the effects,
// the IntersectionObserver trigger and the reduced-motion short-circuit all live
// in @magic-spells/split-text and are tested there. What can regress here is the
// wiring.

const PACKAGE = '@magic-spells/split-text';
// The manifest carries the version FLOOR the wrapper was built against (D169);
// the .pzl still imports the BARE specifier.
const DEP = `${PACKAGE}@^0.2.0`;
const SPECIFIER = PACKAGE.replace('/', '\\/');
const FILE = '../registry/ui/split-text/SplitText.pzl';
const COPY = '../demo/app/components/ui/SplitText.pzl';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

test('the split-text manifest declares its file and dependency', async () => {
	const piece = await readJSON('../registry/ui/split-text/piece.json');
	assert.deepEqual(piece.files, ['SplitText.pzl']);
	assert.deepEqual(piece.registryDependencies, []);
	assert.deepEqual(piece.dependencies, [DEP]);
	assert.equal(piece.targetDir, 'app/components/ui');
	await access(new URL(FILE, import.meta.url));
});

test('registry.json mirrors the split-text manifest', async () => {
	const [piece, registry] = await Promise.all([
		readJSON('../registry/ui/split-text/piece.json'),
		readJSON('../registry/registry.json'),
	]);
	const row = registry.pieces.find((p) => p.name === 'split-text');
	assert.ok(row, 'registry.json has no split-text entry');
	assert.equal(row.description, piece.description);
	assert.deepEqual(row.files, piece.files);
	assert.deepEqual(row.dependencies, piece.dependencies);
	assert.equal(row.targetDir, piece.targetDir);
});

test('the demo copy is byte-identical to the registry source', async () => {
	const [source, copy] = await Promise.all([readText(FILE), readText(COPY)]);
	assert.equal(copy, source, 'demo/app/components/ui/SplitText.pzl has drifted');
});

test('the package is imported dynamically, inside mounted(), and never at module scope', async () => {
	const source = await readText(FILE);
	assert.equal(
		new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${SPECIFIER}['"]`, 'm').test(source),
		false,
		`SplitText.pzl must not import ${PACKAGE} at module scope`
	);
	const mounted = source.slice(source.indexOf('  mounted()'));
	assert.match(mounted, new RegExp(`import\\('${SPECIFIER}'\\)`));
	assert.match(mounted, /typeof window === 'undefined'/);
	assert.equal(source.includes('customElements'), false, 'the piece registers nothing itself');
	assert.equal(/^<style[\s>]/m.test(source), false, 'the piece has a <style> block');
	assert.equal(
		/[^&]#[0-9a-fA-F]{3,8}\b/.test(source.replace(/#\{/g, '')),
		false,
		'the piece has a hex color — semantic tokens only'
	);
});

test('the host binds no style attribute', async () => {
	// The element writes --split-text-delay / -stagger / -duration / -easing into
	// its own inline style at every split. A bound `style` is rewritten wholesale
	// by the patcher and would drop them on the next unrelated render.
	const template = (await readText(FILE)).split('<script>')[0];
	assert.equal(
		/(^|[\s"])style\s*=/m.test(template),
		false,
		'SplitText binds `style` — that attribute is the component\'s'
	);
	// Same reason, one level up: the element fills in aria-label itself and only
	// when it is absent, so a bound one would go stale.
	assert.equal(/(^|[\s"])aria-label\s*=/m.test(template), false, 'SplitText binds `aria-label`');
});

test('replay is an edge-triggered token, not a level-triggered prop', async () => {
	const source = await readText(FILE);
	const after = source.slice(source.indexOf('  afterUpdate()'));
	assert.match(after, /if \(play === this\.#lastPlay\) return;/);
	// `play` is the piece's own state, never an attribute on the element.
	const template = source.split('<script>')[0];
	assert.equal(/(^|[\s"])play\s*=/m.test(template), false, 'SplitText renders `play` as an attribute');
	// manual has no trigger to re-arm, so the token has to do the firing.
	assert.match(source, /reveal\?\.\(\)/);
	assert.match(source, /split\?\.\(\)/);
});

test('the demo style entry imports the component stylesheet in the components layer', async () => {
	const styles = await readText('../demo/app/styles/styles.css');
	assert.match(styles, /@import "@magic-spells\/split-text\/css" layer\(components\);/);
});
