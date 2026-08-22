import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static guards for the `sheet` WRAPPER piece. There is nothing left to unit
// test in this repo — the motion, the gestures and the snap policy all live in
// @magic-spells/sheet now and are tested there. What can still regress here is
// the wiring: the declared dependencies, the manifest/index agreement, and the
// two prerender rules a wrapper piece has to keep (no top-level import of a
// package that defines custom elements at module scope, and no customElements
// touch of its own).

const readJSON = async (path) =>
	JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

const PACKAGES = ['@magic-spells/sheet', '@magic-spells/dialog-panel'];

test('the sheet piece declares both npm packages and no registry dependencies', async () => {
	const piece = await readJSON('../registry/ui/sheet/piece.json');

	assert.deepEqual(piece.files, ['Sheet.pzl']);
	assert.deepEqual(piece.registryDependencies, []);
	for (const pkg of PACKAGES) {
		assert.ok(
			piece.dependencies.includes(pkg),
			`piece.json must declare ${pkg} — dialog-panel is a peer that yarn 1 will not install on its own`
		);
	}
});

test('registry.json mirrors the sheet manifest', async () => {
	const [piece, registry] = await Promise.all([
		readJSON('../registry/ui/sheet/piece.json'),
		readJSON('../registry/registry.json'),
	]);
	const entry = registry.pieces.find((row) => row.name === 'sheet');

	assert.ok(entry, 'registry.json has no sheet entry');
	assert.equal(entry.description, piece.description);
	assert.deepEqual(entry.files, piece.files);
	assert.deepEqual(entry.registryDependencies, piece.registryDependencies);
	assert.deepEqual(entry.dependencies, piece.dependencies);
	assert.equal(entry.targetDir, piece.targetDir);
});

test('Sheet.pzl loads the package lazily and never touches customElements', async () => {
	const source = await readFile(
		new URL('../registry/ui/sheet/Sheet.pzl', import.meta.url),
		'utf8'
	);

	// A top-level `import … from '@magic-spells/sheet'` evaluates
	// `class extends HTMLElement` under Node and takes the whole prerender pass
	// down with a ReferenceError.
	assert.equal(
		/^\s*import(?!\s*\()[^\n]*['"]@magic-spells\/sheet['"]/m.test(source),
		false,
		'Sheet.pzl must not import @magic-spells/sheet at module scope'
	);
	assert.ok(
		/import\(\s*['"]@magic-spells\/sheet['"]\s*\)/.test(source),
		'Sheet.pzl must load @magic-spells/sheet with a dynamic import()'
	);
	assert.equal(
		source.includes('customElements'),
		false,
		'a wrapper piece registers nothing itself'
	);
	// Ported pieces and wrappers alike: no stylesheet block, no hex colors.
	assert.equal(/^<style[\s>]/m.test(source), false, 'no <style> block');
	assert.equal(
		/[^&]#[0-9a-fA-F]{3,8}\b/.test(source.replace(/#\{/g, '')),
		false,
		'no hex colors — semantic tokens only'
	);
});
