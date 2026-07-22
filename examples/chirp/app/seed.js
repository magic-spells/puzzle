// Memoized store seeding. Safe to await from a view's async data(): the load is
// initiated at most once; later calls get the SAME promise back. This is what
// lets skeleton views (SPEC §16) await real fetch latency from data() without
// re-initiating loads — loadAll upserts by primary key and notifies subscribers,
// so it must never run more than once from a render path (the D21 gotcha).
//
// app.js awaits this once at boot to seed; skeleton views (Home, PostDetail)
// await it again at the top of their async data() to be sure the store is
// populated before they read from it — the memo makes that second await free.
let seeded = null;

export function seedStore(store) {
  if (!seeded) {
    seeded = Promise.all([
      store.loadAll('user'),
      store.loadAll('post'),
      store.loadAll('notification'),
    ]);
  }
  return seeded;
}
