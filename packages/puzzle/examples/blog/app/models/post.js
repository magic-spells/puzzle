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
  // Server-loaded dates arrive as ISO strings, so coerce defensively.
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

  // Server location (D21/D158). The endpoint is all the generated REST reads
  // need: `findMany('post')` GETs apiURL + endpoint — /api/posts.json.
  static adapter = {
    endpoint: '/posts.json',

    // The generated `loadOne` would GET /api/posts.json/3, and this demo's
    // "server" is a static file per collection — there are no per-record URLs.
    // A model can replace any single verb with its own fetch function (D158),
    // so map the per-record read onto the collection file instead: read it,
    // pick the record out, and hand back a 404 Response for an id that is not
    // in it. The framework normalizes a non-OK Response into a
    // PuzzleAdapterError, and a 404 on the auto-fetch path becomes the
    // committed `null` that PostDetail's "Post not found" branch tests (D161).
    async loadOne(fetch, id) {
      const res = await fetch('/api/posts.json');
      if (!res.ok) return res;
      const posts = await res.json();
      return (
        posts.find((post) => String(post.id) === String(id)) ??
        new Response(null, { status: 404 })
      );
    }
  };
}
