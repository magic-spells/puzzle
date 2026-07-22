import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// A tiny datastore-backed record. The demo binds several inputs to its fields,
// so every keystroke / drag writes into this record and every view reading it
// re-renders. The store is the single source of truth.
export default class Profile extends PuzzleModel {
  static schema = {
    id:          Puzzle.string().primary(),
    displayName: Puzzle.string().default('Ada Lovelace'),
    tagline:     Puzzle.string().default('First programmer'),
    hue:         Puzzle.number().default(220),        // blue swatch
    color:       Puzzle.string().default('#ff5fa2'),  // pink swatch
    notes:       Puzzle.string().default(
      '# Hello, Puzzle\n\nType **markdown** on the left and watch it *render* live on the right.\n\n- bound to the `profile#me` record\n- rendered on every store change\n\nInline `code` and [links](https://example.com) work too.'
    ),
  };

  // Computed getter — recalculates whenever the record changes.
  get initials() {
    return this.displayName
      .split(/\s+/)
      .map(word => word[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
}
