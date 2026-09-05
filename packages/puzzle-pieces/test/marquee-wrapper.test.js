import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the scrolling-content WRAPPER piece. The rAF loop, the
// seamless wrap, the clone accounting, pause-on-hover and drag-to-scrub all live
// in @magic-spells/scrolling-content and are tested there. What can regress here
// is the wiring.

const PACKAGE = '@magic-spells/scrolling-content';
const SPECIFIER = PACKAGE.replace('/', '\\/');
const FILE = '../registry/ui/marquee/Marquee.pzl';

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

test('the marquee manifest declares its file and dependency', async () => {
	const piece = await readJSON('../registry/ui/marquee/piece.json');
	assert.deepEqual(piece.files, ['Marquee.pzl']);
	assert.deepEqual(piece.registryDependencies, []);
	assert.deepEqual(piece.dependencies, [PACKAGE]);
	assert.equal(piece.targetDir, 'app/components/ui');
	await access(new URL(FILE, import.meta.url));
});

test('registry.json mirrors the marquee manifest', async () => {
	const [piece, registry] = await Promise.all([
		readJSON('../registry/ui/marquee/piece.json'),
		readJSON('../registry/registry.json'),
	]);
	const row = registry.pieces.find((p) => p.name === 'marquee');
	assert.ok(row, 'registry.json has no marquee entry');
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
		`Marquee.pzl must not import ${PACKAGE} at module scope`
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

test('the track and the item are pre-authored, so the component adopts instead of moving', async () => {
	const template = (await readText(FILE)).split('<script>')[0];
	assert.match(
		template,
		/<scrolling-track><scrolling-item><Children\/><\/scrolling-item><\/scrolling-track>/,
		'the host must contain <scrolling-track><scrolling-item> at connect time, or upstream generates a second track'
	);
});

test('no template binds a reflected attribute', async () => {
	// `paused` and `dragging` are written BY the component (start()/stop(), the
	// hover gate, the drag) — a binding would fight the patcher every render.
	const template = (await readText(FILE)).split('<script>')[0];
	for (const attr of ['paused', 'dragging']) {
		assert.equal(
			new RegExp(`(^|[\\s"])${attr}\\s*=`, 'm').test(template),
			false,
			`Marquee binds \`${attr}\` — that attribute is the component's`
		);
	}
});

test('vertical direction is gone', async () => {
	const source = await readText(FILE);
	assert.match(source, /props\.direction === 'right' \? 'right' : 'left'/);
	assert.equal(
		/'up'|'down'/.test(source),
		false,
		"the wrapper must not reintroduce a vertical mode — upstream is horizontal"
	);
});

test('the demo style entry imports the component stylesheet in the components layer', async () => {
	const styles = await readText('../demo/app/styles/styles.css');
	assert.match(styles, /@import "@magic-spells\/scrolling-content\/css" layer\(components\);/);
});
