import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Task extends PuzzleModel {
  static schema = {
    id:     Puzzle.string().primary(),
    title:  Puzzle.string().required(),
    status: Puzzle.string().default('todo'),
    order:  Puzzle.number().default(0),
  };
}
