import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Post extends PuzzleModel {
  static schema = {
    id: Puzzle.number().primary(),
    title: Puzzle.string().required(),
    body: Puzzle.string().default(''),
    author: Puzzle.string().default(''),
    published: Puzzle.boolean().default(false),
  };

  // the rest shorthand: findMany('post', { query: { page: 2 } }) sends
  // GET /api/posts?page=2, findOne sends GET /api/posts/:id, and save()
  // sends PUT /api/posts/:id. the generated loadMany accepts a plain array
  // or { records, meta }, which is what the fixtures mock answers for a page.
  static adapter = { endpoint: '/posts' };
}
