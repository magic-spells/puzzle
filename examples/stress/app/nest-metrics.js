/**
 * A PRODUCTION-VISIBLE counter for `deep-nest` node data() runs.
 *
 * Same rationale as row-metrics.js: the decisive number for this scenario is
 * "how many of the 1,536 mounted views re-evaluated for one write", and the
 * framework's own dataRuns counter lives in `client-runtime/devperf.js`, which
 * production compiles out entirely. A scenario whose answer only exists in a
 * development build cannot be checked against the bundle users ship.
 *
 * It lives in its own module rather than sharing row-metrics.js because
 * `benchmarks/baseline.json` pins `childDataRuns` for every keyed-list and
 * handler-A/B op. Incrementing that same integer from a second scenario would
 * make those committed counters depend on which scenarios ran first.
 */

export const nestMetrics = { dataRuns: 0 };

export function resetNestMetrics() {
	nestMetrics.dataRuns = 0;
}
