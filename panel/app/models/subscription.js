import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * One entry of `snapshot:subscriptions.byKey` — a store key and the views
 * currently subscribed to it.
 *
 * The primary key IS the store key, verbatim, because that is what a `flush`
 * names: a bare type (`todo`) for a collection query, or `type + REC_SEP + id`
 * (`todo t2`) for a single-record query. `kind` is derived from that shape and
 * is what splits the rail into its two groups.
 *
 * `subscribers` holds ids exactly as the runtime reported them — view-id
 * numbers plus the literal `'fn'` for the merged function-subscriber bucket
 * (SPEC §55: function subscribers have no stable identity to send).
 */
export default class Subscription extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		subscribers: Puzzle.array().default(() => []),
		count: Puzzle.number().default(0),
		/** 'collection' for `todo`, 'record' for `todo t2`. */
		kind: Puzzle.string().default('collection'),
		/** `Date.now()` of the last flush naming this key; 0 once the pulse expires. */
		pulseAt: Puzzle.number().default(0),
	};
}
