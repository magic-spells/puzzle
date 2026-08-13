import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class User extends PuzzleModel {
  // Schema — see constellation/doc/DOC-SPEC.md §7. A Chirp account. `id` is 'me'
  // for the signed-in user and 'u-<slug>' for everyone else. `handle` is stored
  // WITHOUT the leading '@' (the `at` getter adds it). The avatar/banner stops
  // are plain hex strings the getters weave into CSS gradients — this demo has
  // no image assets, every avatar is a generated gradient chip with an emoji.
  //
  // `followedByMe` is local-only wishlist-style state: it starts from the seed,
  // is flipped by toggleFollow(), and app.js mirrors it to localStorage (never
  // to a server in this demo).
  static schema = {
    id:             Puzzle.string().primary(),      // 'me' for the signed-in user, else 'u-<slug>'
    handle:         Puzzle.string().required(),     // no '@', e.g. 'adalace'
    name:           Puzzle.string().required(),
    bio:            Puzzle.string(),
    location:       Puzzle.string(),
    joined:         Puzzle.string(),                // ISO date 'YYYY-MM-DD'
    verified:       Puzzle.boolean().default(false),
    followerCount:  Puzzle.number().default(0),
    followingCount: Puzzle.number().default(0),
    followedByMe:   Puzzle.boolean().default(false), // local-only, persisted to localStorage
    avatarFrom:     Puzzle.string(),                // hex gradient stop
    avatarTo:       Puzzle.string(),                // hex gradient stop
    avatarIcon:     Puzzle.string(),                // one emoji
    bannerFrom:     Puzzle.string(),                // profile banner gradient stops
    bannerTo:       Puzzle.string(),
  };

  // '@handle' for one-line display — templates read `{ user.at }` and never have
  // to remember whether the stored handle carries the '@'.
  get at() {
    return `@${this.handle}`;
  }

  // Turn the two avatar stops into a ready-to-use CSS gradient so templates read
  // `style="background:{ user.avatarBg }"` instead of rebuilding it each time
  // (mirrors listing.js's `cover` getter, with dark fallbacks).
  get avatarBg() {
    return `linear-gradient(135deg, ${this.avatarFrom || '#3e4144'}, ${this.avatarTo || '#16181c'})`;
  }

  get bannerBg() {
    return `linear-gradient(135deg, ${this.bannerFrom || '#1d1f23'}, ${this.bannerTo || '#000000'})`;
  }

  // Toggle the local follow flag AND keep the visible follower count in step, in
  // a SINGLE update() so subscribers re-render once. app.js persists the set of
  // followed ids to localStorage, so keeping this mutation in one testable place
  // matters.
  toggleFollow() {
    const next = !this.followedByMe;
    return this.update({
      followedByMe: next,
      followerCount: Math.max(0, (this.followerCount || 0) + (next ? 1 : -1)),
    });
  }

  // Server location (D21): consumed by store.loadAll('user') on the read path.
  static adapter = {
    endpoint: '/users.json',
  };
}
