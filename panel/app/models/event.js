import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * One received protocol message, for the debug event list.
 *
 * The collection is a capped ring: `EVENT_LIMIT` in bridge.js destroys the
 * oldest record whenever a new one pushes past the cap, so an app that flushes
 * on every keystroke cannot grow the panel's memory without bound. `id` is the
 * hook's per-page-load sequence number, which also gives the list a stable sort
 * that survives same-millisecond bursts.
 */
export default class DevEvent extends PuzzleModel {
	static schema = {
		id: Puzzle.number().primary(),
		type: Puzzle.string().default('?'),
		at: Puzzle.number().default(0),
		/** One-line human summary rendered in the list; the full payload sits behind it. */
		summary: Puzzle.string().default(''),
		payload: Puzzle.object().default(() => ({})),
	};

	get time() {
		if (!this.at) return '';
		const d = new Date(this.at);
		const pad = (n, width = 2) => String(n).padStart(width, '0');
		return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
	}
}
