#!/usr/bin/env node
/**
 * The Puzzle production benchmark driver.
 *
 *   npm run bench                  measure, print the table, compare to baseline
 *   npm run bench:update           the same, then rewrite benchmarks/baseline.json
 *
 * Flags: --filter <substr>  --iterations <n>  --no-build  --headed  --list
 *
 * ── What makes this different from every number measured before it ─────────
 * It builds `examples/stress` in PRODUCTION mode and serves the static output.
 * The dev server ships HMR, the DevTools bridge, per-view dev registration and
 * unminified code; measuring through it tells you about the development
 * experience, not about what users run. (Confirmed empirically: the production
 * bundle is 99 KB to the dev build's 327 KB and contains zero occurrences of
 * the DevTools hook, HMR, devstate or console.log.)
 *
 * ── Exit status ────────────────────────────────────────────────────────────
 * Non-zero for a validate() failure, a structural-counter mismatch, an op that
 * threw or timed out, or a rejected (throttle-clamped) sample set. NEVER for a
 * timing regression. Wall-clock time on a developer laptop is noise; this is a
 * local instrument, not a gate.
 */

import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../playwright.benchmark.config.js';
import { OPS, groupOps } from './scenarios.mjs';
import { buildBaseline, compareCounters, formatReport, summarize } from './report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logs = [];
const log = (line) => logs.push(line);

// ───────────────────────────────────────────────────────────────── args ────

function parseArgs(argv) {
	const args = {
		update: false,
		filter: null,
		iterations: null,
		build: true,
		headed: false,
		list: false,
		buildMode: config.build.mode,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === '--update-baseline' || a === '-u') args.update = true;
		else if (a === '--filter' || a === '-f') args.filter = argv[++i];
		else if (a === '--iterations' || a === '-n') args.iterations = Number(argv[++i]);
		else if (a === '--no-build') args.build = false;
		else if (a === '--headed') args.headed = true;
		else if (a === '--list') args.list = true;
		else if (a === '--build-mode') args.buildMode = argv[++i];
		else throw new Error(`unknown flag "${a}"`);
	}
	if (!['production', 'development'].includes(args.buildMode)) {
		throw new Error(`--build-mode must be "production" or "development", got "${args.buildMode}"`);
	}
	// `--build-mode development` exists to MEASURE how much the dev build
	// distorts things, not to benchmark with. Its numbers must never become the
	// committed reference.
	if (args.update && args.buildMode !== 'production') {
		throw new Error('--update-baseline requires a production build; a dev-build baseline would enshrine the distortion');
	}
	return args;
}

// ──────────────────────────────────────────────────────────────── build ────

/**
 * Copy the example's SOURCE into the benchmark's own scratch tree and build
 * THERE. `examples/stress/dist` is never written, read, or served.
 *
 * `puzzle build` has no output-dir flag, so it always emits `<appdir>/dist`.
 * Building the example in place therefore clobbers the bundle a human's
 * `puzzle dev` session is serving — and because a production build strips the
 * DevTools bridge, it silently kills their Performance panel. Copying the
 * source is the cheap way to make the benchmark's writes provably its own.
 */
function buildProduction(mode = config.build.mode) {
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

	if (!usingBin) {
		log(`BUILD  ${config.build.bin} is missing; fell back to \`go run\`, which cold-compiles the compiler first.`);
	}

	const res = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8' });
	if (res.status !== 0) {
		throw new Error(`benchmark build failed (exit ${res.status})\n${res.stdout || ''}${res.stderr || ''}`);
	}

	const dest = path.join(stageSrc, 'dist');
	if (!fs.existsSync(path.join(dest, 'app.js'))) {
		throw new Error(`build produced no app.js in ${path.relative(ROOT, dest)}`);
	}

	// An accidental dev build would silently invalidate the whole run, so prove
	// the bytes are what was asked for rather than trusting the flag.
	const bundle = fs.readFileSync(path.join(dest, 'app.js'), 'utf8');
	const devMarkers = ['__PUZZLE_DEVTOOLS_HOOK__', 'import.meta.hot', 'puzzle:hmr'];
	const found = devMarkers.filter((m) => bundle.includes(m));
	if (mode === 'production' && found.length) {
		throw new Error(`the served bundle carries development machinery (${found.join(', ')}) — this is not a production build`);
	}
	return { dir: dest, bundleKb: +(bundle.length / 1024).toFixed(1), usingBin, mode, devMarkers: found };
}

