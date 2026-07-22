import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// A Page is one document in the grimoire. Blocks belong to it by pageId.
export default class Page extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    title:     Puzzle.string().default('Untitled'),
    icon:      Puzzle.string().default('📄'), // an emoji sigil
    order:     Puzzle.number().default(0),    // sidebar sort key
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date()),
  };
}
