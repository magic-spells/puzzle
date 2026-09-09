import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * One model type in the inspected app's store — the panel-side mirror of a
 * `snapshot:records` bucket. The primary key is the type NAME, which is what
 * `snapshot:records { type? }` and `edit:record { type, id, patch }` take.
 *
 * `records` holds plain JSON rows exactly as the bridge serialized them
 * (`record.toJSON()` plus a `_synced` provenance flag). They are snapshots, not
 * live records: a `flush` event marks the bucket dirty, and the Store panel
 * re-requests.
 */
export default class RecordType extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		records: Puzzle.array().default(() => []),
		count: Puzzle.number().default(0),
		/** Set when a `flush` names a key in this type; cleared by the next snapshot. */
		dirty: Puzzle.boolean().default(false),
		snapshotAt: Puzzle.number().default(0),
	};
}
