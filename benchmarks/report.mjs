/**
 * Statistics, baseline comparison, and table rendering for the benchmark.
 *
 * Everything here is deliberately median-based. One GC pause, one background
 * Spotlight index, one thermal throttle step ruins a mean and leaves a median
 * untouched — and a benchmark you only trust on an idle machine is a benchmark
 * you do not trust.
 */

/** Middle value; mean of the two middles for an even count. */
export function median(values) {
	if (!values.length) return NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median absolute deviation as a percentage of the median.
 *
 * The robust companion to a median: standard deviation is dominated by the one
 * outlier the median exists to ignore, so quoting it next to a median would
 * describe a distribution nobody is reporting. A MAD% above ~10 means the
 * sample set is noisy enough that small deltas are meaningless.
 */
export function madPct(values) {
	if (values.length < 2) return 0;
	const m = median(values);
	if (!m) return 0;
	return (median(values.map((v) => Math.abs(v - m))) / m) * 100;
}

/**
 * Whole-second clustering detector (methodology guard 4).
 *
 * Chrome clamps setTimeout to ~1000ms and rAF to ~1Hz in a throttled renderer.
 * Puzzle schedules both store flushes and view renders on rAF, so a throttled
 * tab does not produce "slightly slow" numbers — it produces numbers quantized
 * to whole seconds. That signature has already fooled one measurement in this
 * project, so it is detected rather than assumed away.
 *
 * A sample looks clamped when it sits within `windowMs` of a POSITIVE integer
 * multiple of 1000ms. Sub-1000ms samples cannot be clamped-looking, which is
 * why k starts at 1.
 */
export function detectClamp(values, { clampWindowMs = 60, clampFraction = 0.6 } = {}) {
	if (values.length < 3) return null;
	let suspicious = 0;
	for (const v of values) {
		const k = Math.round(v / 1000);
		if (k >= 1 && Math.abs(v - k * 1000) <= clampWindowMs) suspicious += 1;
	}
	const fraction = suspicious / values.length;
	if (fraction < clampFraction) return null;
	return {
		suspicious,
		total: values.length,
		fraction,
		detail: `${suspicious}/${values.length} samples sit within ${clampWindowMs}ms of a whole second — the signature of a throttled renderer, not a measurement`,
	};
}

/** Percent change, guarding division by a zero baseline. */
export function deltaPct(current, base) {
	if (base === undefined || base === null || !Number.isFinite(base)) return null;
	if (base === 0) return current === 0 ? 0 : Infinity;
	return ((current - base) / base) * 100;
}

const fmtMs = (n) => (!Number.isFinite(n) ? '—' : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '—');

function fmtDelta(pct) {
	if (pct === null || pct === undefined) return '—';
	if (!Number.isFinite(pct)) return '∞';
	const sign = pct > 0 ? '+' : '';
	return `${sign}${pct.toFixed(1)}%`;
}

function renderTable(headers, rows, aligns) {
	if (!rows.length) return '  (no rows)';
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
	const line = (cells) =>
		'  ' +
		cells
			.map((c, i) => {
				const s = String(c ?? '');
				return aligns[i] === 'l' ? s.padEnd(widths[i]) : s.padStart(widths[i]);
			})
			.join('  ');
	const rule = '  ' + widths.map((w) => '─'.repeat(w)).join('──');
	return [line(headers), rule, ...rows.map(line)].join('\n');
}

/**
 * Reduce one op's recorded iterations to the numbers that get reported.
 * `samples` is the array of per-iteration records collected by the runner.
 */
export function summarize(entry, samples, guards) {
	const script = samples.map((s) => s.scriptMs).filter(Number.isFinite);
	const paint = samples.map((s) => s.paintMs).filter(Number.isFinite);
	const cdpTask = samples.map((s) => s.cdpTaskMs).filter(Number.isFinite);
	const cdpLayout = samples.map((s) => s.cdpLayoutMs).filter(Number.isFinite);
	const cdpStyle = samples.map((s) => s.cdpStyleMs).filter(Number.isFinite);
	const cdpOther = samples.map((s) => s.cdpOtherMs).filter(Number.isFinite);
	const heap = samples.map((s) => s.heapDeltaMb).filter(Number.isFinite);

	// The last iteration's counters are the reported ones: they are
	// deterministic, so any iteration would do, but the last one is the state
	// the post-run validate() actually inspected.
	const counters = samples.length ? samples[samples.length - 1].counters : {};

	return {
		id: entry.id,
		label: entry.label,
		scenario: entry.scenario,
		size: entry.size,
		iterations: samples.length,
		scriptMs: median(script),
		scriptMadPct: madPct(script),
		paintMs: median(paint),
		paintMadPct: madPct(paint),
		cdpTaskMs: median(cdpTask),
		cdpLayoutMs: median(cdpLayout),
		cdpStyleMs: median(cdpStyle),
		cdpOtherMs: median(cdpOther),
		heapDeltaMb: median(heap),
		counters,
		clamp: detectClamp(paint.length ? paint : script, guards),
		atResolutionFloor: Number.isFinite(median(script)) && median(script) < guards.resolutionFloorMs,
		samples: { script, paint },
	};
}

/** The committed reference file's shape. Timings are informational; counters are asserted. */
export function buildBaseline(summaries, meta) {
	const ops = {};
	for (const s of summaries) {
		if (s.status && s.status !== 'ok') continue;
		ops[s.id] = {
			scenario: s.scenario,
			size: s.size,
			iterations: s.iterations,
			scriptMs: Number.isFinite(s.scriptMs) ? Number(s.scriptMs.toFixed(3)) : null,
			paintMs: Number.isFinite(s.paintMs) ? Number(s.paintMs.toFixed(3)) : null,
			cdpTaskMs: Number.isFinite(s.cdpTaskMs) ? Number(s.cdpTaskMs.toFixed(3)) : null,
			cdpLayoutMs: Number.isFinite(s.cdpLayoutMs) ? Number(s.cdpLayoutMs.toFixed(3)) : null,
			cdpStyleMs: Number.isFinite(s.cdpStyleMs) ? Number(s.cdpStyleMs.toFixed(3)) : null,
			counters: s.counters,
		};
	}
	return { meta, ops };
}

/**
 * Compare structural counters against the baseline.
 *
 * Structural counters are DETERMINISTIC — the same op over the same seeded data
 * always produces the same element, view and record counts. That makes them the
 * only thing in this harness worth failing a build over. Timings are not
 * compared here at all, by design.
 */
export function compareCounters(summary, baselineOp) {
	if (!baselineOp?.counters) return [];
	const drift = [];
	for (const [key, want] of Object.entries(baselineOp.counters)) {
		const got = summary.counters?.[key];
		if (got !== want) drift.push(`${key}: ${fmtInt(got)} (baseline ${fmtInt(want)})`);
	}
	return drift;
}

export function formatReport({ summaries, baseline, meta, logs, config, calibration }) {
	const out = [];
	const hasBaseline = !!baseline?.ops && Object.keys(baseline.ops).length > 0;

	out.push('');
	out.push('  PUZZLE PRODUCTION BENCHMARK');
	out.push(`  ${meta.builtAt}  ·  ${meta.platform}  ·  chromium ${meta.browserVersion}  ·  node ${meta.nodeVersion}`);
	out.push(`  build: ${meta.buildMode} · bundle ${meta.bundleKb} KB  ·  commit ${meta.commit}${meta.dirty ? ' (dirty)' : ''}`);
	out.push(
		`  frame ${calibration.frameMs.toFixed(1)}ms · sleep(${config.guards.calibrationSleepMs}) measured ${calibration.sleepMs.toFixed(1)}ms · visibility "${calibration.visibility}"`
	);
	out.push('');

	// ── main table ──────────────────────────────────────────────────────────
	const headers = [
		'op',
		'n',
		'it',
		'script ms',
		'±',
		'paint ms',
		'±',
		'live nodes',
		'views',
		'records',
		'Δscript',
		'Δpaint',
		'status',
	];
	const aligns = ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'l'];
	// A percentage against a value at the measurement floor is theatre: 0.00 ->
	// 0.10ms is "+infinity", and 0.40 -> 0.50 is "+25%", when both are one
	// performance.now() tick. Show `flr` and let the FLOOR log line explain.
	const floorAware = (current, base) => {
		if (!hasBaseline) return '—';
		const floor = config.guards.resolutionFloorMs;
		if (!Number.isFinite(current) || !Number.isFinite(base)) return fmtDelta(deltaPct(current, base));
		if (current < floor || base < floor) return 'flr';
		return fmtDelta(deltaPct(current, base));
	};

	const rows = summaries.map((s) => {
		const base = baseline?.ops?.[s.id];
		return [
			`${s.scenario} ${s.label}`,
			fmtInt(s.size),
			s.iterations,
			fmtMs(s.scriptMs),
			`${s.scriptMadPct.toFixed(0)}%`,
			fmtMs(s.paintMs),
			`${s.paintMadPct.toFixed(0)}%`,
			fmtInt(s.counters?.mountedNodes),
			fmtInt(s.counters?.views),
			fmtInt(s.counters?.records),
			floorAware(s.scriptMs, base?.scriptMs),
			floorAware(s.paintMs, base?.paintMs),
			s.status === 'ok' ? 'ok' : s.status,
		];
	});
	out.push(renderTable(headers, rows, aligns));
	out.push('');

	// ── CDP decomposition ───────────────────────────────────────────────────
	out.push('  CDP RENDERER DECOMPOSITION  (Performance.getMetrics deltas, medians)');
	out.push('  Where the main thread actually went, as the RENDERER accounts for it —');
	out.push('  an independent second opinion on the in-page clock above.');
	out.push('    task    total main-thread task time for the op');
	out.push('    layout  LayoutDuration      — the engine reflowing what the framework changed');
	out.push('    style   RecalcStyleDuration — the engine recomputing style for it');
	out.push('    other   task - layout - style, dominated by the framework\'s own JavaScript');
	out.push('  ScriptDuration is NOT shown: Blink\'s bucket reported 2.9ms against 182.9ms of');
	out.push('  measured script, so it would report the framework as free. See benchmarks/README.md.');
	const cdpRows = summaries
		.filter((s) => Number.isFinite(s.cdpTaskMs))
		.map((s) => [
			`${s.scenario} ${s.label}`,
			fmtInt(s.size),
			fmtMs(s.cdpTaskMs),
			fmtMs(s.cdpLayoutMs),
			fmtMs(s.cdpStyleMs),
			fmtMs(s.cdpOtherMs),
			Number.isFinite(s.heapDeltaMb) ? s.heapDeltaMb.toFixed(1) : '—',
		]);
	out.push(
		renderTable(
			['op', 'n', 'task', 'layout', 'style', 'other', 'heap Δ MB'],
			cdpRows,
			['l', 'r', 'r', 'r', 'r', 'r', 'r']
		)
	);
	out.push('');

	// ── extra counters that are not element counts ──────────────────────────
	const extra = summaries.filter(
		(s) => s.counters && ('notified' in s.counters || 'maxInFlight' in s.counters)
	);
	if (extra.length) {
		out.push('  BEHAVIOURAL COUNTERS  (deterministic — these are asserted, not timed)');
		out.push(
			renderTable(
				['op', 'counter', 'value', 'baseline'],
				extra.flatMap((s) =>
					Object.entries(s.counters)
						.filter(([k]) => ['notified', 'watchers', 'maxInFlight', 'cells', 'verdict'].includes(k))
						.map(([k, v]) => [
							`${s.scenario} ${s.label}`,
							k,
							String(v),
							String(baseline?.ops?.[s.id]?.counters?.[k] ?? '—'),
						])
				),
				['l', 'l', 'r', 'r']
			)
		);
		out.push('');
	}

	// ── log ─────────────────────────────────────────────────────────────────
	out.push('  LOG  (every cap, skip, retry and note — nothing here is silent)');
	const allLogs = [...logs];
	for (const s of summaries) {
		if (s.iterations !== config.run.iterations) {
			allLogs.push(
				`CAP  ${s.id}: ${s.iterations} recorded iterations, not the default ${config.run.iterations}. Declared in benchmarks/scenarios.mjs.`
			);
		}
		if (s.clamp) allLogs.push(`CLAMP  ${s.id}: ${s.clamp.detail}`);
		if (s.atResolutionFloor) {
			allLogs.push(
				`FLOOR  ${s.id}: median script ${fmtMs(s.scriptMs)}ms is below the ${config.guards.resolutionFloorMs}ms resolution floor — performance.now() is clamped to ~100us, so treat this as "too fast to measure", not as a precise value.`
			);
		}
		if (s.note) allLogs.push(`NOTE  ${s.id}: ${s.note}`);
	}
	if (!allLogs.length) allLogs.push('nothing capped, skipped or retried.');
	for (const l of allLogs) out.push(`  · ${l}`);
	out.push('');

	if (!hasBaseline) {
		out.push('  NO BASELINE  ·  benchmarks/baseline.json is missing or empty, so every delta reads "—".');
		out.push('  Write one with `npm run bench:update`.');
		out.push('');
	}

	return out.join('\n');
}

export { fmtMs, fmtInt, fmtDelta };
