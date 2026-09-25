import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// The cart lives in the store, not in a view's setData(): a language switch
// rebuilds every routed view, and store records are what survives it.
export default class Cart extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		count: Puzzle.number().default(2),
	};
}
