import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Post extends PuzzleModel {
  // Schema — see constellation/doc/DOC-SPEC.md §7. A chirp (post). Seed rows use
  // 'c-001'… ids; chirps composed in the browser get 'c-local-<n>' ids so app.js
  // knows which ones to persist. `body` is plain text that may contain
  // @mentions and #hashtags — ChirpCard parses those into segments at render
  // time, the store just holds the raw string.
  //
  // `replyToId === ''` marks a top-level chirp; anything else is a reply whose
  // parent is that chirp (the reply tree can nest arbitrarily deep). `liked` and
  // `rechirped` are local-only and mirrored to localStorage by app.js.
  static schema = {
    id:           Puzzle.string().primary(),   // seed: 'c-001'…; browser-created: 'c-local-<n>'
    authorId:     Puzzle.string().required(),
    body:         Puzzle.string().required(),  // may contain @mentions and #hashtags as plain text
    createdAt:    Puzzle.string().required(),  // full ISO datetime
    replyToId:    Puzzle.string().default(''), // '' = top-level chirp
    likeCount:    Puzzle.number().default(0),
    rechirpCount: Puzzle.number().default(0),
    replyCount:   Puzzle.number().default(0),
    liked:        Puzzle.boolean().default(false),    // local-only
    rechirped:    Puzzle.boolean().default(false),    // local-only
  };

  // A reply has a non-empty parent id. Templates read `{ post.isReply }` to
  // decide whether to show the "Replying to @x" line.
  get isReply() {
    return this.replyToId !== '';
  }

  // Flip the local like flag and keep the visible count in step, in a SINGLE
  // update() so subscribers re-render exactly once (D18 patch path).
  toggleLike() {
    const next = !this.liked;
    return this.update({
      liked: next,
      likeCount: Math.max(0, (this.likeCount || 0) + (next ? 1 : -1)),
    });
  }

  // Same shape as toggleLike, for the rechirp (retweet) button.
  toggleRechirp() {
    const next = !this.rechirped;
    return this.update({
      rechirped: next,
      rechirpCount: Math.max(0, (this.rechirpCount || 0) + (next ? 1 : -1)),
    });
  }

  // Server location (D21): consumed by store.loadAll('post') on the read path.
  static adapter = {
    endpoint: '/posts.json',
  };
}
