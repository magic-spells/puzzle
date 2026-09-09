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

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import config from '../playwright.benchmark.config.js';
import { buildStaged, serveStatic, stagedDistDir } from './harness-lib.mjs';

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

/**
 * Stage + build (see harness-lib.mjs), then prove the instrumentation SURVIVED.
 *
 * The staging and the compiler invocation are shared with runner.mjs; the
 * assertion is its mirror image. A dev probe over a production bundle would
 * report a fabricated zero for every counter it exists to collect, so the
 * sentinel check reads what was emitted rather than trusting the flag.
 */
function build(mode) {
	const built = buildStaged(mode, { label: 'probe' });
	if (mode === 'development' && !built.source.includes('__PUZZLE_PERF__')) {
		throw new Error('the built bundle carries no __PUZZLE_PERF__ sentinel — devperf was compiled out, so no structural counter is observable');
	}
	return { dir: built.dir, bundleKb: built.bundleKb };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const stageDir = stagedDistDir();

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

	const server = await serveStatic(built.dir, {
		host: '127.0.0.1',
		port: PORT,
		busyHint: 'The probe will not kill a process it did not start — free the port or change PORT in benchmarks/probe.mjs.',
	});
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
