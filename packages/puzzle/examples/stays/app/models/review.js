import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Review extends PuzzleModel {
  // Reviews reference their listing by listingId; views join them via
  // store.findMany('review', { filter: (r) => r.listingId === id }). `accent` is
  // a Puzzle.object() gradient reused for the reviewer avatar chip (like host.js).
  static schema = {
    id:        Puzzle.string().primary(),
    listingId: Puzzle.string().required(),
    author:    Puzzle.string().required(),
    city:      Puzzle.string().default(''),
    date:      Puzzle.string().default(''), // ISO yyyy-mm-dd
    rating:    Puzzle.number(),
    text:      Puzzle.string().default(''),
    accent:    Puzzle.object().default(() => ({ from: '#e8e8ee', to: '#d4d4de' })),
  };

  get initial() {
    return String(this.author || '?').trim().charAt(0).toUpperCase();
  }

  get avatar() {
    const a = this.accent || {};
    return `linear-gradient(135deg, ${a.from || '#e8e8ee'}, ${a.to || '#d4d4de'})`;
  }

  static adapter = {
    endpoint: '/reviews.json',
  };
}
