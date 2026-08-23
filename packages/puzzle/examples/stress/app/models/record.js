import { Puzzle, PuzzleModel } from '@magic-spells/puzzle';

/**
 * One record shape for every scenario. The fixtures module generates values from
 * this schema alone (`store.seed`), so the fields are chosen to be
 * generation-friendly: `label` yields two capitalized words, `text` a short
 * sentence, `value`/`group` integers in [0, 100], `createdAt` a date derived
 * from the fixture seed rather than the clock.
 *
 * Fields carrying `.default()` are SKIPPED by the generator (the store's
 * applyDefaults owns them), which is exactly right for the three fields the
 * scenarios drive by hand:
 *
 *   seq      — explicit ordering (see seqShapes in scenario-utils.js). A
 *              generated value would be a random 0–100 and list order would
 *              become meaningless.
 *   version  — bumped by write ops; starting at 0 makes a rendered "v0" a fact
 *              rather than a coin flip.
 *   selected — a generated boolean would randomly highlight ~half the rows.
 */
export default class StressRecord extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary().required(),
		seq: Puzzle.number().default(0),
		label: Puzzle.string(),
		text: Puzzle.string(),
		value: Puzzle.number(),
		version: Puzzle.number().default(0),
		selected: Puzzle.boolean().default(false),
		group: Puzzle.number(),
		createdAt: Puzzle.date(),
	};
}
