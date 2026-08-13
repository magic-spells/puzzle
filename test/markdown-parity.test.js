import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const copies = [
	['Markdown.pzl', '../registry/ui/markdown/Markdown.pzl', '../demo/app/components/ui/Markdown.pzl'],
	[
		'MarkdownEditor.pzl',
		'../registry/ui/markdown-editor/MarkdownEditor.pzl',
		'../demo/app/components/ui/MarkdownEditor.pzl',
	],
	['markdown-doc.js', '../registry/lib/markdown-doc.js', '../demo/app/lib/markdown-doc.js'],
];

test('registry and demo markdown files stay byte-identical', async () => {
	for (const [name, registryPath, demoPath] of copies) {
		const [registrySource, demoSource] = await Promise.all([
			readFile(new URL(registryPath, import.meta.url)),
			readFile(new URL(demoPath, import.meta.url)),
		]);
		assert.equal(Buffer.compare(registrySource, demoSource), 0, `${name} copy drifted`);
	}
});
