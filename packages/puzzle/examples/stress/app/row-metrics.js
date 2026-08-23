/**
 * A PRODUCTION-VISIBLE counter for child-view data() runs.
 *
 * The framework's own structural counters (renders, wastedRenders, dataRuns)
 * live in `client-runtime/devperf.js`, which is dev-only by construction —
 * production defines `__PUZZLE_DEV__` as false and esbuild removes the module
 * outright. That is correct for the framework and useless for this benchmark:
 * the whole point of `benchmarks/runner.mjs` is that it measures the bundle
 * users actually ship, so the decisive counter has to survive into it.
 *
 * Hence this: one integer, incremented at the top of `ListRow.data()`. It costs
 * a property increment per data() run — negligible against the data() run
 * itself, and paid IDENTICALLY by both handler variants, so it cannot bias the
 * comparison it exists to measure.
 *
 * Read it through the scenario's `stats().childDataRuns`, which reports the
 * value captured at the end of the last measured op rather than the live
 * counter, so a stray render between `run()` resolving and `stats()` being
 * called cannot perturb the reported number.
 */

export const rowMetrics = { dataRuns: 0 };

export function resetRowMetrics() {
	rowMetrics.dataRuns = 0;
}
