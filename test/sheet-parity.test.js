import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const copies = [
	['Sheet.pzl', '../registry/ui/sheet/Sheet.pzl', '../demo/app/components/ui/Sheet.pzl'],
	['sheet-engine.js', '../registry/lib/sheet-engine.js', '../demo/app/lib/sheet-engine.js'],
	['sheet-policy.js', '../registry/lib/sheet-policy.js', '../demo/app/lib/sheet-policy.js'],
	['sheet-math.js', '../registry/lib/sheet-math.js', '../demo/app/lib/sheet-math.js'],
	['sheet-drag.js', '../registry/lib/sheet-drag.js', '../demo/app/lib/sheet-drag.js'],
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
