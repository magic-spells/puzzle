import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Comment extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7. Comments are
  // created in the browser (createRecord), never fetched, so this model declares
  // NO adapter. The server read path is opt-in per model: with no endpoint and
  // no read verb, `findOne`/`findMany` on 'comment' stay pure local reads and
  // never issue a request, even inside data() (D161).
  static schema = {
    id:        Puzzle.string().primary(),
    postId:    Puzzle.string(),
    author:    Puzzle.string().default('Anonymous'),
    // the comment form (PostDetail.pzl) shows these messages through the
    // forms module, so they are written for the reader
    text:      Puzzle.string()
                 .required('Write a comment first')
                 .validate((text) => text.trim() !== '', 'Write a comment first')
                 .validate((text) => text.length <= 500, 'Keep it under 500 characters'),
    createdAt: Puzzle.date().default(() => new Date())
  };
}
