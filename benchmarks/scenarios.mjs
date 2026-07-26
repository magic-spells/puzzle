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
	// Adjacent to fast-scroll so groupOps collapses them into one select.
	//
	// A BEHAVIOUR GATE, not a measurement: one iteration, no warmup, and its
	// milliseconds are meaningless — they are mostly the frames it waits between
	// scrollTop writes. Scroll events COALESCE, so the event count is not
	// deterministic and is deliberately absent from the counters; it is printed
	// in the op's detail line instead.
	{
		id: 'virtual-list/native-scroll/50000',
		label: 'native-scroll',
		scenario: 'virtual-list',
		params: { n: 50000 },
		size: 50000,
		iterations: 1,
		warmup: 0,
		prepare: ['clear', 'create-50k'],
		op: 'native-scroll',
		invariant: windowedInvariant,
		preExpect: { records: 50000 },
		expect: { records: 50000, vlGeometryOk: 1, vlWindowMatchesScroll: 1 },
		note: 'native-scroll is a BEHAVIOUR GATE, not a measurement — ignore its timings. It writes scrollTop 10 times and never calls applyScroll, so the real @scroll path (which fast-scroll bypasses for determinism) is the only thing moving the window. The two counters are the assertions: the spacers still add up to the full list height, and the mounted window agrees with the FINAL scrollTop rather than being left a bucket behind. How many frames that convergence needed is in the detail line.',
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

	// ── deep-nest: 64 branches x 24 levels = 1,536 real view instances ──────
	//
	// One counter decides all three: `nodeDataRuns`, the number of mounted views
	// that re-evaluated for a single write. `update-global` is the CONTROL and
	// must read the full 1,536 — without it, the `1` the other two report would
	// be indistinguishable from a scenario whose subscriptions never worked.
	...['update-leaf', 'update-branch-root', 'update-global'].map((op) => ({
		id: `deep-nest/${op}/1536`,
		label: op,
		scenario: 'deep-nest',
		params: { n: 64, depth: 24 },
		size: 1536,
		op,
		preExpect: { records: 1537 },
		expect: {
			records: 1537,
			views: 1537,
			nodes: 1536,
			nodeDataRuns: op === 'update-global' ? 1536 : 1,
		},
		note:
			op === 'update-global'
				? 'update-global is the control: one write to the record all 1,536 nodes query must wake all 1,536. Anything less means notifications are being dropped and the other two ops mean nothing.'
				: `${op} writes ONE record that exactly one node queries. nodeDataRuns of 1 means the update is proportional to neither depth nor forest size.`,
	})),

	// ── write-storm: burst only ─────────────────────────────────────────────
	//
	// `sustained` and `sustained-persist` are deliberately NOT here. They run for
	// a fixed 10 seconds, so their milliseconds are set by construction rather
	// than measured, and their flush counts track the host's real frame rate —
	// a counter that legitimately differs between machines has no business in a
	// committed baseline. They are structural measurements, taken once through
	// benchmarks/probe.mjs. The burst arms ARE deterministic: 5,000 writes inside
	// one synchronous tick, which the scheduler must collapse into one flush.
	...[false, true].map((persist) => ({
		id: `write-storm/burst${persist ? '-persist' : ''}/10000`,
		label: `burst${persist ? ' (persist)' : ''}`,
		scenario: 'write-storm',
		params: { n: 10000 },
		size: 5000,
		op: persist ? 'burst-persist' : 'burst',
		preExpect: { records: 10000 },
		expect: { records: 10000, stormWrites: 5000 },
		// Flush count is asserted as a BOUND, not an equality: the store arms a
		// rAF plus a 220ms fallback timer, and which one wins is a scheduling
		// detail. What must hold is that 5,000 writes do not become 5,000 flushes.
		invariant: (stats) =>
			stats.stormFlushes <= 3
				? null
				: `write-storm: ${stats.stormWrites} writes produced ${stats.stormFlushes} flushes — the rAF batching has stopped collapsing a synchronous burst`,
		note: persist
			? 'burst-persist attaches a memory storage shim so Store._persistNow() actually runs. One dirty flush = one full serialize of all 10,000 records; compare its time against plain burst to price persistence.'
			: 'burst issues 5,000 writes in one tick and never calls flush() by hand — letting the frame arrive IS the assertion.',
	})),

	// ── islands: 100 islands x 200 descendants, churned at frame rate ───────
	//
	// The timed arm is `shell-renders` (60 renders), NOT `shell-churn` (5,000ms).
	// A fixed-duration op's milliseconds are an input rather than a measurement,
	// and the harness's clamp guard rightly rejects them: measured, all three
	// shell-churn samples landed within 60ms of a whole second, which is precisely
	// the signature of the throttled renderer that guard exists to catch. Bounding
	// by render count measures the same code path and asserts the same counters
	// while leaving the clock free to say something.
	{
		id: 'islands/shell-renders/20000',
		label: 'shell-renders',
		scenario: 'islands',
		params: { n: 100, descendants: 200 },
		size: 20000,
		op: 'shell-renders',
		expect: {
			islandCount: 100,
			islandDescendants: 200,
			islandNodes: 20000,
			// THE assertion. Not "few", not "hopefully none" — exactly zero DOM
			// mutations below an island boundary, measured with a MutationObserver.
			islandViolations: 0,
			// And the cost of that guarantee: every descendant vnode is still
			// built on every render before the patcher discards the lot.
			islandChildVnodesPerRender: 20000,
			// The control. Zero island mutations means nothing if the shell never
			// mutated either.
			shellDidMutate: 1,
		},
		note: 'shell-renders re-renders the surrounding view 60 times. islandViolations must be 0 (island holds) while islandChildVnodesPerRender stays at the full 20,000 (the freeze saves patching, not allocation). The 5-second shell-churn arm measures the same thing on a clock and is deliberately not timed here.',
	},

	// ── formatters: the A/B that prices the built-in registry ───────────────
	//
	// `rerender` and `rerender-raw` are the SAME tree with the SAME per-row patch
	// work; only the two formatted spans differ. Neither carries any
	// instrumentation, so the difference between their timings is the formatters
	// and nothing else. `count-intl` runs the formatted arm again with Intl
	// patched — its COUNTS are exact, its milliseconds carry the probe.
	{
		id: 'formatters/rerender/10000',
		label: 'rerender (date + timeago)',
		scenario: 'formatters',
		params: { n: 10000 },
		size: 10000,
		op: 'rerender',
		preExpect: { records: 10000 },
		expect: { records: 10000, fmtRows: 10000, fmtFormatted: 1, fmtFormatterCalls: 0 },
		note: 'the formatted arm, with NO instrumentation of any kind. Subtract rerender-raw to price the two built-ins.',
	},
	{
		id: 'formatters/rerender-raw/10000',
		label: 'rerender (raw control)',
		scenario: 'formatters',
		params: { n: 10000 },
		size: 10000,
		op: 'rerender-raw',
		preExpect: { records: 10000 },
		expect: { records: 10000, fmtRows: 10000, fmtFormatted: 0, fmtFormatterCalls: 0 },
		note: 'the control arm: identical tree, identical 10,000-node patch, plain record strings instead of date() and timeago().',
	},
	{
		id: 'formatters/count-intl/10000',
		label: 'count-intl',
		scenario: 'formatters',
		params: { n: 10000 },
		size: 10000,
		op: 'count-intl',
		preExpect: { records: 10000 },
		// One Intl object constructed per formatter call, and 20,000 calls for
		// 10,000 rows. These are the numbers the whole scenario exists to pin.
		expect: {
			records: 10000,
			fmtRows: 10000,
			fmtDateTimeFormats: 10000,
			fmtRelativeTimeFormats: 10000,
			fmtFormatterCalls: 20000,
		},
		note: 'count-intl is instrumented: Intl is patched and the registry entries wrapped. Its counts are exact; its milliseconds include the probe and must NOT be compared against the other two arms.',
	},

	// ── route-churn: what a committed navigation costs a REUSED ancestor ────
	//
	// Only the UNPACED arms are here, and that is not a stylistic choice.
	// route-churn's other ops run at a fixed navigations/sec, which makes their
	// duration an input rather than a measurement — and worse, a 100-navigation
	// op at 10/sec lands on 10,000ms, which guard 4 (whole-second clustering)
	// would rightly reject. The paced arms exist because a DEVELOPMENT build's
	// D121 runaway-render detector fires on fast navigation over a deep route
	// tree; production has no detector, so the burst arms are both safe and
	// honest here.
	//
	// The counters are exact, deterministic, and the entire point. `navigate`
	// diverges at the LEAF, so `keep` (5) is less than the chain length (6) and
	// the router assembles + pushes the whole chain through the reused prefix
	// after having already refreshed it. `params` moves only `:id`, so
	// `keep === chain.length` and the params-only branch runs instead — the
	// control that proves the extra renders come from the cascade.
	{
		id: 'route-churn/navigate-burst/100',
		label: 'navigate-burst (leaf divergence)',
		scenario: 'route-churn',
		params: {},
		size: 100,
		op: 'navigate-burst-100',
		preExpect: { views: 7 },
		expect: {
			records: 0,
			views: 7,
			rcCommits: 100,
			rcLeafMounts: 100,
			rcLeafDataRuns: 100,
			// 2 renders per navigation for the reused root layout — the shape the
			// finding predicted. The nested levels are worse; see rcAncestorRenders.
			rcLayoutRenders: 200,
			rcLayoutDataRuns: 100,
			// 27 renders per navigation across layout + 5 levels, against 6 data()
			// runs. Per level that is 2,3,4,5,6,7: each reused ancestor's refresh
			// re-renders every descendant that holds slot children, so the reused
			// prefix costs O(depth^2) renders, not 2 per level.
			rcAncestorRenders: 2700,
			rcAncestorDataRuns: 600,
			// Every one of those mutations is at the divergence level (5 per
			// navigation, the leaf swap). Levels 0-4 mutate NOTHING, ever.
			rcAncestorMutations: 500,
		},
		note: 'navigate-burst is the headline: 100 leaf-divergence navigations over a 5-level chain. 27 ancestor renders and 6 data() runs per navigation, 2,200 of the 2,700 renders producing zero DOM mutations. rcAncestorMutations must stay at 500 — all of it at the divergence level.',
	},
	{
		id: 'route-churn/params-burst/100',
		label: 'params-burst (params-only control)',
		scenario: 'route-churn',
		params: {},
		size: 100,
		op: 'params-burst-100',
		preExpect: { views: 7 },
		expect: {
			records: 0,
			views: 7,
			rcCommits: 100,
			// ZERO. The params-only branch reuses the leaf INSTANCE, so it never
			// remounts — which is exactly what makes this a control rather than a
			// second copy of the arm above.
			rcLeafMounts: 0,
			rcLeafDataRuns: 100,
			rcLayoutRenders: 100,
			rcLayoutDataRuns: 100,
			rcAncestorRenders: 2100,
			rcAncestorDataRuns: 600,
			// The decisive one: not a single ancestor DOM mutation in 2,100
			// ancestor renders. Only the leaf's own text and data-leaf change.
			rcAncestorMutations: 0,
		},
		note: 'the CONTROL. keep === chain.length, so there is no applyParentUpdate cascade and no post-commit layout re-render: 21 ancestor renders per navigation instead of 27, and ALL 2,100 of them mutate nothing. If this arm also showed the extra renders, the finding would be about something other than the cascade.',
	},

	// ── listener-churn: what does rebinding a DOM listener actually cost? ────
	//
	// Three arms over IDENTICAL DOM and identical renders. `rerender` is the
	// uninstrumented timing arm; `count-listeners` is the same 30 renders with
	// Element.prototype patched, so its counts are exact and its milliseconds
	// carry the probe. Never compare across those two.
	//
	// The gates run first within each arm: `none` must prove that clicking does
	// NOTHING, the other two that it works, or an arm could be fast because it
	// quietly stopped binding anything.
	...[1000, 10000].flatMap((size) =>
		['churn', 'stable', 'none'].flatMap((binding) => {
			const params = { n: size, binding };
			const common = { scenario: 'listener-churn', params, size };
			const invariant = (stats) =>
				stats.mountedNodes === size * 7
					? null
					: `listener-churn: ${stats.mountedNodes} live elements for ${size} rows (want ${size * 7})`;
			const entries = [
				{
					...common,
					id: `listener-churn/rerender/${size}/${binding}`,
					label: `rerender (${binding})`,
					op: 'rerender',
					invariant,
					expect: { records: 0, lcRows: size, lcRenders: 20 },
					note:
						`rerender (${binding}) is the UNINSTRUMENTED timing arm: 20 renders of ${size} rows with no data change, so the DOM is identical before and after and the only work that differs between arms is the handler binding.` +
						(size === 10000
							? ' 20 renders, not 30, because at 30 the churn arm landed within 60ms of a whole second and guard 4 rejected the sample set — see RERENDER_COUNT in ListenerChurn.pzl.'
							: ''),
				},
			];
			// Structural counting only needs one size, and 10,000 rows makes the
			// per-render arithmetic unambiguous.
			if (size === 10000) {
				entries.push({
					...common,
					id: `listener-churn/count-listeners/${size}/${binding}`,
					label: `count-listeners (${binding})`,
					op: 'count-listeners',
					iterations: 3,
					invariant,
					expect:
						binding === 'churn'
							? {
									lcRows: size,
									lcRenders: 20,
									// 2 handlers per row, each removed and re-added: 4 calls per
									// row per render, 40,000 per render at 10,000 rows.
									lcAddListener: 400000,
									lcRemoveListener: 400000,
									lcListenerCallsPerRender: 40000,
								}
							: {
									lcRows: size,
									lcRenders: 20,
									// EXACTLY zero, and this is the whole finding: a cacheable
									// handler expression never reaches setAttr, so the listener is
									// never touched after mount.
									lcAddListener: 0,
									lcRemoveListener: 0,
									lcListenerCallsPerRender: 0,
								},
					note: `count-listeners (${binding}) is instrumented — Element.prototype's addEventListener/removeEventListener are patched by the scenario. Its counts are exact; its milliseconds include the probe and must NOT be compared against rerender. Capped at 3 iterations: the counts are algorithmic, not statistical.`,
				});
			}
			return entries;
		})
	),
	...['churn', 'stable', 'none'].map((binding) => ({
		id: `listener-churn/click-select/${binding}`,
		label: `click-select (${binding})`,
		scenario: 'listener-churn',
		params: { n: 1000, binding },
		size: 1000,
		op: 'click-select',
		iterations: 1,
		warmup: 0,
		expect: { lcRows: 1000 },
		note: `click-select (${binding}) is a BEHAVIOUR GATE, not a measurement. ${binding === 'none' ? 'The none arm binds no handler at all, so it throws unless the click is INERT.' : 'It dispatches a real click and throws unless the selection flipped in state and in the DOM.'} Ignore its timings.`,
	})),

	// loop-trap is deliberately absent. It is a CORRECTNESS exercise for the D121
	// loop detector, which devperf compiles out of a production build entirely —
	// so in this harness's bundle there is nothing to detect anything, and every
	// counter it reports would be a fabricated zero. Run it through
	// benchmarks/probe.mjs, which builds in development mode.
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
