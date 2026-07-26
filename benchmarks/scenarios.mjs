/**
 * The benchmark op matrix: what gets measured, at what size, how many times.
 *
 * Each entry is one measured op. The runner walks them in order, grouping
 * consecutive entries that share a scenario + params so the (expensive) page
 * setup happens once per group rather than once per op.
 *
 * ── Entry shape ────────────────────────────────────────────────────────────
 *   id          stable key — matches against baseline.json, so DO NOT rename
 *               casually or every delta reads as new
 *   scenario    a name from __STRESS__.scenarios
 *   params      query params handed to __STRESS__.select()
 *   op          the op string handed to __STRESS__.run() and TIMED
 *   prepare     ops run through __STRESS__.run() and NOT timed, before every
 *               single recorded iteration, to restore the op's precondition
 *   iterations  recorded iterations (default from playwright.benchmark.config.js)
 *   warmup      untimed real-op iterations before recording
 *   preExpect   counters asserted on the PREPARED state, before the timed op —
 *               proves the op is measuring what its name says
 *   expect      structural counters asserted exactly; a mismatch exits non-zero
 *   invariant   fn(stats) -> string|null; a returned string is a failure
 *   note        printed in the report's LOG section
 *
 * ── Why every iteration re-prepares ────────────────────────────────────────
 * `create-1k/10k/50k` map to RowOps.freshSeed(), which CLEARS the collection
 * and then seeds it. Run back to back, iteration 2 pays a 10k teardown that
 * iteration 1 did not, and "create" quietly becomes "replace". Preparing with
 * an untimed `clear` makes every recorded iteration the same measurement:
 * empty list -> N rows. The mutation ops (`update-every-10th`, `swap-rows`,
 * `clear`) are the mirror image — they need a populated list that the previous
 * iteration destroyed, so their prepare rebuilds it.
 *
 * The prepare cost is real and is NOT in any reported number, but it is why the
 * 50k rows cost roughly twice their measured time in wall clock.
 */

/**
 * NOTHING IN THIS FILE CAPS ITERATIONS.
 *
 * Every op runs the full 15 recorded iterations from
 * playwright.benchmark.config.js. That was worth checking rather than assuming:
 * the 50k full-DOM ops are the expensive ones, and each of their iterations
 * pays an untimed `create-50k` prepare plus two `validate()` passes that walk
 * all 50,000 rows. Measured, that is ~2.7s per iteration, so the whole suite
 * still lands in single-digit minutes and no cap is needed.
 *
 * If one is ever added, set `iterations` on the entry — the runner prints a CAP
 * line in the report's LOG section and the table's `it` column shows the real
 * count, so a reduced sample set can never be mistaken for a full one.
 */

/** Every row in `keyed-list` is 7 elements, so live DOM is records x 7 exactly. */
const keyedInvariant = (stats) =>
	stats.mountedNodes === stats.records * 7
		? null
		: `keyed-list: ${stats.mountedNodes} live elements for ${stats.records} records (want ${stats.records * 7})`;

/**
 * `virtual-list` mounts a fixed 25-row window (25 x 7 + 2 spacers = 177), so
 * live DOM must NOT grow with the record count. This is the single assertion
 * that catches "windowing broke" — the README's stated failure mode.
 */
const windowedInvariant = (stats) =>
	stats.mountedNodes <= 200
		? null
		: `virtual-list: ${stats.mountedNodes} live elements — the window is capped at 25 rows (~177 elements), so windowing has broken`;

/** keyed-list + virtual-list share an op set; this builds one size's worth. */
function listOps(scenario, size, { invariant, iterations }) {
	const createOp = size === 1000 ? 'create-1k' : size === 10000 ? 'create-10k' : 'create-50k';
	const params = { n: size };
	const common = { scenario, params, size, invariant, iterations };
	return [
		{
			...common,
			id: `${scenario}/create/${size}`,
			label: 'create',
			prepare: ['clear'],
			op: createOp,
			// A create MUST start from an empty list or it is not a create — see
			// the preExpect comment in runner.mjs. Machine-checked every iteration.
			preExpect: { records: 0 },
			expect: { records: size },
		},
		{
			...common,
			id: `${scenario}/update-every-10th/${size}`,
			label: 'update-every-10th',
			prepare: ['clear', createOp],
			op: 'update-every-10th',
			// The prepare must actually have built the list.
			preExpect: { records: size },
			expect: { records: size },
		},
		{
			...common,
			id: `${scenario}/swap-rows/${size}`,
			label: 'swap-rows',
			prepare: ['clear', createOp],
			op: 'swap-rows',
			// The prepare must actually have built the list.
			preExpect: { records: size },
			expect: { records: size },
		},
		{
			...common,
			id: `${scenario}/clear/${size}`,
			label: 'clear',
			prepare: ['clear', createOp],
			op: 'clear',
			// There must be something to tear down, or `clear` measures nothing.
			preExpect: { records: size },
			expect: { records: 0 },
		},
	];
}

