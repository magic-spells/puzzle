#!/usr/bin/env node
/**
 * serve-fixture.mjs — serve test/fixture-page over http.
 *
 *   node scripts/serve-fixture.mjs [--port 5177]
 *
 * The fixture must be served over http, not opened as a file:// URL: content
 * scripts are not injected into file:// pages unless the user grants "Allow
 * access to file URLs", so file:// would silently show "no hook".
 *
 * Dependency-free on purpose (node:http only) — `npx serve test/fixture-page`
 * works identically if you prefer it.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixture-page');

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 5177;

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
};

createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost');
	let path = decodeURIComponent(url.pathname);
	if (path.endsWith('/')) path += 'index.html';

	// Contain the served tree: normalize, then require the ROOT prefix.
	const file = normalize(join(ROOT, path));
	if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('not found\n');
		return;
	}

	res.writeHead(200, {
		'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
		'cache-control': 'no-store',
	});
	createReadStream(file).pipe(res);
}).listen(PORT, () => {
	console.log(`fixture page: http://localhost:${PORT}/`);
	console.log('open DevTools on that tab and select the "Puzzle" panel');
});
