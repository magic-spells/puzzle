// Compiled fixture — the canonical Todo model for the integration suite
// described in constellation/doc/DOC-TESTING.md.
//
// Semantically identical to examples/todos/app/models/todo.js. The ONLY change is
// the import specifier: the published package name '@magic-spells/puzzle' has no
// alias in this repo's vitest config, so the fixture imports the runtime by
// relative path. Everything below the import is byte-for-byte the user's model.
import { PuzzleModel, Puzzle } from '../../../client-runtime/index.js';

export default class Todo extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date())
  };

  // Computed properties — plain getters (constellation/doc/DOC-SPEC.md §7)
  get isActive() {
    return !this.completed;
  }

  get formattedDate() {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(this.createdAt);
  }

  // Model-specific methods
  toggle() {
    return this.update({
      completed: !this.completed,
      updatedAt: new Date()
    });
  }

  markComplete() {
    if (!this.completed) {
      return this.update({
        completed: true,
        updatedAt: new Date()
      });
    }
    return this;
  }

  markIncomplete() {
    if (this.completed) {
      return this.update({
        completed: false,
        updatedAt: new Date()
      });
    }
    return this;
  }

  // Server location (D21): consumed by store.loadAll('todo') / loadOne on
  // the read path. Write sync and custom adapter methods are post-v1.
  static adapter = {
    endpoint: '/api/todos',
  };
}
