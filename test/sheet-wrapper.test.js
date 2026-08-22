import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static guards for the overlay WRAPPER pieces — `sheet` and `bottom-sheet`.
// There is nothing left to unit test in this repo for either: the motion, the
// gestures and the snap policy all live in @magic-spells/sheet and
// @magic-spells/bottom-sheet now and are tested there. What can still regress
// here is the wiring: the declared dependencies, the manifest/index agreement,
// and the two prerender rules a wrapper piece has to keep (no top-level import
// of a package that defines custom elements at module scope, and no
// customElements touch of its own).

const readJSON = async (path) =>
	JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

// Every wrapper here also declares @magic-spells/dialog-panel: it is a PEER of
// the package being wrapped, and yarn 1 will not install it on its own.
const WRAPPERS = [
	{
		piece: 'sheet',
		file: 'Sheet.pzl',
		manifest: '../registry/ui/sheet/piece.json',
		source: '../registry/ui/sheet/Sheet.pzl',
		package: '@magic-spells/sheet',
	},
	{
		piece: 'bottom-sheet',
		file: 'BottomSheet.pzl',
		manifest: '../registry/ui/bottom-sheet/piece.json',
		source: '../registry/ui/bottom-sheet/BottomSheet.pzl',
		package: '@magic-spells/bottom-sheet',
	},
];

for (const wrapper of WRAPPERS) {
	test(`the ${wrapper.piece} piece declares both npm packages and no registry dependencies`, async () => {
		const piece = await readJSON(wrapper.manifest);

		assert.deepEqual(piece.files, [wrapper.file]);
		assert.deepEqual(piece.registryDependencies, []);
		for (const pkg of [wrapper.package, '@magic-spells/dialog-panel']) {
			assert.ok(
				piece.dependencies.includes(pkg),
				`piece.json must declare ${pkg} — dialog-panel is a peer that yarn 1 will not install on its own`
			);
		}
	});

	test(`registry.json mirrors the ${wrapper.piece} manifest`, async () => {
		const [piece, registry] = await Promise.all([
			readJSON(wrapper.manifest),
			readJSON('../registry/registry.json'),
		]);
		const entry = registry.pieces.find((row) => row.name === wrapper.piece);

		assert.ok(entry, `registry.json has no ${wrapper.piece} entry`);
		assert.equal(entry.description, piece.description);
		assert.deepEqual(entry.files, piece.files);
		assert.deepEqual(entry.registryDependencies, piece.registryDependencies);
		assert.deepEqual(entry.dependencies, piece.dependencies);
		assert.equal(entry.targetDir, piece.targetDir);
	});

	test(`${wrapper.file} loads the package lazily and never touches customElements`, async () => {
		const source = await readFile(new URL(wrapper.source, import.meta.url), 'utf8');
		const specifier = wrapper.package.replace('/', '\\/');

		// A top-level `import … from '<package>'` evaluates
		// `class extends HTMLElement` under Node and takes the whole prerender
		// pass down with a ReferenceError.
		assert.equal(
			new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${specifier}['"]`, 'm').test(source),
			false,
			`${wrapper.file} must not import ${wrapper.package} at module scope`
		);
		assert.ok(
			new RegExp(`import\\(\\s*['"]${specifier}['"]\\s*\\)`).test(source),
			`${wrapper.file} must load ${wrapper.package} with a dynamic import()`
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
}
