import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Comment extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7. Comments are created in the browser
  // (createRecord), never seeded, so this model declares NO adapter — the server
  // read path (loadAll) is opt-in per model.
  static schema = {
    id:        Puzzle.string().primary(),
    postId:    Puzzle.string(),
    author:    Puzzle.string().default('Anonymous'),
    text:      Puzzle.string().required(),
    createdAt: Puzzle.date().default(() => new Date())
  };
}
