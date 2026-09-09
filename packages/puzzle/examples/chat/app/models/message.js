import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// One message in a conversation. `role` is 'user' | 'assistant' | 'system' |
// 'error' (MessageBubble switches on it with {#case}). `pending` is true while
// the assistant reply is still streaming — the caret blinks and the composer
// stays disabled until it flips false. Content is updated token-by-token
// THROUGH THE STORE so both the thread and the sidebar re-render (see Thread.pzl).
export default class Message extends PuzzleModel {
  static schema = {
    id:             Puzzle.string().primary(),
    conversationId: Puzzle.string().required(),
    role:           Puzzle.string().required(),
    content:        Puzzle.string().default(''),
    pending:        Puzzle.boolean().default(false),
    model:          Puzzle.string().default('puzzle-core'),
    createdAt:      Puzzle.date().default(() => new Date()),
  };
}
