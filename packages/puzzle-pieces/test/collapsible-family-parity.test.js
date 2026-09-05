import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The demo's app/components/ui copies are strictly downstream of registry/.
// Both disclosure pieces are DIRECTORIES as of 0.7.0 (D167), so every member
// file and the barrel has to be checked, not just one .pzl.
const FAMILIES = [
	{
		piece: 'collapsible',
		dir: 'Collapsible',
		files: ['Collapsible.pzl', 'Trigger.pzl', 'Content.pzl', 'index.js'],
	},
	{
		piece: 'accordion',
		dir: 'Accordion',
		files: ['Accordion.pzl', 'Item.pzl', 'Trigger.pzl', 'Content.pzl', 'index.js'],
	},
];

for (const family of FAMILIES) {
	test(`registry and demo ${family.piece} family copies stay byte-identical`, async () => {
		for (const file of family.files) {
			const registryPath = `../registry/ui/${family.piece}/${family.dir}/${file}`;
			const demoPath = `../demo/app/components/ui/${family.dir}/${file}`;
			const [registrySource, demoSource] = await Promise.all([
				readFile(new URL(registryPath, import.meta.url)),
				readFile(new URL(demoPath, import.meta.url)),
			]);
			assert.equal(
				Buffer.compare(registrySource, demoSource),
				0,
				`${family.dir}/${file} copy drifted`
			);
		}
	});
}
