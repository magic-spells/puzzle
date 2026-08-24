import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

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

  // Server location (D21/D157/D161). The endpoint is joined onto the app's
  // apiURL, so `findMany('todo')` GETs /api/todos.json — a static JSON file
  // copied from app/public/api/ into dist/api/ at build time, so this app has
  // a working "server" the moment you run `puzzle dev`. A tracked
  // findOne/findMany in a view's data() fetches whatever the store is missing
  // and settles before the view commits — no loading code. The adapter
  // capability is passed once in app.js.
  //
  // Point `endpoint` at your own API when you have one. No backend at all?
  // Delete this block, app/adapter.js, the app.js adapter import/key, and
  // app/public/api/ — a model with no endpoint and no read verb keeps
  // findOne/findMany as pure local reads, and everything else still works.
  static adapter = {
    endpoint: '/todos.json',

    // The generated `loadOne` would GET /api/todos.json/t3, and this starter's
    // "server" is one static file for the whole collection — there are no
    // per-record URLs. A model can replace any single verb with its own fetch
    // function (D158), so map the per-record read onto the collection file:
    // read it, pick the record out, and hand back a 404 Response for an id
    // that is not in it. The framework normalizes a non-OK Response into a
    // PuzzleAdapterError, and a 404 on the auto-fetch path settles as a
    // committed `null` — "does not exist", never "still loading" (D161).
    async loadOne(fetch, id) {
      const res = await fetch('/api/todos.json');
      if (!res.ok) return res;
      const todos = await res.json();
      return (
        todos.find((todo) => String(todo.id) === String(id)) ??
        new Response(null, { status: 404 })
      );
    }
  };
}
