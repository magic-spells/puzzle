import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Notification extends PuzzleModel {
  // Schema — see constellation/doc/DOC-SPEC.md §7. An activity notification aimed
  // at the signed-in user. `type` picks the sentence + icon in NotificationRow
  // via {#case} (D37). `actorId` is the user who did the thing; `postId` is the
  // chirp it happened to ('' for a plain follow). `read` is local-only and
  // mirrored to localStorage — marking one read drains the layout's unread badge
  // live, because the layout subscribes to the unread query (cross-page
  // reactivity showpiece).
  static schema = {
    id:        Puzzle.string().primary(),  // 'n-001'…
    type:      Puzzle.string().required(), // 'like' | 'rechirp' | 'follow' | 'reply' | 'mention'
    actorId:   Puzzle.string().required(), // user who did it
    postId:    Puzzle.string().default(''),// relevant chirp ('' for follow)
    createdAt: Puzzle.string().required(),
    read:      Puzzle.boolean().default(false), // local-only, persisted
  };

  // Server location (D21): consumed by store.loadAll('notification').
  static adapter = {
    endpoint: '/notifications.json',
  };
}
