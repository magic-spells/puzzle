import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const copies = [
	['Sidebar.pzl', '../registry/ui/sidebar/Sidebar.pzl', '../demo/app/components/ui/Sidebar.pzl'],
	['AppearancePicker.pzl', '../registry/ui/appearance-picker/AppearancePicker.pzl', '../demo/app/components/ui/AppearancePicker.pzl'],
];

test('registry and demo Sidebar / AppearancePicker copies stay byte-identical', async () => {
	for (const [name, registryPath, demoPath] of copies) {
		const [registrySource, demoSource] = await Promise.all([
			readFile(new URL(registryPath, import.meta.url)),
			readFile(new URL(demoPath, import.meta.url)),
		]);
		assert.equal(Buffer.compare(registrySource, demoSource), 0, `${name} copy drifted`);
	}
});
