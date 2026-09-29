import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// The fields a Todo record carries. Puzzle records are dynamic — the schema
// below sets their fields at runtime — so this interface is the hand-written
// view of that schema the rest of the app types against. Keep the two in step.
export interface TodoFields {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export default class Todo extends PuzzleModel {
  // Schema definition — see constellation/doc/DOC-SPEC.md §7
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
    // The checkbox's implicit bind writes `completed` on its own; the explicit
    // handlers below stamp updatedAt as part of their richer write.
    updatedAt: Puzzle.date().default(() => new Date())
  };

  // Computed properties — plain getters (constellation/doc/DOC-SPEC.md §7)
  get isActive(): boolean {
    return !this.completed;
  }

  get formattedDate(): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(this.createdAt);
  }

  // Model-specific methods
  markComplete(): this {
    if (!this.completed) {
      return this.update({
        completed: true,
        updatedAt: new Date()
      });
    }
    return this;
  }

  markIncomplete(): this {
    if (this.completed) {
      return this.update({
        completed: false,
        updatedAt: new Date()
      });
    }
    return this;
  }

  // This model declares no server location, so it never fetches: findOne and
  // findMany are pure local reads over the store app/main.ts seeds. The upgrade
  // path to a real API is written out in app/main.ts.
}

// A Todo record: the model's methods and getters plus the schema's fields.
export type TodoRecord = Todo & TodoFields;
