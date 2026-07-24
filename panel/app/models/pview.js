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
 * `snapshot:views` response as a tree — `parentId`/`childIds`/`depth` are
 * filled in only by the snapshot path, so they are null/empty until the panel
 * asks for one.
 */
export default class PView extends PuzzleModel {
	static schema = {
		id: Puzzle.number().primary(),
		name: Puzzle.string().default('View'),
		module: Puzzle.string().default(() => null),
		parentId: Puzzle.number().default(() => null),
		childIds: Puzzle.array().default(() => []),
		depth: Puzzle.number().default(0),
		/** false once `view-destroyed` arrives; the row greys out rather than vanishing. */
		live: Puzzle.boolean().default(true),
		/** The most recent `inspect:view` payload — { params, props, model, local }. */
		inspected: Puzzle.object().default(() => null),
		inspectedAt: Puzzle.number().default(0),
	};

	get label() {
		return this.module ? `${this.name} · ${this.module}` : this.name;
	}
}
