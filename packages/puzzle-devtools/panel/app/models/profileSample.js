import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * One `snapshot:profile` answer, kept whole.
 *
 * The profiler is the one place the panel POLLS (SPEC §55 defines no per-render
 * event — a render firehose would overrun both the page hook's pre-attach buffer
 * and the panel's 200-message ring), so a recording produces one of these per
 * poll tick. Each record is an immutable sample: the panel renders the newest,
 * and the ring behind it is what makes elapsed time and any future sparkline
 * possible without a second bookkeeping path.
 *
 * `id` is the panel's own monotonic sample sequence, not anything from the wire.
 * Like the event ring's, it only ever increases, so `findMany` insertion order
 * is also chronological order and the oldest sample is always at the head.
 *
 * The nested shapes stay RAW, exactly as the runtime sent them:
 *
 *   totals    { renders, wastedRenders, domMutations, dataRuns, storeFlushes,
 *               storeNotifications }
 *   views[]   { id, name, module, renders, wastedRenders, domMutations,
 *               renderMs, patchMs, dataMs, causes, memoHits, memoMisses,
 *               propsBailouts, propsReruns }
 *   flushes[] { at, keys, notified, durationMs }
 *   warnings[]{ kind, viewId, name, detail, count }
 *
 * Normalizing them into columns here would mean a schema migration every time
 * the framework adds a counter; `values.js` projects them for display instead,
 * and tolerates fields an older runtime omits.
 */
export default class ProfileSample extends PuzzleModel {
	static schema = {
		id: Puzzle.number().primary(),
		/** `Date.now()` when the answer landed — the panel's clock, not the page's. */
		at: Puzzle.number().default(0),
		/** The runtime's own view of whether it is still profiling. Authoritative. */
		recording: Puzzle.boolean().default(false),
		durationMs: Puzzle.number().default(0),
		totals: Puzzle.object().default(() => ({})),
		views: Puzzle.array().default(() => []),
		flushes: Puzzle.array().default(() => []),
		warnings: Puzzle.array().default(() => []),
	};
}