// ───────────────────────────────────────────────── the handler A/B ────────
//
// One question: is keyed-list's per-row re-render cascade a FRAMEWORK problem
// or an EXAMPLE-WRITTEN-BADLY problem?
//
// Both arms run the SAME scenario, the SAME records, the SAME row component and
// the SAME ops. The only difference is how KeyedList spells its two callback
// props — `@select={ selectRow(row) }` (a fresh closure per row per render,
// which `shallowEqual` can never match) versus `@select={ selectById }` (a bare
// reference codegen caches in `this.__h`, identical across renders). See the
// handler A/B note in examples/stress/app/scenarios/KeyedList.pzl.
//
// The `inline` arm deliberately does NOT pass `handlers=inline`: it is the
// default, so the arm's URL, render path and counters are byte-identical to the
// plain `keyed-list/*` entries the committed baseline was recorded from.
//
// Why these are separate ids rather than a reinterpretation of the existing
// `keyed-list/*` numbers: the two arms are measured back to back, in one browser
// session, at the same iteration count, with the same forced GC between
// iterations. Comparing against numbers gathered elsewhere in the run would fold
// in whatever drifted in between.
const AB_OPS = ['create', 'update-every-10th', 'swap-rows', 'select-row'];

function abParams(variant, size) {
	return variant === 'stable' ? { n: size, handlers: 'stable' } : { n: size };
}

function handlerOps(variant, size) {
	const createOp = size === 1000 ? 'create-1k' : 'create-10k';
	const common = {
		scenario: 'keyed-list',
		params: abParams(variant, size),
		size,
		invariant: keyedInvariant,
	};
	return AB_OPS.map((op) => {
		const entry = {
			...common,
			id: `handlers-${variant}/${op}/${size}`,
			label: `${op} (${variant})`,
			op: op === 'create' ? createOp : op,
		};
		if (op === 'create') {
			// A create MUST start from an empty list or it is not a create.
			entry.prepare = ['clear'];
			entry.preExpect = { records: 0 };
			entry.expect = { records: size };
		} else {
			entry.prepare = ['clear', createOp];
			entry.preExpect = { records: size };
			entry.expect = { records: size };
		}
		return entry;
	});
}

/**
 * The behaviour gates. A faster variant that does not work is worthless, so
 * before any A/B timing is believed, each arm must prove that a REAL click on a
 * rendered row still selects it and that a real click on the remove button still
 * removes it. The ops throw on any store/DOM disagreement, which the runner
 * reports as ERROR and which fails the run.
 *
 * One iteration, no warmup: this is an assertion, not a measurement, and its
 * milliseconds mean nothing.
 */
function handlerGates(variant) {
	const common = {
		scenario: 'keyed-list',
		params: abParams(variant, 1000),
		size: 1000,
		iterations: 1,
		warmup: 0,
		invariant: keyedInvariant,
		prepare: ['clear', 'create-1k'],
		preExpect: { records: 1000 },
	};
	return [
		{
			...common,
			id: `handlers-${variant}/click-select/1000`,
			label: `click-select (${variant})`,
			op: 'click-select',
			expect: { records: 1000 },
			note: `click-select (${variant}) is a BEHAVIOUR GATE, not a measurement: it clicks the first row's label and throws unless the selection flipped in the store AND in the DOM. Ignore its timings.`,
		},
		{
			...common,
			id: `handlers-${variant}/click-remove/1000`,
			label: `click-remove (${variant})`,
			op: 'click-remove',
			expect: { records: 999 },
			note: `click-remove (${variant}) is a BEHAVIOUR GATE, not a measurement: it clicks the first row's remove button and throws unless that exact record left the store and the DOM. Ignore its timings.`,
		},
	];
}

