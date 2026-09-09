import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Traveler extends PuzzleModel {
  // The signed-in user (a single record, id 'me'). `stamps` is a Puzzle.array()
  // of passport-style entries — each { city, country, year, icon, accent } —
  // rendered on the profile page. Seeded from JSON as real nested objects.
  static schema = {
    id:     Puzzle.string().primary(),
    name:   Puzzle.string().required(),
    home:   Puzzle.string().default(''),
    joined: Puzzle.number(), // year the traveler joined
    bio:    Puzzle.string().default(''),
    stamps: Puzzle.array().default(() => []),
  };

  static adapter = {
    endpoint: '/traveler.json',
  };
}
