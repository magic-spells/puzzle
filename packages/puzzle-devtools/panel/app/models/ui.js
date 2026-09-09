import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/** The record id of the one UI record. There is never a second. */
export const UI_ID = 'main';

/**
 * Singleton: panel-to-panel intent that has to survive a route change.
 *
 * The Subscriptions panel can say "show me this view in the Views panel", but
 * the Views panel does not exist yet at click time — the router mounts it after
 * the navigation commits. Passing the id through the store rather than through
 * a route param keeps the panel URLs clean (they are just tab names) and means
 * the Views panel reads it the same way it reads everything else: a subscribed
 * query in `data()`.
 *
 * The consumer CLEARS the field once it has acted, so a later manual visit to
 * /views does not re-apply a stale selection.
 */
export default class Ui extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		/** A view id the Views panel should select on its next mount/refresh. */
		pendingViewId: Puzzle.number().default(() => null),
	};
}
