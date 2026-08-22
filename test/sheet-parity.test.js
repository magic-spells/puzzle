import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const copies = [
	['Sheet.pzl', '../registry/ui/sheet/Sheet.pzl', '../demo/app/components/ui/Sheet.pzl'],
	['sheet-math.js', '../registry/lib/sheet-math.js', '../demo/app/lib/sheet-math.js'],
	[
		'BottomSheet.pzl',
		'../registry/ui/bottom-sheet/BottomSheet.pzl',
		'../demo/app/components/ui/BottomSheet.pzl',
	],
];

test('registry and demo Sheet dependencies stay byte-identical', async () => {
	for (const [name, registryPath, demoPath] of copies) {
		const [registrySource, demoSource] = await Promise.all([
			readFile(new URL(registryPath, import.meta.url)),
			readFile(new URL(demoPath, import.meta.url)),
		]);
		assert.equal(Buffer.compare(registrySource, demoSource), 0, `${name} copy drifted`);
	}
});
