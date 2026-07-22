import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Post extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7. authorId cross-references a User;
  // tags is an array that defaults to empty so a partial record still renders.
  static schema = {
    id:          Puzzle.string().primary(),
    title:       Puzzle.string().required(),
    body:        Puzzle.string().required(),
    authorId:    Puzzle.string(),
    tags:        Puzzle.array().default(() => []),
    publishedAt: Puzzle.date(),

    // Relationships (constellation/doc/DOC-SPEC.md §21, D49) — lazy store-backed
    // getters. `author` infers the FK 'authorId'; `comments` infers 'postId'
    // from this owner's registry type. Traverse them inside data() to subscribe.
    author:      Puzzle.belongsTo('user'),
    comments:    Puzzle.hasMany('comment')
  };

  // Computed properties — plain getters (constellation/doc/DOC-SPEC.md §7).
  // loadAll-seeded dates arrive as ISO strings, so coerce defensively.
  get publishedDate() {
    return new Date(this.publishedAt);
  }

  get excerpt() {
    const text = String(this.body);
    return text.length > 160 ? text.slice(0, 160).trimEnd() + '…' : text;
  }

  get readingTime() {
    const words = String(this.body).trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / 200));
  }

  // Server location (D21): consumed by store.loadAll('post') on the read path.
  static adapter = {
    endpoint: '/posts.json'
  };
}
