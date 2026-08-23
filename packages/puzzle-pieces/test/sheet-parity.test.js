import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const copies = [
	['Sheet.pzl', '../registry/ui/sheet/Sheet.pzl', '../demo/app/components/ui/Sheet.pzl'],
	[
		'BottomSheet.pzl',
		'../registry/ui/bottom-sheet/BottomSheet.pzl',
		'../demo/app/components/ui/BottomSheet.pzl',
	],
	['Dialog.pzl', '../registry/ui/dialog/Dialog.pzl', '../demo/app/components/ui/Dialog.pzl'],
	[
		'AlertDialog.pzl',
		'../registry/ui/alert-dialog/AlertDialog.pzl',
		'../demo/app/components/ui/AlertDialog.pzl',
	],
];

test('registry and demo overlay-wrapper copies stay byte-identical', async () => {
	for (const [name, registryPath, demoPath] of copies) {
		const [registrySource, demoSource] = await Promise.all([
			readFile(new URL(registryPath, import.meta.url)),
			readFile(new URL(demoPath, import.meta.url)),
		]);
		assert.equal(Buffer.compare(registrySource, demoSource), 0, `${name} copy drifted`);
	}
});
