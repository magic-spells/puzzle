import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The demo's app/components/ui copies are strictly downstream of registry/.
// `select` became a DIRECTORY family in 0.7.0 (D167), so every member file and
// the barrel has to be checked, not just one .pzl. `marquee` and
// `quantity-input` stayed single files and ride along here.
const FAMILY = {
	piece: 'select',
	dir: 'Select',
	files: ['Select.pzl', 'Option.pzl', 'Label.pzl', 'Divider.pzl', 'index.js'],
};

const SINGLES = [
	['marquee', 'Marquee.pzl'],
	['quantity-input', 'QuantityInput.pzl'],
];

const same = async (registryPath, demoPath, label) => {
	const [registrySource, demoSource] = await Promise.all([
		readFile(new URL(registryPath, import.meta.url)),
		readFile(new URL(demoPath, import.meta.url)),
	]);
	assert.equal(Buffer.compare(registrySource, demoSource), 0, `${label} copy drifted`);
};

test('registry and demo select family copies stay byte-identical', async () => {
	for (const file of FAMILY.files) {
		await same(
			`../registry/ui/${FAMILY.piece}/${FAMILY.dir}/${file}`,
			`../demo/app/components/ui/${FAMILY.dir}/${file}`,
			`${FAMILY.dir}/${file}`
		);
	}
});

for (const [piece, file] of SINGLES) {
	test(`registry and demo ${piece} copies stay byte-identical`, async () => {
		await same(`../registry/ui/${piece}/${file}`, `../demo/app/components/ui/${file}`, file);
	});
}

test('the flat Select.pzl is gone from both trees', async () => {
	for (const path of ['../registry/ui/select/Select.pzl', '../demo/app/components/ui/Select.pzl']) {
		await assert.rejects(
			readFile(new URL(path, import.meta.url)),
			/ENOENT/,
			`${path} still exists — the single-file Select was replaced by the family`
		);
	}
});
