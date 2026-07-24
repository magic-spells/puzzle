import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * One live PuzzleView in the inspected page.
 *
 * `id` is the runtime's session-scoped integer (SPEC §55 "Identity") — assigned
 * by a WeakMap in the bridge, never reused within a page session and reset by
 * every reload. `module` is the codegen `__pzlModule` stamp (app-relative .pzl
 * path) or null for a hand-written class.
 *
 * Records arrive from `view-mounted` events one at a time, and from a
 * `snapshot:views` response as a tree — `parentId`/`childIds`/`depth`/`order`
 * are filled in only by the snapshot path, so a view that mounted since the
 * last snapshot is a depth-0 orphan until the next one lands (which the same
 * event schedules).
 */
export default class PView extends PuzzleModel {
	static schema = {
		id: Puzzle.number().primary(),
		name: Puzzle.string().default('View'),
		module: Puzzle.string().default(() => null),
		parentId: Puzzle.number().default(() => null),
		childIds: Puzzle.array().default(() => []),
		depth: Puzzle.number().default(0),
		/**
		 * Pre-order position in the last `snapshot:views`. The tree renders in this
		 * order, which is the runtime's own mount order — so a re-snapshot never
		 * shuffles rows that did not actually move.
		 */
		order: Puzzle.number().default(0),
		/** false once `view-destroyed` arrives, or when a snapshot stops naming it. */
		live: Puzzle.boolean().default(true),
		/**
		 * `Date.now()` of the last `flush` whose `notified` list named this view;
		 * 0 once the pulse expires. Drives the Views panel's re-render flash.
		 */
		pulseAt: Puzzle.number().default(0),
		/** The most recent `inspect:view` payload — { params, props, model, local }. */
		inspected: Puzzle.object().default(() => null),
		inspectedAt: Puzzle.number().default(0),
	};

	get label() {
		return this.module ? `${this.name} · ${this.module}` : this.name;
	}
}
