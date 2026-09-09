import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Host extends PuzzleModel {
  // Hosts are referenced by Listing.hostId. `superhost` is a boolean badge;
  // `accent` is a Puzzle.object() gradient (like artist.js) used to render a
  // deterministic avatar chip without any real photo.
  static schema = {
    id:           Puzzle.string().primary(),
    name:         Puzzle.string().required(),
    superhost:    Puzzle.boolean().default(false),
    yearsHosting: Puzzle.number().default(0),
    rating:       Puzzle.number(),
    reviewCount:  Puzzle.number(),
    bio:          Puzzle.string().default(''),
    accent:       Puzzle.object().default(() => ({ from: '#e8e8ee', to: '#d4d4de' })),
  };

  // Computed getters. initial drives the avatar letter; avatar turns the accent
  // object into a CSS gradient so templates read `style="background:{ host.avatar }"`.
  get initial() {
    return String(this.name || '?').trim().charAt(0).toUpperCase();
  }

  get avatar() {
    const a = this.accent || {};
    return `linear-gradient(135deg, ${a.from || '#e8e8ee'}, ${a.to || '#d4d4de'})`;
  }

  static adapter = {
    endpoint: '/hosts.json',
  };
}
