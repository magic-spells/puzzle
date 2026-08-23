import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// The block types the renderer understands. `oneOf` documents the contract;
// v1 stores the rule but defers enforcement (SPEC §7).
export const BLOCK_TYPES = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bullet',
  'numbered',
  'todo',
  'quote',
  'code',
  'divider',
];

// A Block is one line/unit of content within a Page, ordered by `order`.
export default class Block extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    pageId:    Puzzle.string().required(),
    type:      Puzzle.string().oneOf(BLOCK_TYPES).default('paragraph'),
    text:      Puzzle.string().default(''),
    checked:   Puzzle.boolean().default(false), // todo state
    indent:    Puzzle.number().default(0),      // 0–3 nesting steps
    order:     Puzzle.number().default(0),      // within-page sort key
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date()),
  };
}