// ─────────────────────────────────────────────────────────────── server ────

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.map': 'application/json; charset=utf-8',
};

/** Minimal static server with SPA fallback. No dev server, no live reload, no extra dependency. */
function serveStatic(dir, { host, port }) {
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${host}:${port}`);
		let file = path.join(dir, decodeURIComponent(url.pathname));
		if (!file.startsWith(dir)) {
			res.writeHead(403).end('forbidden');
			return;
		}
		if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			const indexed = path.join(file, 'index.html');
			file = fs.existsSync(indexed) ? indexed : path.join(dir, 'index.html');
		}
		if (!fs.existsSync(file)) {
			res.writeHead(404).end('not found');
			return;
		}
		res.writeHead(200, {
			'content-type': MIME[path.extname(file)] || 'application/octet-stream',
			'cache-control': 'no-store',
		});
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve, reject) => {
		server.once('error', (err) => {
			// Someone else's server is on this port. Fail with an instruction
			// rather than killing a process the benchmark did not start —
			// this repo's dev servers live on 3000, 4173, 4174 and 4190.
			if (err.code === 'EADDRINUSE') {
				reject(
					new Error(
						`port ${port} is already in use. The benchmark will not kill a process it did not start; ` +
							`change server.port in playwright.benchmark.config.js to a free port above 4200.`
					)
				);
				return;
			}
			reject(err);
		});
		server.listen(port, host, () => resolve(server));
	});
}

// ────────────────────────────────────────────────────────────────── cdp ────

async function readMetrics(cdp) {
	const { metrics } = await cdp.send('Performance.getMetrics');
	const out = Object.create(null);
	for (const m of metrics) out[m.name] = m.value;
	return out;
}

/**
 * Force a full GC through the CDP HeapProfiler before every timed iteration.
 *
 * Without it, whichever iteration happens to trip the allocator's threshold
 * absorbs a collection that belongs to its predecessors. That is exactly the
 * kind of outlier a median tolerates but should not have to.
 */
const forceGc = (cdp) => cdp.send('HeapProfiler.collectGarbage');

function withTimeout(promise, ms, message) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(message)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

// ──────────────────────────────────────────────────────── page bindings ────

/** Untimed driving (prepare steps, warmup): a plain evaluate is fine. */
const callRun = (page, op) =>
	withTimeout(
		page.evaluate((o) => window.__STRESS__.run(o), op),
		config.run.opTimeoutMs,
		`op "${op}" did not settle within ${config.run.opTimeoutMs}ms`
	);

/**
 * The TIMED run, scheduled as an ordinary page task instead of an evaluate.
 *
 * This is not ceremony. `page.evaluate` executes through CDP
 * `Runtime.evaluate`, and the renderer does NOT attribute that work to
 * `Performance.getMetrics`' `ScriptDuration` — measured here, a `create-1k`
 * costing 18.7ms of real script time reported 0.02ms of CDP ScriptDuration,
 * while its layout (17.6ms) and style (7.2ms) came back correct. Reporting that
 * would have said the framework's own JavaScript was free.
 *
 * Kicking the op off from a `setTimeout(0)` puts it in a normal task the
 * renderer accounts for, so the CDP decomposition becomes a genuine second
 * opinion on the in-page clock rather than an echo of zero.
 *
 * The poll interval adds latency to noticing completion, which costs suite wall
 * time but cannot touch a reported number: the script/paint timings are taken
 * by the page itself, and CDP durations only accumulate while work is running.
 */
async function callRunTimed(page, op) {
	await page.evaluate((o) => {
		window.__bench = { done: false, result: null, error: null };
		setTimeout(() => {
			window.__STRESS__.run(o).then(
				(r) => {
					window.__bench.result = r;
					window.__bench.done = true;
				},
				(e) => {
					window.__bench.error = String((e && e.message) || e);
					window.__bench.done = true;
				}
			);
		}, 0);
	}, op);

	await page.waitForFunction(() => window.__bench && window.__bench.done, null, {
		timeout: config.run.opTimeoutMs,
		polling: 30,
	});

	const out = await page.evaluate(() => window.__bench);
	if (out.error) throw new Error(out.error);
	return out.result;
}

const callValidate = (page) => page.evaluate(() => window.__STRESS__.validate());
const callStats = (page) => page.evaluate(() => window.__STRESS__.stats());

const callSelect = (page, scenario, params) =>
	withTimeout(
		// select() resolves with the scenario API object, whose methods cannot
		// cross the bridge — return a plain value instead of leaking undefineds.
		page.evaluate(async ({ s, p }) => {
			await window.__STRESS__.select(s, p);
			return true;
		}, { s: scenario, p: params }),
		config.run.selectTimeoutMs,
		`select("${scenario}") did not settle within ${config.run.selectTimeoutMs}ms`
	);

const callWarmup = (page) =>
	withTimeout(
		page.evaluate(async () => {
			await window.__STRESS__.warmup();
			return true;
		}),
		config.run.opTimeoutMs,
		'warmup() did not settle'
	);

/**
 * Counters worth asserting.
 *
 * `stats()` gives the element/view/record counts directly. The two behavioural
 * scenarios report their finding in `run()`'s human-readable `detail` string
 * and nowhere else, so those numbers are parsed out of it. Parsing prose is
 * normally a smell; here the alternative is asserting nothing about the two
 * most interesting results in the suite, and a parse failure is visible
 * immediately (the counter goes missing and the expect check fails loudly).
 */
function extractCounters(entry, result, stats) {
	const counters = {
		mountedNodes: stats.mountedNodes,
		views: stats.views,
		records: stats.records,
	};
	const detail = result?.detail ?? '';

	// ── render-structure counters (the handler A/B's evidence) ───────────────
	//
	// `childDataRuns` is the decisive one and it is reported by the SCENARIO, not
	// by the framework: it counts ListRow.data() executions through a plain
	// integer that survives into the production bundle (examples/stress/app/
	// row-metrics.js). The framework's own counters live in devperf.js, which
	// production compiles out — so `perf` is null in a production run and
	// populated under `--build-mode development`. Both are recorded; neither is
	// synthesized when absent, because a fabricated 0 and a measured 0 mean
	// opposite things here.
	if (typeof stats.childDataRuns === 'number') counters.childDataRuns = stats.childDataRuns;
	if (typeof stats.handlers === 'string') counters.handlers = stats.handlers;
	// The generic structural channel (examples/stress/app/stress-controller.js).
	// A scenario reports the integers ITS question is about; they are spread in
	// as first-class counters so `expect`/`invariant` can assert them directly.
	// Spread BEFORE the perf block so a scenario can never shadow a framework
	// counter by accident.
	if (stats.counters && typeof stats.counters === 'object') Object.assign(counters, stats.counters);

	if (stats.perf) {
		counters.renders = stats.perf.renders;
		counters.wastedRenders = stats.perf.wastedRenders;
		counters.frameworkDataRuns = stats.perf.dataRuns;
		counters.domMutations = stats.perf.domMutations;
		counters.propBailouts = stats.perf.componentPropBailouts;
		counters.propReruns = stats.perf.componentPropReruns;
	}

	if (entry.scenario === 'subscriptions') {
		const m = detail.match(/→\s*(\d+)\/(\d+)\s+views re-evaluated\s*\(expected\s*(\d+)\)/);
		if (m) {
			counters.notified = Number(m[1]);
			counters.watchers = Number(m[2]);
			counters.expectedNotified = Number(m[3]);
		}
	}

	if (entry.scenario === 'async-waterfall') {
		const census = detail.match(/max\s+(\d+)\s+of\s+(\d+)\s+evaluating/);
		if (census) {
			counters.maxInFlight = Number(census[1]);
			counters.cells = Number(census[2]);
		}
		const verdict = detail.match(/→\s*([A-Z][A-Z\s()0-9=]*?):/);
		if (verdict) counters.verdict = verdict[1].trim();
	}

	return counters;
}

// ─────────────────────────────────────────────────────────────── guards ────

/**
 * Prove the renderer is not throttled BEFORE trusting a single number.
 *
 * Two independent probes, because the two clocks are throttled by different
 * mechanisms: rAF (which Puzzle schedules store flushes and view renders on)
 * drops to ~1Hz, and setTimeout clamps to ~1000ms. Either one alone would
 * quantize every timing in this suite to whole seconds.
 */
async function calibrate(page) {
	const probe = await page.evaluate(
		async (sleepMs) => {
			const frameMs = await new Promise((resolve) => {
				const t0 = performance.now();
				let n = 0;
				const tick = () => {
					n += 1;
					if (n >= 10) resolve((performance.now() - t0) / 10);
					else requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			});
			const t1 = performance.now();
			await new Promise((r) => setTimeout(r, sleepMs));
			return {
				frameMs,
				sleepMs: performance.now() - t1,
				visibility: document.visibilityState,
				hidden: document.hidden,
			};
		},
		config.guards.calibrationSleepMs
	);

	const failures = [];
	if (probe.visibility !== 'visible' || probe.hidden) {
		failures.push(`document.visibilityState is "${probe.visibility}" (hidden=${probe.hidden}) — the page is backgrounded`);
	}
	if (!(probe.frameMs < config.guards.maxFrameMs)) {
		failures.push(
			`requestAnimationFrame is running at ${probe.frameMs.toFixed(1)}ms/frame (limit ${config.guards.maxFrameMs}ms) — the renderer is throttled`
		);
	}
	if (!(probe.sleepMs < config.guards.maxCalibratedSleepMs)) {
		failures.push(
			`setTimeout(${config.guards.calibrationSleepMs}) measured ${probe.sleepMs.toFixed(1)}ms (limit ${config.guards.maxCalibratedSleepMs}ms) — setTimeout is clamped`
		);
	}
	return { probe, failures };
}

// ──────────────────────────────────────────────────────────────── suite ────

async function runEntry(page, cdp, entry, iterations, warmup) {
	const samples = [];
	let status = 'ok';
	let failure = null;

	for (let i = 0; i < warmup + iterations; i += 1) {
		const recording = i >= warmup;

		try {
			for (const prep of entry.prepare ?? []) await callRun(page, prep);
		} catch (err) {
			return { status: 'ERROR', failure: `prepare failed: ${err.message}`, samples };
		}

		// GUARD 3: never benchmark a broken render. This gates the timed window.
		const pre = await callValidate(page);
		if (!pre.ok) {
			return {
				status: 'FAILED',
				failure: `validate() failed BEFORE the timed run (iteration ${i + 1}): ${pre.detail}`,
				samples,
			};
		}

		// Assert the PREPARED state, not just that it renders.
		//
		// This exists because of a specific, measured trap: `RowOps.freshSeed()`
		// rewinds the deterministic fixture seed, so a `create-Nk` starting from
		// a non-empty list regenerates rows with the SAME ids and the SAME
		// content. Keyed reconciliation matches them and patches almost nothing —
		// measured at 1,000 existing rows, `create-1k` produced 1,001 of 1,003
		// renders wasted and only 95 DOM mutations. It renders correctly, so
		// validate() passes and the number looks plausible; it is a no-op patch
		// wearing a create's name. Declaring `preExpect: { records: 0 }` makes
		// "the list really was empty" a machine-checked fact.
		if (entry.preExpect) {
			const preStats = await callStats(page);
			for (const [key, want] of Object.entries(entry.preExpect)) {
				if (preStats[key] !== want) {
					return {
						status: 'MISMATCH',
						failure: `prepared state wrong before the timed run (iteration ${i + 1}): ${key} is ${preStats[key]}, expected ${want}. The op would not be measuring what its name says.`,
						samples,
					};
				}
			}
		}

		await forceGc(cdp);
		const m0 = await readMetrics(cdp);

		let result;
		try {
			result = await callRunTimed(page, entry.op);
		} catch (err) {
			return { status: 'ERROR', failure: `op threw: ${err.message}`, samples };
		}

		const m1 = await readMetrics(cdp);
		const stats = await callStats(page);
		const post = await callValidate(page);
		if (!post.ok) {
			return {
				status: 'FAILED',
				failure: `validate() failed AFTER the timed run (iteration ${i + 1}): ${post.detail}`,
				samples,
			};
		}

		if (!recording) continue;

		const counters = extractCounters(entry, result, stats);

		if (entry.invariant) {
			const broken = entry.invariant(counters);
			if (broken) return { status: 'MISMATCH', failure: `invariant broken: ${broken}`, samples };
		}
		if (entry.expect) {
			for (const [key, want] of Object.entries(entry.expect)) {
				if (counters[key] !== want) {
					return {
						status: 'MISMATCH',
						failure: `declared counter ${key} is ${counters[key]}, expected ${want}`,
						samples,
					};
				}
			}
		}

		// CDP durations are cumulative seconds; deltas x1000 are this op's ms.
		//
		// `ScriptDuration` is DELIBERATELY NOT REPORTED. Blink's bucket does not
		// account for this work: on a create-10k costing 182.9ms of measured
		// in-page script it reported 2.91ms, while Layout (144ms) and
		// RecalcStyle (90.7ms) came back correct and TaskDuration (491.6ms)
		// matched the 472ms wall time. The framework's own JavaScript lands in
		// `TaskOtherDuration`. Reporting ScriptDuration would state that Puzzle's
		// JavaScript is nearly free, which is the opposite of true.
		const layoutMs = (m1.LayoutDuration - m0.LayoutDuration) * 1000;
		const styleMs = (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000;
		const taskMs = (m1.TaskDuration - m0.TaskDuration) * 1000;

		samples.push({
			scriptMs: typeof result.scriptMs === 'number' ? result.scriptMs : NaN,
			paintMs: typeof result.ms === 'number' ? result.ms : NaN,
			cdpTaskMs: taskMs,
			cdpLayoutMs: layoutMs,
			cdpStyleMs: styleMs,
			// Main-thread time the engine did not spend in layout or style —
			// dominated by the framework's own JavaScript, plus paint/compositing.
			cdpOtherMs: taskMs - layoutMs - styleMs,
			heapDeltaMb: (m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1048576,
			nodes: m1.Nodes,
			counters,
			detail: result.detail,
		});
	}

	return { status, failure, samples };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	let entries = OPS;
	if (args.filter) entries = entries.filter((e) => e.id.includes(args.filter));
	if (!entries.length) throw new Error(`--filter "${args.filter}" matched no ops`);
	if (args.list) {
		for (const e of OPS) console.log(e.id);
		return 0;
	}

	// ── build ────────────────────────────────────────────────────────────────
	let built = {
		dir: path.join(ROOT, config.build.stageSrcDir, 'dist'),
		bundleKb: NaN,
		usingBin: true,
		mode: args.buildMode,
	};
	if (args.build) {
		process.stdout.write(`  building examples/stress in ${args.buildMode.toUpperCase()} mode ... `);
		built = buildProduction(args.buildMode);
		process.stdout.write(`${built.bundleKb} KB\n`);
		if (args.buildMode !== 'production') {
			log(
				`DEV BUILD  measuring a ${args.buildMode} build (${built.bundleKb} KB, dev markers present: ${built.devMarkers.join(', ') || 'none detected'}). These numbers describe the development experience, NOT what users ship. They cannot be written to the baseline.`
			);
		}
	} else {
		log('BUILD  --no-build: reusing the previously staged production bundle in benchmarks/.build.');
		if (!fs.existsSync(path.join(built.dir, 'app.js'))) throw new Error('--no-build but nothing is staged; run without it once');
		built.bundleKb = +(fs.statSync(path.join(built.dir, 'app.js')).size / 1024).toFixed(1);
	}

	const server = await serveStatic(built.dir, config.server);
	const base = `http://${config.server.host}:${config.server.port}`;

	const browser = await chromium.launch({
		headless: args.headed ? false : config.browser.headless,
		args: config.browser.args,
	});
	const context = await browser.newContext({ viewport: config.browser.viewport });
	const page = await context.newPage();

	const pageErrors = [];
	page.on('pageerror', (err) => pageErrors.push(String(err)));
	page.on('console', (msg) => {
		if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`);
	});

	const cdp = await openCdp(page);

	const summaries = [];
	let exitCode = 0;

	try {
		await page.goto(`${base}/`, { waitUntil: 'load' });
		await page.bringToFront();
		await page.waitForFunction(() => !!window.__STRESS__, null, { timeout: 60_000 });
		await page.evaluate(async () => {
			await window.__STRESS__.ready;
			return true;
		});

		// ── GUARD 4 ───────────────────────────────────────────────────────────
		const { probe, failures } = await calibrate(page);
		if (failures.length) {
			console.error('\n  THROTTLE GUARD FAILED — every timing below would be quantized to whole seconds:');
			for (const f of failures) console.error(`    · ${f}`);
			console.error('  Refusing to report numbers from a throttled renderer.\n');
			return 1;
		}

		const browserVersion = browser.version();

		for (const group of groupOps(entries)) {
			await callSelect(page, group.scenario, group.params);
			// The scenario's own warmup() cycle: JIT, allocator, style recalc.
			await callWarmup(page);

			for (const entry of group.ops) {
				const iterations = args.iterations ?? entry.iterations ?? config.run.iterations;
				const warmup = entry.warmup ?? config.run.warmup;
				process.stdout.write(`  ${entry.id} ... `);

				const t0 = Date.now();
				const { status, failure, samples } = await runEntry(page, cdp, entry, iterations, warmup);
				const secs = ((Date.now() - t0) / 1000).toFixed(1);

				if (status !== 'ok' || !samples.length) {
					process.stdout.write(`${status} (${secs}s)\n`);
					log(`${status}  ${entry.id}: ${failure ?? 'no samples recorded'}`);
					summaries.push({
						id: entry.id,
						label: entry.label,
						scenario: entry.scenario,
						size: entry.size,
						iterations: samples.length,
						scriptMs: NaN,
						scriptMadPct: 0,
						paintMs: NaN,
						paintMadPct: 0,
						cdpTaskMs: NaN,
						cdpLayoutMs: NaN,
						cdpStyleMs: NaN,
						cdpOtherMs: NaN,
						heapDeltaMb: NaN,
						counters: samples.length ? samples[samples.length - 1].counters : {},
						clamp: null,
						atResolutionFloor: false,
						status,
						note: entry.note,
					});
					exitCode = 1;
					continue;
				}

				const summary = summarize(entry, samples, config.guards);
				summary.status = 'ok';
				summary.note = entry.note;
				summaries.push(summary);
				process.stdout.write(`${secs}s\n`);
			}
		}

		// ── baseline comparison: STRUCTURAL ONLY ─────────────────────────────
		let baseline = null;
		const baselinePath = path.join(ROOT, config.report.baselinePath);
		if (fs.existsSync(baselinePath)) {
			try {
				baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
			} catch (err) {
				log(`BASELINE  ${config.report.baselinePath} is not valid JSON (${err.message}); deltas disabled.`);
			}
		}

		for (const s of summaries) {
			if (s.status !== 'ok') continue;
			const drift = compareCounters(s, baseline?.ops?.[s.id]);
			if (drift.length) {
				s.status = 'MISMATCH';
				log(`MISMATCH  ${s.id}: structural counters moved — ${drift.join('; ')}`);
				exitCode = 1;
			}
			if (s.clamp) {
				s.status = 'CLAMPED';
				log(`REJECTED  ${s.id}: ${s.clamp.detail}`);
				exitCode = 1;
			}
		}

		for (const err of pageErrors) log(`PAGE ERROR  ${err}`);

		const meta = {
			builtAt: new Date().toISOString(),
			platform: `${process.platform}-${process.arch}`,
			nodeVersion: process.version,
			browserVersion,
			buildMode: built.mode ?? args.buildMode,
			bundleKb: built.bundleKb,
			commit: gitInfo().commit,
			dirty: gitInfo().dirty,
		};

		const report = formatReport({
			summaries,
			baseline,
			meta,
			logs,
			config,
			calibration: probe,
		});
		console.log(report);

		fs.writeFileSync(
			path.join(ROOT, config.report.lastRunPath),
			JSON.stringify(buildBaseline(summaries, meta), null, '\t') + '\n'
		);

		if (args.update) {
			const measured = summaries.filter((s) => s.status === 'ok');
			if (measured.length !== summaries.length) {
				console.error(
					`  REFUSING to update the baseline: ${summaries.length - measured.length} op(s) did not report ok. A baseline written from a partial run would bake the failure in.\n`
				);
				exitCode = 1;
			} else {
				fs.writeFileSync(
					path.join(ROOT, config.report.baselinePath),
					JSON.stringify(buildBaseline(summaries, meta), null, '\t') + '\n'
				);
				console.log(`  baseline written to ${config.report.baselinePath} (${measured.length} ops)\n`);
			}
		}

		if (exitCode !== 0) {
			console.error('  EXIT 1 — a validate() failure, a structural mismatch, an op error, or a rejected sample set.');
			console.error('  Timing deltas NEVER affect the exit code.\n');
		}
	} finally {
		await context.close().catch(() => {});
		await browser.close().catch(() => {});
		await new Promise((r) => server.close(r));
	}

	return exitCode;
}

/**
 * One CDP session for the whole suite.
 *
 * `Performance` supplies the renderer's own script/layout/style accounting,
 * which is independent of the in-page `performance.now()` clock — two
 * disagreeing sources are how you find out that a number is wrong.
 * `HeapProfiler` supplies the forced GC between iterations.
 */
async function openCdp(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	await cdp.send('HeapProfiler.enable');
	return cdp;
}

function gitInfo() {
	const run = (a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() ?? '';
	return { commit: run(['rev-parse', '--short', 'HEAD']) || 'unknown', dirty: !!run(['status', '--porcelain']) };
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error(`\n  benchmark runner failed: ${err.stack || err.message}\n`);
		process.exit(1);
	});
