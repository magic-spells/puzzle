/**
 * The row mutation set shared by `keyed-list` and `virtual-list`.
 *
 * Both scenarios drive the SAME store type with the SAME ops off the SAME
 * fixture seed — that is what makes the A/B meaningful. The only difference
 * between them is how many rows they mount. Keeping the mutations here means
 * neither scenario can quietly drift into doing less work than the other.
 */

import { STRESS_SEED, bySeq, clearType, seqShapes } from './scenario-utils.js';

/** The shared record type. Both list scenarios read and write this. */
export const ROW_TYPE = 'row';

/** Appended to every 10th label by `update-every-10th` (js-framework-benchmark). */
export const MARK = ' !!!';

const SWAP_A = 2;
const SWAP_B = 999;
const REMOVE_AT = 4;
/**
 * The single row `update-one` edits — the D170 gate op. Deliberately NOT row 0:
 * a list whose caching only worked at the ends would still pass at index 0.
 */
const UPDATE_ONE_AT = 500;
// Alternating, so pressing `select-row` twice always does real work.
const SELECT_SLOTS = [1, 2];

/**
 * Above this row count the FULL-DOM list is genuinely dangerous — 20k rows is
 * already 140k elements — so `keyed-list` will not seed it without an explicit
 * second click. `virtual-list` has no such limit; that is the entire point.
 */
export const HEAVY_ROW_THRESHOLD = 20000;

export class RowOps {
	constructor(store, type = ROW_TYPE) {
		this.store = store;
		this.type = type;
		this.nextSeq = 0;
		this.lastSwap = null;
		this.markedUpTo = 0;
		this.selectSlot = 0;
		this.selectedId = null;
		// `reorder` flips this instead of writing to 1,000 records. A reorder that
		// mutated every row's `seq` would advance every row's render revision and
		// rebuild the whole list — measuring "update all" under a reorder's name.
		// The DISPLAY order is a property of the view, so that is where it lives.
		this.reversed = false;
	}

	/** Records sorted into display order. */
	ordered() {
		const rows = this.store.findMany(this.type);
		rows.sort(bySeq);
		if (this.reversed) rows.reverse();
		return rows;
	}

	count() {
		return this.store.findMany(this.type).length;
	}

	/** Clear the type, rewind the fixture stream, seed `count` rows. */
	freshSeed(count) {
		clearType(this.store, this.type);
		// Safe ONLY because the type was just emptied: resetFixtureSeed rewinds the
		// shared fixture index, so generated ids (`row-1`, `row-2`, …) restart and
		// would collide with any surviving record of this type.
		this.store.resetFixtureSeed(STRESS_SEED);
		this.nextSeq = 0;
		this.lastSwap = null;
		this.markedUpTo = 0;
		this.reversed = false;
		this.appendSeed(count);
	}

	/** Seed `count` more rows after the existing ones (no seed rewind). */
	appendSeed(count) {
		if (count <= 0) return [];
		const records = this.store.seed(this.type, seqShapes(count, this.nextSeq));
		this.nextSeq += count;
		return records;
	}

	clear() {
		clearType(this.store, this.type);
		this.lastSwap = null;
		this.markedUpTo = 0;
		this.reversed = false;
	}

	/**
	 * Edit exactly ONE record's fields — the D170 single-edit gate
	 * (`benchmarks/scenarios.mjs`, `list-update-1`).
	 *
	 * One `update()` on one record in a list of N. Everything the list block
	 * claims rests on this op: N-1 rows must come back from the row cache by
	 * reference and the patcher must short-circuit them, so exactly one row's
	 * vnodes are rebuilt and exactly one child view re-runs data().
	 */
	updateOne(ordered) {
		if (!ordered.length) return;
		// Marker assertions describe "every 10th row of the first markedUpTo", which
		// a single mid-list edit does not satisfy — drop them for this op.
		this.markedUpTo = 0;
		const row = ordered[Math.min(UPDATE_ONE_AT, ordered.length - 1)];
		row.update({ label: row.label + MARK, version: (row.version || 0) + 1 });
	}

	/** Edit EVERY record — the upper bound of the same measurement. */
	updateAll(ordered) {
		for (let i = 0; i < ordered.length; i += 1) {
			ordered[i].update({ label: ordered[i].label + MARK, version: (ordered[i].version || 0) + 1 });
		}
		// Every row is marked, so the every-10th sweep in validate() is a subset.
		this.markedUpTo = ordered.length;
	}

