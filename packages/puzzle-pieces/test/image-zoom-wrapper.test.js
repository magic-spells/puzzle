import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the image-zoom WRAPPER piece. The gesture state machine,
// the rubber band, the translate clamping and the double-tap discriminator all
// live in @magic-spells/image-zoom and are tested there. What can regress here
// is the wiring.

const PACKAGE = '@magic-spells/image-zoom';
// The manifest carries the version FLOOR the wrapper was built against (D169);
// the .pzl still imports the BARE specifier.
const DEP = `${PACKAGE}@^0.1.0`;
const SPECIFIER = PACKAGE.replace('/', '\\/');
const FILE = '../registry/ui/image-zoom/ImageZoom.pzl';
const COPY = '../demo/app/components/ui/ImageZoom.pzl';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

test('the image-zoom manifest declares its file and dependency', async () => {
	const piece = await readJSON('../registry/ui/image-zoom/piece.json');
	assert.deepEqual(piece.files, ['ImageZoom.pzl']);
	assert.deepEqual(piece.registryDependencies, []);
	assert.deepEqual(piece.dependencies, [DEP]);
	assert.equal(piece.targetDir, 'app/components/ui');
	await access(new URL(FILE, import.meta.url));
});

test('registry.json mirrors the image-zoom manifest', async () => {
	const [piece, registry] = await Promise.all([
		readJSON('../registry/ui/image-zoom/piece.json'),
		readJSON('../registry/registry.json'),
	]);
	const row = registry.pieces.find((p) => p.name === 'image-zoom');
	assert.ok(row, 'registry.json has no image-zoom entry');
	assert.equal(row.description, piece.description);
	assert.deepEqual(row.files, piece.files);
	assert.deepEqual(row.dependencies, piece.dependencies);
	assert.equal(row.targetDir, piece.targetDir);
});

test('the demo copy is byte-identical to the registry source', async () => {
	const [source, copy] = await Promise.all([readText(FILE), readText(COPY)]);
	assert.equal(copy, source, 'demo/app/components/ui/ImageZoom.pzl has drifted from the registry');
});

test('the package is imported dynamically, inside mounted(), and never at module scope', async () => {
	const source = await readText(FILE);
	assert.equal(
		new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${SPECIFIER}['"]`, 'm').test(source),
		false,
		`ImageZoom.pzl must not import ${PACKAGE} at module scope`
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

test('the image is piece-owned, a direct child, and carries no style binding', async () => {
	const template = (await readText(FILE)).split('<script>')[0];
	// connectedCallback runs querySelector('img') ONCE and caches the element,
	// so the <img> must be written here rather than slotted, and it must not be
	// behind a conditional.
	assert.match(template, /<img ref="image" src=\{ src \} alt=\{ alt \}/);
	assert.equal(template.includes('<Slot'), false, 'the image must not be slotted');
	assert.equal(template.includes('<Children'), false, 'the image must not be slotted');
	assert.equal(/\{#if/.test(template), false, 'the <img> must exist unconditionally at connect');
	// The component writes the pan/zoom transform into the image's inline
	// style every frame; a binding would let the patcher rewrite it away.
	assert.equal(
		/<img[^>]*\sstyle=/.test(template),
		false,
		'ImageZoom binds style on the <img> — that attribute is the component\'s'
	);
});

test('no template binds an attribute the component reflects', async () => {
	// `zoomed`, `gesturing` and `transitioning` are written BY the component —
	// a binding would fight the patcher on every render.
	const template = (await readText(FILE)).split('<script>')[0];
	for (const attr of ['zoomed', 'gesturing', 'transitioning']) {
		assert.equal(
			new RegExp(`(^|[\\s"])${attr}\\s*=`, 'm').test(template),
			false,
			`ImageZoom binds \`${attr}\` — that attribute is the component's`
		);
	}
});

test('the callbacks are value-first and there is no controlled scale prop', async () => {
	const source = await readText(FILE);
	assert.match(source, /this\.props\.change\?\.\(value, \{ translateX, translateY \}\)/);
	assert.match(source, /this\.props\.zoomStart\?\.\(event\.detail\?\.scale\)/);
	assert.match(source, /this\.props\.zoomEnd\?\.\(event\.detail\?\.scale\)/);
	assert.match(source, /this\.props\.ready\?\.\(this\.#host\)/);
	// Zoom is the element's for the whole duration of a gesture — a bound
	// `scale` prop would fight every pinch frame the patcher rendered through.
	assert.equal(
		/props\.scale\b/.test(source),
		false,
		'ImageZoom must not take a controlled scale prop'
	);
});

test('a src change re-attaches the host so the component re-measures', async () => {
	const source = await readText(FILE);
	const afterUpdate = source.slice(source.indexOf('  afterUpdate()'));
	assert.match(afterUpdate, /parent\.removeChild\(this\.#host\)/);
	assert.match(afterUpdate, /parent\.insertBefore\(this\.#host, next\)/);
	// Edge-triggered: a render that carries the same src must not re-attach.
	assert.match(afterUpdate, /if \(src === this\.#lastSrc\) return;/);
});

test('the demo style entry imports the component stylesheet in the components layer', async () => {
	const styles = await readText('../demo/app/styles/styles.css');
	assert.match(styles, /@import "@magic-spells\/image-zoom\/css" layer\(components\);/);
});
