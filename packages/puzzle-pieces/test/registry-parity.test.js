import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The demo's copies are strictly downstream of registry/: every file a piece
// manifest lists, and every lib helper, must match its demo copy byte for byte,
// or the docs site shows a piece `puzzle add piece` does not install.
const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const { pieces } = JSON.parse(read('registry/registry.json'));
const pairs = [
	...pieces.flatMap(({ name, files, targetDir }) =>
		files.map((file) => [`registry/ui/${name}/${file}`, `demo/${targetDir}/${file}`])
	),
	...readdirSync(new URL('registry/lib/', root))
		.filter((file) => file.endsWith('.js'))
		.map((file) => [`registry/lib/${file}`, `demo/app/lib/${file}`]),
];

test('every registry file is byte-identical to its demo copy', () => {
	assert.deepEqual(pairs.filter(([source, copy]) => !read(source).equals(read(copy))), []);
});
