/**
 * listener-churn probe — the exact listener-call counts and the micro
 * decomposition that prices the invoker pattern.
 *
 *   node benchmarks/probe.mjs --script benchmarks/probe-listener-churn.mjs --mode production
 *
 * `npm run bench -- --filter listener-churn` owns the TIMINGS (medians of 15,
 * forced GC, clamp screening). This probe exists for the two things the matrix
 * cannot express:
 *
 *   count-listeners       exact addEventListener/removeEventListener totals per
 *                         arm, with Element.prototype patched by the scenario
 *   micro-listener-cost   per-handler cost of remove+add vs an invoker property
 *                         write vs an arrow allocation, batch-timed
 *
 * Either build works: the counts come from the scenario's own probe, not from
 * devperf. Production is preferred so the numbers describe shipped code.
 */

const ARMS = ['churn', 'stable', 'none'];

export default async function probe({ page, log }) {
	const visibility = await page.evaluate(() => document.visibilityState);
	if (visibility !== 'visible') throw new Error(`visibilityState is "${visibility}" — a throttled renderer invalidates the run`);

	const isDev = await page.evaluate(() => typeof globalThis.__PUZZLE_PERF__ !== 'undefined');
	log(`build: ${isDev ? 'development' : 'production'} · counts are exact in both; never quote a dev millisecond`);

	const out = { build: isDev ? 'development' : 'production', runs: [] };

	for (const n of [1000, 10000]) {
		for (const binding of ARMS) {
			await page.evaluate((p) => window.__STRESS__.select('listener-churn', p), { n, binding });
			const pre = await page.evaluate(() => window.__STRESS__.validate());
			if (!pre.ok) throw new Error(`select failed n=${n} ${binding}: ${pre.detail}`);

			// BEHAVIOUR GATE FIRST. An arm that is cheap because it quietly bound
			// nothing has to fail here, before any of its numbers are believed — and
			// for `none` the gate asserts the opposite: that clicking is inert.
			const gate = await page.evaluate(
				() => window.__STRESS__.run('click-select').then((r) => r, (e) => ({ error: String((e && e.message) || e) }))
			);
			if (gate.error) throw new Error(`click-select gate failed n=${n} ${binding}: ${gate.error}`);
			log(`n=${n} ${binding}: GATE ok`);

			await page.evaluate(() => window.__STRESS__.warmup());

			for (const op of ['rerender', 'count-listeners', 'micro-listener-cost']) {
				const r = await page.evaluate(
					(o) => window.__STRESS__.run(o).then((x) => x, (e) => ({ error: String((e && e.message) || e) })),
					op
				);
				if (r.error) throw new Error(`${op} failed n=${n} ${binding}: ${r.error}`);

				const post = await page.evaluate(() => window.__STRESS__.validate());
				if (!post.ok) throw new Error(`${op} left the DOM invalid n=${n} ${binding}: ${post.detail}`);

				const stats = await page.evaluate(() => window.__STRESS__.stats());
				// stats().handlers is reported BY THE SCENARIO, so an arm cannot be
				// mislabelled by the driver.
				if (stats.handlers !== binding) {
					throw new Error(`arm mismatch: driver asked for "${binding}", the scenario reports "${stats.handlers}"`);
				}
				out.runs.push({ n, binding, op, ms: r.ms, scriptMs: r.scriptMs, detail: r.detail, counters: stats.counters });
				log(`n=${n} ${binding} ${op}: ${r.detail}`);
			}
		}
	}

	// ── the question this scenario was originally asked ─────────────────────
	//
	// "Count addEventListener/removeEventListener during a KEYED-LIST render at
	// n=1000/10000 in both handler arms." keyed-list has no counting op, and it
	// does not need one: the patch goes on Element.prototype from the DRIVER, so
	// the app is untouched and any scenario can be measured this way.
	//
	// The expected answer is zero in both arms — ListRow binds `@click={ onSelect }`,
	// which codegen caches per instance — and it is worth proving rather than
	// asserting, because the whole invoker question turns on it.
	out.keyedList = [];
	for (const n of [1000, 10000]) {
		for (const handlers of ['inline', 'stable']) {
			await page.evaluate((p) => window.__STRESS__.select('keyed-list', p), { n, handlers });
			await page.evaluate(() => window.__STRESS__.warmup());
			const pre = await page.evaluate(() => window.__STRESS__.validate());
			if (!pre.ok) throw new Error(`keyed-list select failed n=${n} ${handlers}: ${pre.detail}`);

			const counts = await page.evaluate(async (op) => {
				const proto = Element.prototype;
				const own = Object.prototype.hasOwnProperty;
				if (own.call(proto, 'addEventListener') || own.call(proto, 'removeEventListener')) {
					throw new Error('Element.prototype is already patched');
				}
				const c = { add: 0, remove: 0 };
				const baseAdd = proto.addEventListener;
				const baseRemove = proto.removeEventListener;
				const def = (name, base, key) =>
					Object.defineProperty(proto, name, {
						configurable: true,
						writable: true,
						enumerable: false,
						value: function (...a) {
							c[key] += 1;
							return base.apply(this, a);
						},
					});
				def('addEventListener', baseAdd, 'add');
				def('removeEventListener', baseRemove, 'remove');
				try {
					await window.__STRESS__.run(op);
				} finally {
					delete proto.addEventListener;
					delete proto.removeEventListener;
				}
				return c;
			}, 'update-every-10th');

			const post = await page.evaluate(() => window.__STRESS__.validate());
			const stats = await page.evaluate(() => window.__STRESS__.stats());
			out.keyedList.push({ n, handlers, ...counts, childDataRuns: stats.childDataRuns, ok: post.ok });
			log(
				`keyed-list update-every-10th n=${n} handlers=${handlers}: ` +
					`${counts.add} addEventListener + ${counts.remove} removeEventListener ` +
					`(${stats.childDataRuns} child data() runs, validate ${post.ok ? 'PASS' : 'FAIL'})`
			);
			if (!post.ok) throw new Error(`keyed-list left the DOM invalid n=${n} ${handlers}: ${post.detail}`);
		}
	}

	return out;
}
