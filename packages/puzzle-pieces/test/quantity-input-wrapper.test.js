import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the quantity-input WRAPPER piece. The clamping, the
// stepping, the Enter-key swallow, the empty/NaN snap-back and the disabled
// bookkeeping live in @magic-spells/quantity-input and are tested there.

const PACKAGE = '@magic-spells/quantity-input';
const SPECIFIER = PACKAGE.replace('/', '\\/');
const FILE = '../registry/ui/quantity-input/QuantityInput.pzl';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

test('the quantity-input manifest declares its file and dependency', async () => {
	const piece = await readJSON('../registry/ui/quantity-input/piece.json');
	assert.deepEqual(piece.files, ['QuantityInput.pzl']);
	assert.deepEqual(piece.registryDependencies, []);
	assert.deepEqual(piece.dependencies, [PACKAGE]);
	assert.equal(piece.targetDir, 'app/components/ui');
	await access(new URL(FILE, import.meta.url));
});

test('registry.json mirrors the quantity-input manifest', async () => {
	const [piece, registry] = await Promise.all([
		readJSON('../registry/ui/quantity-input/piece.json'),
		readJSON('../registry/registry.json'),
	]);
	const row = registry.pieces.find((p) => p.name === 'quantity-input');
	assert.ok(row, 'registry.json has no quantity-input entry');
	assert.equal(row.description, piece.description);
	assert.deepEqual(row.files, piece.files);
	assert.deepEqual(row.dependencies, piece.dependencies);
	assert.equal(row.targetDir, piece.targetDir);
});

test('the package is imported dynamically, inside mounted(), and never at module scope', async () => {
	const source = await readText(FILE);
	assert.equal(
		new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${SPECIFIER}['"]`, 'm').test(source),
		false,
		`QuantityInput.pzl must not import ${PACKAGE} at module scope`
	);
	const mounted = source.slice(source.indexOf('  mounted()'), source.indexOf('  afterUpdate()'));
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

test('the three controls the component adopts are authored here', async () => {
	const template = (await readText(FILE)).split('<script>')[0];
	// connectedCallback resolves them with querySelector — it creates nothing.
	assert.match(template, /data-action-decrement/);
	assert.match(template, /data-action-increment/);
	assert.match(template, /<input\b/);
});

test('the host `value` attribute is never template-bound', async () => {
	const template = (await readText(FILE)).split('<script>')[0];
	const host = template.slice(template.indexOf('<quantity-input'), template.indexOf('>'));
	assert.equal(
		/\bvalue\s*=/.test(host),
		false,
		'<quantity-input> OBSERVES and REFLECTS `value` — a live binding would fight the patcher'
	);
	const source = await readText(FILE);
	assert.match(source, /el\.setAttribute\('value', String\(Math\.trunc\(value\)\)\)/);
	assert.match(source, /if \(el\.value !== value\) el\.value = value;/);
});

test('the field value is the live clamped prop, wrapped in a non-path expression (D147)', async () => {
	const source = await readText(FILE);
	const template = source.split('<script>')[0];
	// Puzzle force-syncs `value` on an <input> against the LIVE DOM property on
	// every patch, so a FROZEN seed would be re-asserted after every render and
	// revert what the component just wrote. String() keeps the expression off the
	// `ident` / `ident.ident` shape the compiler auto-binds; a synthesized bind
	// would write into this piece's LOCAL state and be reverted by the next data()
	// commit.
	assert.match(template, /value=\{ String\(current\) \}/);
	assert.match(source, /current: value,/);
	assert.equal(/#seed/.test(source), false, 'the frozen seed is gone — see the header');
});

test('quantity-input:change is target-guarded and reported value-first', async () => {
	const source = await readText(FILE);
	assert.match(source, /addEventListener\('quantity-input:change'/);
	assert.match(source, /if \(event\.target !== this\.element\) return;/);
	assert.match(source, /this\.props\.change\?\.\(value\)/);
});

test('the piece imports no stylesheet of the component', async () => {
	const styles = await readText('../demo/app/styles/styles.css');
	assert.equal(
		/@import[^\n]*@magic-spells\/quantity-input/.test(styles),
		false,
		'quantity-input/styles ships hex colors and fixed sizing — the piece uses tokens instead'
	);
	const source = await readText(FILE);
	assert.equal(
		/import\s*\(?\s*['"][^'"]*quantity-input\/styles/.test(source),
		false,
		'the piece must not import the component stylesheet'
	);
});

test('zero survives every parse in data()', async () => {
	const source = await readText(FILE);
	// `parseInt(x) || 1` is exactly the bug upstream 1.1.0 fixed; Number.isFinite
	// is the shape that lets min={ 0 } and value={ 0 } round-trip.
	assert.match(source, /Number\.isFinite\(v\) \? Math\.trunc\(v\) : fallback/);
	assert.equal(/\|\| 1\b/.test(source), false, 'a `|| 1` fallback would swallow zero');
});
