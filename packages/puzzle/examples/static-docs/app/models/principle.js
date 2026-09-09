import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// A deliberately trivial model (SPEC §7). Its only job in this example is to be
// seeded at build time in app.js `beforeMount` and read back in the About view's
// data(), so build-time data ends up in the prerendered HTML.
export default class Principle extends PuzzleModel {
  static schema = {
    id:    Puzzle.string().primary(),
    title: Puzzle.string().required(),
    body:  Puzzle.string().required(),
  };
}
