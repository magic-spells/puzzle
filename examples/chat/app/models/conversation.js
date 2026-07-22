import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// A chat thread. Records live only in the in-memory store (seeded post-mount by
// app/lib/seed.js); there is no server, so no adapter block. `updatedAt` is
// bumped on every new message so the sidebar can sort most-recent-first and the
// list reorders reactively as replies stream in.
export default class Conversation extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    title:     Puzzle.string().required(),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date()),
  };

  // A freshly-created thread carries the default title until its first user
  // message names it; the sidebar shows this so an unnamed row never renders blank.
  get displayTitle() {
    return this.title && this.title.trim() ? this.title : 'New chat';
  }
}
