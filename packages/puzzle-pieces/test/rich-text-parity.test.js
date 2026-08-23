import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const copies = [
	['RichText.pzl', '../registry/ui/rich-text/RichText.pzl', '../demo/app/components/ui/RichText.pzl'],
	[
		'RichTextEditor.pzl',
		'../registry/ui/rich-text-editor/RichTextEditor.pzl',
		'../demo/app/components/ui/RichTextEditor.pzl',
	],
	['rich-text-doc.js', '../registry/lib/rich-text-doc.js', '../demo/app/lib/rich-text-doc.js'],
];

test('registry and demo rich text files stay byte-identical', async () => {
	for (const [name, registryPath, demoPath] of copies) {
		const [registrySource, demoSource] = await Promise.all([
			readFile(new URL(registryPath, import.meta.url)),
			readFile(new URL(demoPath, import.meta.url)),
		]);
		assert.equal(Buffer.compare(registrySource, demoSource), 0, `${name} copy drifted`);
	}
});
