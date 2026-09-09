import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static guards for the overlay WRAPPER pieces — `sheet`, `bottom-sheet`,
// `dialog` and `alert-dialog`. There is nothing left to unit test in this repo
// for any of them: the motion, the gestures, the snap policy and the
// open/close state machine all live in @magic-spells/sheet,
// @magic-spells/bottom-sheet and @magic-spells/dialog-panel now, and are
// tested there. What can still regress here is the wiring: the declared
// dependencies, the manifest/index agreement, and the two prerender rules a
// wrapper piece has to keep (no top-level import of a package that defines
// custom elements at module scope, and no customElements touch of its own).

const readJSON = async (path) =>
	JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

// Every wrapper here also declares @magic-spells/dialog-panel: the two sheets
// wrap a package that only PEERs on it, and yarn 1 will not install a peer on
// its own; the two dialogs wrap dialog-panel itself.
const DIALOG_PANEL = '@magic-spells/dialog-panel';
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
	{
		piece: 'dialog',
		file: 'Dialog.pzl',
		manifest: '../registry/ui/dialog/piece.json',
		source: '../registry/ui/dialog/Dialog.pzl',
		package: DIALOG_PANEL,
	},
	{
		piece: 'alert-dialog',
		file: 'AlertDialog.pzl',
		manifest: '../registry/ui/alert-dialog/piece.json',
		source: '../registry/ui/alert-dialog/AlertDialog.pzl',
		package: DIALOG_PANEL,
	},
];

for (const wrapper of WRAPPERS) {
	test(`the ${wrapper.piece} piece declares its npm packages and no registry dependencies`, async () => {
		const piece = await readJSON(wrapper.manifest);

		assert.deepEqual(piece.files, [wrapper.file]);
		assert.deepEqual(piece.registryDependencies, []);
		for (const pkg of new Set([wrapper.package, DIALOG_PANEL])) {
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
