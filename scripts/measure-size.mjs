#!/usr/bin/env node
// Canonical bundle-size benchmark (`npm run measure:size`).
//
// Builds the two reference apps in production and reports dist/app.js size.
// These are the ONLY numbers the README banner may cite:
//
//   - examples/hello-world — the minimal one-route floor app
//   - examples/todos       — the canonical full example
//
// `--check` additionally asserts README.md still contains both formatted
// gzip figures, so a release cannot ship a stale banner (the 18.3 KB claim
// survived four releases; this is the guard against a fifth).
//
// Sizes use KiB (bytes / 1024, one decimal) to match the CLI's build output,
// and gzip is Node zlib level 9 — one canonical compressor, always comparable
// run to run. Node builtins only.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

// Every emitted script under dist/, sorted so the concatenation below is stable
// run to run. Source maps are excluded — they are never shipped to users. An app
// built with `build: { splitting: true }` emits lazy chunks beside app.js, and
// those bytes count toward what it costs to run the app.
function distScripts(dist) {
	return readdirSync(dist, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile() && e.name.endsWith('.js'))
		.map((e) => join(e.parentPath ?? e.path, e.name))
		.sort();
}

const APPS = [
	{ name: 'hello-world', dir: 'examples/hello-world' },
	{ name: 'todos', dir: 'examples/todos' },
];

const kib = (bytes) => (bytes / 1024).toFixed(1);

const results = [];
for (const app of APPS) {
	execFileSync(
		'go',
		['run', './compiler/cmd/puzzle', 'build', app.dir, '--mode', 'production'],
		{ cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] }
	);
	// Sum EVERY emitted script, not just app.js: a split app's weight is app.js
	// plus its lazy chunks, and a figure that counted only the entry would report
	// splitting as a free win. Concatenating before compressing is the honest
	// single number — the bytes a user has downloaded once every chunk is in.
	const js = Buffer.concat(distScripts(join(repoRoot, app.dir, 'dist')).map((p) => readFileSync(p)));
	results.push({
		name: app.name,
		raw: js.length,
		gzip: gzipSync(js, { level: 9 }).length,
		brotli: brotliCompressSync(js, {
			params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
		}).length,
	});
}

console.log('\napp          raw          gzip -9      brotli -q11');
for (const r of results) {
	console.log(
		`${r.name.padEnd(12)} ${String(r.raw).padStart(6)} bytes ${kib(r.raw).padStart(5)} KB   ` +
			`${String(r.gzip).padStart(6)} → ${kib(r.gzip)} KB   ${String(r.brotli).padStart(6)} → ${kib(r.brotli)} KB`
	);
}
console.log('\nREADME banner figures (gzip, KiB):');
for (const r of results) console.log(`  ${r.name}: ${kib(r.gzip)} KB`);

if (check) {
	const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
	const missing = results.filter((r) => !readme.includes(`${kib(r.gzip)} KB`));
	if (missing.length) {
		console.error(
			`\nmeasure-size --check: README.md does not contain the current ` +
				`figure${missing.length > 1 ? 's' : ''} for ${missing
					.map((r) => `${r.name} (${kib(r.gzip)} KB gzip)`)
					.join(', ')}. Update the size banner before releasing.`
		);
		process.exit(1);
	}
	console.log('\nmeasure-size --check: README banner matches the measured sizes.');
}
