import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * A toast is a real store record, not view state. That is the whole point of
 * the toast demo: ANY view can call `store.createRecord('toast', …)` and the
 * single portaled <ToastStack> — which subscribed by querying toasts inside
 * its own data() — re-renders. The trigger and the overlay never talk to each
 * other directly.
 */
export default class Toast extends PuzzleModel {
  static schema = {
    id: Puzzle.string().primary(),
    kind: Puzzle.string().oneOf(['success', 'error', 'info']).default('info'),
    message: Puzzle.string().required().min(1, 'A toast needs a message'),
    // 0 pins the toast open until it is dismissed by hand.
    ttl: Puzzle.number().default(4000),
    createdAt: Puzzle.date().default(() => new Date()),
  };

  get icon() {
    if (this.kind === 'success') return '✓';
    if (this.kind === 'error') return '!';
    return 'i';
  }
}