export const OPS = [
	// ── keyed-list: every row mounted ───────────────────────────────────────
	// The control arm. Above 20,000 rows the view deliberately does not
	// auto-seed on mount (examples/stress/app/row-ops.js HEAVY_ROW_THRESHOLD),
	// so selecting n=50000 mounts empty and the prepare builds the list.
	...listOps('keyed-list', 1000, { invariant: keyedInvariant }),
	...listOps('keyed-list', 10000, { invariant: keyedInvariant }),
	...listOps('keyed-list', 50000, { invariant: keyedInvariant }),

	// ── virtual-list: same records, same row component, windowed ────────────
	...listOps('virtual-list', 1000, { invariant: windowedInvariant }),
	...listOps('virtual-list', 10000, { invariant: windowedInvariant }),
	...listOps('virtual-list', 50000, { invariant: windowedInvariant }),
	{
		id: 'virtual-list/fast-scroll/50000',
		label: 'fast-scroll',
		scenario: 'virtual-list',
		params: { n: 50000 },
		size: 50000,
		prepare: ['clear', 'create-50k'],
		op: 'fast-scroll',
		invariant: windowedInvariant,
		expect: { records: 50000 },
		note: 'fast-scroll drags the window across the whole list in 10 jumps; it is 10 window re-renders, not one op, and each jump re-queries + re-sorts the full 50k collection.',
	},

	// ── subscriptions: how much of the app wakes up for one write ───────────
	// Both modes are the SAME op over the SAME data; only the child data()'s
	// query differs. `notified` is a hard structural counter, not a timing.
	{
		id: 'subscriptions/update-one/precision',
		label: 'update-one (precision)',
		scenario: 'subscriptions',
		params: { mode: 'precision', n: 100, m: 10000 },
		size: 100,
		op: 'update-one',
		expect: { notified: 0, watchers: 100, records: 10000 },
		note: 'precision mode subscribes per record (sub|<id>); a write outside the watched window must wake ZERO of the 100 mounted views. Script time here sits at the performance.now() resolution floor.',
	},
	{
		id: 'subscriptions/update-one/fanout',
		label: 'update-one (fanout)',
		scenario: 'subscriptions',
		params: { mode: 'fanout', n: 100, m: 10000 },
		size: 100,
		op: 'update-one',
		expect: { notified: 100, watchers: 100, records: 10000 },
		note: 'fanout mode subscribes to the whole collection; the same write must wake ALL 100. notified < 100 means notifications are being dropped.',
	},

	// ── async-waterfall: do N independent async data() calls overlap? ────────
	{
		id: 'async-waterfall/remount/20',
		label: 'remount',
		scenario: 'async-waterfall',
		params: { n: 20, delay: 35 },
		size: 20,
		op: 'remount',
		expect: { maxInFlight: 1, cells: 20 },
		note:
			'delay is 35ms, not the example default of 50ms, ON PURPOSE. 20 cells x 50ms serialized lands at ~1000ms — indistinguishable from a single setTimeout clamp in a throttled tab, which is precisely the failure mode guard 4 exists to catch. 20 x 35ms lands at ~700ms; a clamped run would read ~20,000ms instead. maxInFlight is a census counter (1 = serialized, 20 = parallel), and it decides the verdict — the clock never does.',
	},

	// ── the handler A/B: identical ops, two handler spellings ───────────────
	// Appended rather than interleaved, so `npm run bench` still runs the
	// established suite first and unchanged. `--filter handlers-` runs ONLY this
	// comparison. Within each arm the behaviour gates come FIRST, so a variant
	// that stopped working fails before any of its numbers are believed.
	//
	// Arms are ordered 1000-inline, 1000-stable, 10000-inline, 10000-stable so
	// that each pair is adjacent in one browser session — four groups, four
	// scenario selects.
	...handlerGates("inline"),
	...handlerOps("inline", 1000),
	...handlerGates("stable"),
	...handlerOps("stable", 1000),
	...handlerOps("inline", 10000),
	...handlerOps("stable", 10000),
];

/** Consecutive entries sharing scenario + params, so select() runs once per group. */
export function groupOps(ops) {
	const groups = [];
	for (const op of ops) {
		const key = `${op.scenario}?${JSON.stringify(op.params)}`;
		const last = groups[groups.length - 1];
		if (last && last.key === key) last.ops.push(op);
		else groups.push({ key, scenario: op.scenario, params: op.params, ops: [op] });
	}
	return groups;
}

export default OPS;
