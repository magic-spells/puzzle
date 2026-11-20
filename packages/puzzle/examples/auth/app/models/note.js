import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * a private note. the endpoint makes this model server-backed: findMany('note')
 * in data() sends GET /api/notes, and save() sends POST /api/notes. the mock
 * backend answers 401 unless the request carries a live access token, and it
 * only ever returns the signed-in user's own notes.
 */
export default class Note extends PuzzleModel {
  static schema = {
    id: Puzzle.number().primary(),
    text: Puzzle.string().required('Write something first.'),
    createdAt: Puzzle.string().default(''),
  };

  static adapter = { endpoint: '/notes' };
}
