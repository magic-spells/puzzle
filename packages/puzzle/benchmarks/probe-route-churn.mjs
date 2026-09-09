/**
 * route-churn structural probe — the per-level render/data()/mutation counters.
 *
 *   node benchmarks/probe.mjs --script benchmarks/probe-route-churn.mjs --mode production
 *   node benchmarks/probe.mjs --script benchmarks/probe-route-churn.mjs   # development
 *
 * WHICH BUILD TO USE, AND WHY IT MATTERS HERE MORE THAN ELSEWHERE
 *
 * The per-level counters live in `examples/stress/app/rc-metrics.js` and are
 * production-visible by design, so PRODUCTION is the primary run: it is the
 * bundle users ship AND the only build with no D121 runaway-render detector to
 * distort the very renders being counted.
 *
 * The DEVELOPMENT run adds the framework's own `renders` / `wastedRenders` /
 * `componentPropBailouts` as an independent cross-check. It must stay PACED —
 * the unpaced arms trip the detector, which then suppresses ancestor renders and
 * leaves the routed child unmounted. See NAV_INTERVAL_MS in RcLayout.pzl.
 *
 * Milliseconds are not reported from either run. `npm run bench` owns timings,
 * and every paced op's duration is an input rather than a measurement.
 */

/** Unpaced in production (no detector); paced everywhere else. */
const PROD_OPS = ['navigate-burst-100', 'params-burst-100', 'back-forward-100', 'supersede-50'];
const DEV_OPS = ['navigate-100', 'params-100', 'back-forward-100', 'supersede-50'];

export default async function probe({ page, log }) {
	const isDev = await page.evaluate(() => typeof globalThis.__PUZZLE_PERF__ !== 'undefined');
	const ops = isDev ? DEV_OPS : PROD_OPS;
	// A dev run is paced at 5 navigations/sec, so a full 100 would take 20s per
	// op. The counters are exact rather than statistical, so a smaller count says
	// exactly the same thing — but it IS a reduced sample, so it is logged.
	const navs = isDev ? 20 : 100;
	log(`build: ${isDev ? 'DEVELOPMENT (framework counters available, ops PACED)' : 'PRODUCTION (primary run, ops UNPACED)'}`);
	if (isDev) log(`NOTE  navs reduced to ${navs} for the paced dev run; counters are exact, not sampled.`);

	const out = { build: isDev ? 'development' : 'production', navs, runaway: [], runs: [] };
	page.on('console', (m) => {
		if (m.type() === 'warning' && m.text().includes('stopped')) out.runaway.push(m.text());
	});

	const visibility = await page.evaluate(() => document.visibilityState);
	if (visibility !== 'visible') throw new Error(`visibilityState is "${visibility}" — a throttled renderer invalidates the run`);

	for (const delay of [0, 10, 50]) {
		for (const op of ops) {
			// The delay sweep only changes the loader; back-forward and supersede at
			// every delay would add minutes for nothing.
			if (delay !== 0 && (op === 'back-forward-100' || op === 'supersede-50')) continue;

			await page.evaluate((p) => window.__STRESS__.select('route-churn', p), { delay, navs });
			const pre = await page.evaluate(() => window.__STRESS__.validate());
			if (!pre.ok) throw new Error(`select failed before ${op} @delay=${delay}: ${pre.detail}`);

			await page.evaluate(() => window.__STRESS__.warmup());
			const gate = await page.evaluate(() => window.__STRESS__.validate());
			if (!gate.ok) throw new Error(`post-warmup validate failed before ${op} @delay=${delay}: ${gate.detail}`);

			const result = await page.evaluate(
				(o) => window.__STRESS__.run(o).then((r) => r, (e) => ({ error: String((e && e.message) || e) })),
				op
			);
			if (result.error) throw new Error(`${op} @delay=${delay} threw: ${result.error}`);

			const post = await page.evaluate(() => window.__STRESS__.validate());
			const stats = await page.evaluate(() => window.__STRESS__.stats());
			out.runs.push({ delay, op, ok: post.ok, detail: result.detail, counters: stats.counters, perf: stats.perf });

			log(`delay=${delay} ${op}: validate ${post.ok ? 'PASS' : 'FAIL'} — ${post.detail}`);
			for (const line of String(result.detail).split('\n')) log(`   ${line}`);
			if (!post.ok) throw new Error(`${op} @delay=${delay} left the DOM invalid: ${post.detail}`);
		}
	}

	// A runaway warning during a PACED run means the pacing is no longer under
	// the guard's limit and every counter above is suspect.
	if (out.runaway.length) {
		throw new Error(
			`the D121 runaway detector fired ${out.runaway.length} time(s) during this run, so the render counts are the guard's, not the router's:\n  ${out.runaway.join('\n  ')}`
		);
	}
	log('runaway detector: never fired — the counters are the router\'s');
	return out;
}
