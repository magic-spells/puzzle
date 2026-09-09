import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// The shape a Todo record exposes to templates and callers. Puzzle records are
// dynamic (fields come from the schema at runtime), so this interface is a
// hand-authored view of the fields we rely on — handy for typing props/data in
// the .pzl files below.
export interface TodoFields {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}

export default class Todo extends PuzzleModel {
  static schema = {
    id: Puzzle.string().primary(),
    text: Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
  };

  // Computed property — a plain getter, fully typed.
  get isActive(): boolean {
    return !this.completed;
  }

  toggle(): this {
    return this.update({ completed: !this.completed });
  }
}

// A Todo record is a PuzzleModel plus the schema fields above.
export type TodoRecord = Todo & TodoFields;
