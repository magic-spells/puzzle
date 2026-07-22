import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Trip extends PuzzleModel {
  // A booking. `status` is a simple lifecycle string ('upcoming' | 'completed').
  // Locally-created reservations use ids prefixed 't-local-' so app.js can find
  // and re-seed them after a reload (the in-memory store is not persistent).
  static schema = {
    id:        Puzzle.string().primary(),
    listingId: Puzzle.string().required(),
    checkIn:   Puzzle.string().required(),  // ISO yyyy-mm-dd
    checkOut:  Puzzle.string().required(),  // ISO yyyy-mm-dd
    status:    Puzzle.string().default('upcoming'),
  };

  // Whole nights between checkIn and checkOut via Date math. Guards against bad
  // dates by clamping to 0 so a template never shows a negative night count.
  get nights() {
    const a = new Date(`${this.checkIn}T00:00:00`);
    const b = new Date(`${this.checkOut}T00:00:00`);
    const ms = b - a;
    if (!Number.isFinite(ms)) return 0;
    return Math.max(0, Math.round(ms / 86_400_000));
  }

  static adapter = {
    endpoint: '/trips.json',
  };
}
