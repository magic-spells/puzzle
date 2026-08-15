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
 *
 * `held` is the subset of those ids whose subscription came from a PREPARED but
 * uncommitted `data()` run (D146). Those subscriptions are genuinely live — a
 * prepared ancestor is deliberately over-subscribed so a discarded navigation
 * can never weaken its coverage — so the runtime reports them in `byKey` too.
 * Splitting them out is what stops an open navigation from reading as a leak:
 * an ancestor listed against BOTH routes' keys is mid-flight, not broken.
 */
export default class Subscription extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		subscribers: Puzzle.array().default(() => []),
		count: Puzzle.number().default(0),
		/**
		 * Subscriber ids from `subscribers` whose hold on this key is pending a
		 * navigation commit. Always a subset of `subscribers`; empty on a runtime
		 * that predates `held`, which renders exactly as this panel used to.
		 */
		held: Puzzle.array().default(() => []),
		/** 'collection' for `todo`, 'record' for `todo t2`. */
		kind: Puzzle.string().default('collection'),
		/** `Date.now()` of the last flush naming this key; 0 once the pulse expires. */
		pulseAt: Puzzle.number().default(0),
	};
}