	/**
	 * Reverse the DISPLAY order without touching a single record.
	 *
	 * The point of the op is the patcher's move path over CACHED rows: the item
	 * references and their render revisions are unchanged, so every row must come
	 * back from the cache and the only work is DOM moves (and FLIP, where a
	 * scenario declares it). Writing `seq` on every record instead would advance
	 * every revision and turn this into `update-all` wearing a reorder's name.
	 */
	reorder() {
		this.reversed = !this.reversed;
		// Both positional assertions describe the pre-reversal order.
		this.lastSwap = null;
		this.markedUpTo = 0;
	}

	updateEveryTenth(ordered) {
		for (let i = 0; i < ordered.length; i += 10) {
			ordered[i].update({ label: ordered[i].label + MARK, version: (ordered[i].version || 0) + 1 });
		}
		// How far the marking reached: `append-1k` adds unmarked rows past this
		// point, and validate() must not assert the marker across them.
		this.markedUpTo = ordered.length;
	}

	selectNth(ordered) {
		if (!ordered.length) return;
		const previous = this.selectedId ? this.store.findOne(this.type, this.selectedId) : null;
		if (previous && previous.selected) previous.update({ selected: false });
		const index = Math.min(SELECT_SLOTS[this.selectSlot % SELECT_SLOTS.length], ordered.length - 1);
		this.selectSlot += 1;
		ordered[index].update({ selected: true });
		this.selectedId = ordered[index].id;
	}

	swapRows(ordered) {
		if (ordered.length < 2) return;
		const a = Math.min(SWAP_A, ordered.length - 1);
		let b = Math.min(SWAP_B, ordered.length - 1);
		if (a === b) b = a > 0 ? a - 1 : ordered.length - 1;
		if (a === b) return;
		const rowA = ordered[a];
		const rowB = ordered[b];
		const seqA = rowA.seq;
		const seqB = rowB.seq;
		rowA.update({ seq: seqB });
		rowB.update({ seq: seqA });
		this.lastSwap = { a, b, idA: rowA.id, idB: rowB.id };
	}

	removeNth(ordered) {
		if (!ordered.length) return;
		// Every position after the removed one shifts by one, so BOTH positional
		// assertions stop describing the DOM. Drop them rather than let validate()
		// report a false failure.
		this.lastSwap = null;
		this.markedUpTo = 0;
		ordered[Math.min(REMOVE_AT, ordered.length - 1)].destroy();
	}

	/**
	 * Apply one op. `ordered` is the caller's cached display order (already sorted
	 * for the current render), so an op never pays for a second sort inside the
	 * measured window.
	 *
	 * @returns {boolean} true when the op was recognised
	 */
	apply(op, ordered, { fallbackCount = 1000 } = {}) {
		switch (op) {
			case 'create-1k':
				this.freshSeed(1000);
				return true;
			case 'create-10k':
				this.freshSeed(10000);
				return true;
			case 'create-50k':
				this.freshSeed(50000);
				return true;
			case 'replace-all':
				this.freshSeed(ordered.length || fallbackCount);
				return true;
			case 'append-1k':
				this.appendSeed(1000);
				return true;
			case 'clear':
				this.clear();
				return true;
			case 'update-every-10th':
				this.updateEveryTenth(ordered);
				return true;
			case 'update-one':
				this.updateOne(ordered);
				return true;
			case 'update-all':
				this.updateAll(ordered);
				return true;
			case 'reorder':
				this.reorder();
				return true;
			case 'select-row':
				this.selectNth(ordered);
				return true;
			case 'swap-rows':
				this.swapRows(ordered);
				return true;
			case 'remove-row':
				this.removeNth(ordered);
				return true;
			default:
				return false;
		}
	}
}

/**
 * Compare a run of rendered row elements against the records they should be
 * showing. `offset` is the index in `expected` that `rowEls[0]` corresponds to,
 * which is 0 for the full list and the window start for the virtual one.
 *
 * @returns {string|null} a failure description, or null when everything matches
 */
export function mismatchInRows(rowEls, expected, offset = 0) {
	for (let i = 0; i < rowEls.length; i += 1) {
		const record = expected[offset + i];
		if (!record) return `rendered row ${offset + i} has no matching record`;
		const shown = rowEls[i].querySelector('.kl-id')?.textContent?.trim();
		if (shown !== String(record.id)) {
			return `row ${offset + i}: DOM shows "${shown}", store order says "${record.id}"`;
		}
	}
	return null;
}
