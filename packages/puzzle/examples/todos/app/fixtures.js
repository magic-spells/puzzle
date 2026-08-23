// Fixture data for development without a server (D98).
//
// This file is INERT unless the app is built with the flag:
//
//   puzzle dev --fixtures      # develop against fake data
//   puzzle dev                 # develop with an empty store — none of this ships
//   puzzle build --fixtures    # preview build with the fake data baked in
//
// With the flag, the compiler generates a wiring entry that installs
// @magic-spells/puzzle/fixtures with this default export before app.js runs.
//
// Todos is a local-first app (no adapter, so no reads or writes ever leave the
// browser — a tracked find on a model with no read verb stays a local read), so
// seeding is the whole
// story here. An adapter-backed app would also declare per-type mock config —
// merged over the model's own `static adapter.mock`, this file winning per key:
//
//   mock: { todo: { latency: [150, 450], failRate: 0.1 } },
//
// `latency` makes <puzzle-skeleton> timing developable; `failRate`/`fail` are
// the supported way to exercise data() rejection paths.

export default {
  // One seed drives fixture generation (and an adapter mock's latency/failure
  // rolls), so a run replays exactly. Change it for a different, still-fixed set.
  seed: 42,

  // Runs at beforeMount timing — after the app's own beforeMount, before the
  // first navigation — so seeded records are visible to the first data().
  // The guard keeps a persistent store (`storage`) from re-seeding on every
  // visit; dev-reload state restore already replaces rather than merges.
  setup(app) {
    if (app.store.findMany('todo').length) return;
    app.store.seed('todo', [
      { text: 'Try puzzle dev --fixtures', completed: true },
      { text: 'These records came from app/fixtures.js' },
      { text: 'Schema-generated ones follow — same seed, same data' },
      { text: 'Rebuild without the flag and none of this ships' },
    ]);
    app.store.seed('todo', 3); // plus a few schema-generated ones
  },
};
