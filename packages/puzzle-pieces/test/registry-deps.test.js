import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// D169 — every registry `dependencies` entry is an npm install spec carrying a
// semver FLOOR: "@magic-spells/collapsible-content@^1.2.0". `puzzle add piece`
// prints that spec verbatim, so a bare name would resolve to npm LATEST — the
// 0.7.0 bug where `add piece accordion` installed collapsible-content 1.1.1,
// which has no <collapsible-group>, and the accordion silently lost
// exclusivity. The CLI still ACCEPTS a bare name (third-party registries), but
// nothing in THIS registry may ship one.
//
// The floors are also the version the piece was actually built and demoed
// against, so this file pins them against demo/package.json: the demo is what
// exercises the wrappers, and a floor above what the demo installs would be a
// claim nothing has tested.

const readJSON = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

// The last @ separates, so a scoped package keeps its leading one.
const splitSpec = (spec) => {
	const at = spec.lastIndexOf('@');
	return at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, ''];
};

const manifests = async () => {
	const dir = new URL('../registry/ui/', import.meta.url);
	const names = (await readdir(dir, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	return Promise.all(
		names.map(async (name) => [name, await readJSON(`../registry/ui/${name}/piece.json`)])
	);
};

test('every piece.json dependency carries a version floor', async () => {
	const bare = [];
	for (const [name, piece] of await manifests()) {
		for (const spec of piece.dependencies ?? []) {
			const [pkg, range] = splitSpec(spec);
			if (range === '') bare.push(`${name} → ${pkg}`);
		}
	}
	assert.deepEqual(
		bare,
		[],
		`these dependencies have no floor and would resolve to npm latest:\n  ${bare.join('\n  ')}`
	);
});

test('a package has one floor across the whole registry', async () => {
	const floors = new Map();
	for (const [name, piece] of await manifests()) {
		for (const spec of piece.dependencies ?? []) {
			const [pkg, range] = splitSpec(spec);
			const seen = floors.get(pkg);
			if (seen && seen.range !== range) {
				assert.fail(
					`${pkg} is pinned at ${seen.range} by ${seen.piece} and ${range} by ${name} — ` +
						'the CLI would print the higher floor; make them agree instead'
				);
			}
			floors.set(pkg, { range, piece: name });
		}
	}
	assert.ok(floors.size > 0, 'no dependencies found — the manifests did not load');
});

test('every floor matches what the demo installs', async () => {
	const demo = await readJSON('../demo/package.json');
	for (const [name, piece] of await manifests()) {
		for (const spec of piece.dependencies ?? []) {
			const [pkg, range] = splitSpec(spec);
			const installed = demo.dependencies[pkg];
			assert.ok(installed, `${name} depends on ${pkg}, which demo/package.json does not install`);
			// tiptap is pinned exact in the demo; the registry floor is the
			// caret form of the same version.
			assert.equal(
				range.replace(/^\^/, ''),
				installed.replace(/^\^/, ''),
				`${name}: ${pkg} floor ${range} disagrees with demo/package.json ${installed}`
			);
		}
	}
});

test('registry.json mirrors every manifest, including the floors', async () => {
	const index = await readJSON('../registry/registry.json');
	const rows = new Map(index.pieces.map((p) => [p.name, p]));
	const all = await manifests();
	assert.equal(rows.size, all.length, 'registry.json and registry/ui/ disagree on the piece count');
	for (const [name, piece] of all) {
		const row = rows.get(piece.name);
		assert.ok(row, `registry.json has no ${piece.name} entry`);
		assert.equal(piece.name, name, `${name}/piece.json names itself ${piece.name}`);
		assert.equal(row.description, piece.description);
		assert.deepEqual(row.files, piece.files);
		assert.deepEqual(row.registryDependencies, piece.registryDependencies);
		assert.deepEqual(row.dependencies, piece.dependencies);
		assert.equal(row.targetDir, piece.targetDir);
	}
});
