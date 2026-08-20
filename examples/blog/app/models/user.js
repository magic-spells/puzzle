import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class User extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7. String ids so the
  // server-loaded records upsert stably by primary key.
  static schema = {
    id:       Puzzle.string().primary(),
    name:     Puzzle.string().required(),
    email:    Puzzle.string(),
    role:     Puzzle.string().default('author'),
    bio:      Puzzle.string().default(''),
    joinedAt: Puzzle.date()
  };

  // Computed properties — plain getters (constellation/doc/DOC-SPEC.md §7).
  // Server-loaded dates arrive as ISO strings, so coerce defensively.
  get initials() {
    return String(this.name)
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  get memberSince() {
    return new Date(this.joinedAt);
  }

  // Server location (D21/D158): `findMany('user')` GETs /api/users.json.
  static adapter = {
    endpoint: '/users.json',

    // Same static-file mapping as Post — see app/models/post.js for why the
    // generated per-record GET does not fit this demo's "server".
    async loadOne(fetch, id) {
      const res = await fetch('/api/users.json');
      if (!res.ok) return res;
      const users = await res.json();
      return (
        users.find((user) => String(user.id) === String(id)) ??
        new Response(null, { status: 404 })
      );
    }
  };
}
