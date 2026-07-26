#!/usr/bin/env node
/**
 * The DEVELOPMENT-build structural probe — the other half of `npm run bench`.
 *
 *   node benchmarks/probe.mjs --script <file.mjs> [--no-build] [--mode development]
 *
 * `runner.mjs` measures TIMINGS from a production bundle, because that is what
 * users ship. It therefore cannot see a single one of the framework's own
 * structural counters: `client-runtime/devperf.js` is dev-only by construction
 * and esbuild removes it from a production build outright, so `renders`,
 * `wastedRenders`, `domMutations`, `componentPropBailouts` and the D121 loop
 * detector simply do not exist there.
 *
 * This driver is the mirror image: it builds the SAME staged copy of the example
 * in DEVELOPMENT mode and hands a Playwright page to an arbitrary probe script.
 * Its milliseconds are worthless and must never be quoted as performance
 * numbers — its counters are the payload.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * It builds into `benchmarks/.build/stress-src`, exactly like runner.mjs, and
 * never writes `examples/stress/dist`. A human's `puzzle dev` session owns that
 * directory, and a build there would swap their bundle underneath them.
 *
 * It serves on its own port (4291), one above the benchmark's 4290, so a probe
 * and a benchmark can run back to back without either inheriting the other's
 * server. Like runner.mjs it REFUSES a busy port rather than killing whatever
 * holds it.
 */

import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import config from '../playwright.benchmark.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4291;

function parseArgs(argv) {
	const args = { script: null, build: true, mode: 'development', headed: false };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === '--script' || a === '-s') args.script = argv[++i];
		else if (a === '--no-build') args.build = false;
		else if (a === '--mode') args.mode = argv[++i];
		else if (a === '--headed') args.headed = true;
		else throw new Error(`unknown flag "${a}"`);
	}
	if (!args.script) throw new Error('--script <file.mjs> is required');
	return args;
}

/** Copy the example's SOURCE into the benchmark's scratch tree and build THERE. */
function build(mode) {
	const srcRoot = path.join(ROOT, config.build.example);
	const stageSrc = path.join(ROOT, config.build.stageSrcDir);

	fs.rmSync(stageSrc, { recursive: true, force: true });
	fs.mkdirSync(stageSrc, { recursive: true });
	for (const entry of config.build.copyEntries) {
		const from = path.join(srcRoot, entry);
		if (!fs.existsSync(from)) continue;
		fs.cpSync(from, path.join(stageSrc, entry), { recursive: true });
	}

	const binPath = path.join(ROOT, config.build.bin);
	const usingBin = fs.existsSync(binPath);
	const cmd = usingBin ? binPath : config.build.goFallback[0];
	const target = path.relative(ROOT, stageSrc);
	const argv = usingBin
		? ['build', target, '--mode', mode]
		: [...config.build.goFallback.slice(1), 'build', target, '--mode', mode];

	const res = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8' });
	if (res.status !== 0) {
		throw new Error(`probe build failed (exit ${res.status})\n${res.stdout || ''}${res.stderr || ''}`);
	}

	const dir = path.join(stageSrc, 'dist');
	const bundle = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

	// A dev probe over a production bundle would report a fabricated zero for
	// every counter it exists to collect, so prove the instrumentation is there.
	if (mode === 'development' && !bundle.includes('__PUZZLE_PERF__')) {
		throw new Error('the built bundle carries no __PUZZLE_PERF__ sentinel — devperf was compiled out, so no structural counter is observable');
	}
	return { dir, bundleKb: +(bundle.length / 1024).toFixed(1) };
}

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.map': 'application/json; charset=utf-8',
};

function serveStatic(dir, port) {
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://127.0.0.1:${port}`);
		let file = path.join(dir, decodeURIComponent(url.pathname));
		if (!file.startsWith(dir)) return void res.writeHead(403).end('forbidden');
		if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			const indexed = path.join(file, 'index.html');
			file = fs.existsSync(indexed) ? indexed : path.join(dir, 'index.html');
		}
		if (!fs.existsSync(file)) return void res.writeHead(404).end('not found');
		res.writeHead(200, {
			'content-type': MIME[path.extname(file)] || 'application/octet-stream',
			'cache-control': 'no-store',
		});
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve, reject) => {
		server.once('error', (err) => {
			if (err.code === 'EADDRINUSE') {
				reject(
					new Error(
						`port ${port} is already in use. The probe will not kill a process it did not start — ` +
							`free the port or change PORT in benchmarks/probe.mjs.`
					)
				);
				return;
			}
			reject(err);
		});
		server.listen(port, '127.0.0.1', () => resolve(server));
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const stageDir = path.join(ROOT, config.build.stageSrcDir, 'dist');

	let built = { dir: stageDir, bundleKb: NaN };
	if (args.build) {
		process.stderr.write(`  building examples/stress in ${args.mode.toUpperCase()} mode ... `);
		built = build(args.mode);
		process.stderr.write(`${built.bundleKb} KB\n`);
	} else if (!fs.existsSync(path.join(stageDir, 'app.js'))) {
		throw new Error('--no-build but nothing is staged; run without it once');
	}

	const probe = (await import(pathToFileURL(path.resolve(args.script)).href)).default;
	if (typeof probe !== 'function') throw new Error(`${args.script} must default-export an async function`);

	const server = await serveStatic(built.dir, PORT);
	const browser = await chromium.launch({ headless: !args.headed, args: config.browser.args });
	const context = await browser.newContext({ viewport: config.browser.viewport });
	const page = await context.newPage();

	const consoleLines = [];
	page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`));
	page.on('pageerror', (err) => consoleLines.push(`pageerror: ${String(err)}`));

	try {
		await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
		await page.bringToFront();
		await page.waitForFunction(() => !!window.__STRESS__, null, { timeout: 60_000 });
		await page.evaluate(() => window.__STRESS__.ready);

		const result = await probe({ page, log: (l) => process.stderr.write(`  ${l}\n`) });
		console.log(JSON.stringify({ result, console: consoleLines }, null, 2));
	} finally {
		await context.close().catch(() => {});
		await browser.close().catch(() => {});
		await new Promise((r) => server.close(r));
	}
	return 0;
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error(`\n  probe failed: ${err.stack || err.message}\n`);
		process.exit(1);
	});
