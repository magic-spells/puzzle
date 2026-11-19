import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Comment extends PuzzleModel {
  static schema = {
    id: Puzzle.number().primary(),
    postId: Puzzle.number(),
    author: Puzzle.string().default(''),
    body: Puzzle.string().default(''),
  };

  // GET /api/comments?after=<last id>&limit=5 answers one cursor page
  static adapter = { endpoint: '/comments' };
}
