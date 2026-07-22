import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class User extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7. String ids so the server-seeded
  // records (loadAll) upsert stably by primary key.
  static schema = {
    id:       Puzzle.string().primary(),
    name:     Puzzle.string().required(),
    email:    Puzzle.string(),
    role:     Puzzle.string().default('author'),
    bio:      Puzzle.string().default(''),
    joinedAt: Puzzle.date()
  };

  // Computed properties — plain getters (constellation/doc/DOC-SPEC.md §7).
  // loadAll-seeded dates arrive as ISO strings, so coerce defensively.
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

  // Server location (D21): consumed by store.loadAll('user') on the read path.
  // Write sync and custom adapter methods are post-v1.
  static adapter = {
    endpoint: '/users.json'
  };
}
