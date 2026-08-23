import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// A deliberately tiny fake session for the route-guard acceptance case.
// Presence of the singleton record means the traveler has signed in.
export default class Session extends PuzzleModel {
  static schema = {
    id: Puzzle.string().primary(),
  };
}
