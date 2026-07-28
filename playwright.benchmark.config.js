/**
 * Benchmark configuration for `npm run bench`.
 *
 * THIS IS NOT A `@playwright/test` CONFIG. It is a plain ESM module consumed by
 * `benchmarks/runner.mjs`, which drives Playwright through its *library* API
 * (`chromium.launch()`) rather than the test runner. The name matches the
 * repo's `playwright.config.js` because it configures the same browser, but the
 * two are not interchangeable — `npx playwright test -c playwright.benchmark.config.js`
 * will not work and is not meant to.
 *
 * Why the library API and not the test runner:
 *
 *   1. A benchmark's unit of output is a MEDIAN over N iterations, not a
 *      pass/fail per iteration. The test runner wants one assertion per test;
 *      modelling 15 iterations as 15 tests throws away the aggregation and
 *      makes a single slow iteration look like a failure.
 *   2. Each op needs its own CDP session with `Performance` and `HeapProfiler`
 *      enabled, plus a forced GC between iterations. That is a driver concern,
 *      not a fixture concern.
 *   3. Exit status must be driven by validate() and structural counters ONLY —
 *      never by timing. The test runner's failure model does not distinguish
 *      those, and a timing-driven red build is exactly what this harness must
 *      not produce.
 */

export default {
	build: {
		// The prebuilt repo-root binary avoids `go run`'s cold recompile. Falls
		// back to `go run ./compiler/cmd/puzzle` when it is missing.
		bin: './puzzle',
		goFallback: ['go', 'run', './compiler/cmd/puzzle'],

		// READ-ONLY source. The runner copies it and never writes here.
		example: 'examples/stress',

		// The benchmark's own scratch checkout, and the ONLY place it builds.
		//
		// `puzzle build` has no output-dir flag (`--fixtures`, `--hybrid`,
		// `--mode`, `--static` are the whole set) — it always writes
		// `<appdir>/dist`. So building `examples/stress` directly writes
		// `examples/stress/dist`, which belongs to whoever is running
		// `puzzle dev`. It ALREADY cost someone their DevTools session once: a
		// production build strips the DevTools bridge by design, so a human's
		// Performance panel went dead with "No Puzzle app detected" mid-session.
		//
		// The fix is to copy the example's SOURCE here and build in the copy.
		// The benchmark then owns every byte it writes, and no dev server's
		// output is ever in question.
		stageSrcDir: 'benchmarks/.build/stress-src',

		// PRODUCTION. The entire point of this harness: the dev build carries HMR,
		// the DevTools bridge, per-view dev registration and unminified code, and
		// every number measured before this harness existed came from one.
		mode: 'production',

		// Copied from the example; everything else (dist/, node_modules/) is not.
		// The copy lives inside the repo, so `@magic-spells/puzzle` still resolves
		// through the root node_modules exactly as it does for the example.
		copyEntries: ['app', 'public', 'puzzle.config.js', 'package.json'],
	},

	server: {
		host: '127.0.0.1',
		// Deliberately clear of the ports humans use here: 3000 and 4190 are dev
		// servers, 4173/4174 belong to playwright.config.js. The runner also
		// refuses to start if this port is already listening rather than
		// competing for it.
		port: 4290,
	},

	browser: {
		headless: true,
		args: [
			// The throttling guard, at the source. Chrome clamps setTimeout to ~1s
			// and rAF to ~1Hz in a backgrounded/occluded renderer. Puzzle schedules
			// BOTH store flushes and view renders on rAF, so a throttled tab yields
			// timings quantized to whole seconds. These three flags stop the
			// browser from ever making that decision; runner.mjs still measures
			// whether it worked rather than trusting the flags.
			'--disable-background-timer-throttling',
			'--disable-backgrounding-occluded-windows',
			'--disable-renderer-backgrounding',
			// Keep raster cost comparable across machines with different DPI.
			'--force-device-scale-factor=1',
		],
		viewport: { width: 1280, height: 900 },
	},

	run: {
		// Recorded iterations per op. Individual ops may lower this in
		// scenarios.mjs; any op that does is printed in the report's LOG section,
		// because a quiet cap reads as "we measured everything".
		iterations: 15,
		// Untimed iterations of the real op before recording starts, on top of the
		// scenario's own warmup() cycle.
		warmup: 3,
		// A wedged op must fail the op, not hang the suite.
		opTimeoutMs: 240_000,
		selectTimeoutMs: 240_000,
	},

	guards: {
		// rAF-throttle detection. A healthy foreground frame is ~16.7ms; a
		// throttled one is ~1000ms.
		maxFrameMs: 100,
		// setTimeout-clamp detection: sleep(50) should measure ~50ms, never ~1000ms.
		calibrationSleepMs: 50,
		maxCalibratedSleepMs: 250,
		// Whole-second clustering detection over a recorded sample set. A sample
		// "looks clamped" when it sits within clampWindowMs of a positive integer
		// multiple of 1000ms; the set is rejected when at least clampFraction of
		// its samples do.
		clampWindowMs: 60,
		clampFraction: 0.6,
		// Below this, performance.now()'s ~100us clamp and frame quantisation
		// dominate; the value is reported but flagged as at the resolution floor.
		resolutionFloorMs: 0.5,
	},

	report: {
		baselinePath: 'benchmarks/baseline.json',
		lastRunPath: 'benchmarks/.last-run.json',
		// Display only. NOTHING here can change the exit code.
		timingAttentionPct: 15,
	},
};
