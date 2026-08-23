// Memoized whole-store load. Views do not need this — a tracked findOne/findMany
// in data() fetches what is missing on its own (D161) — but this demo restores
// persisted like/rechirp/follow flags onto records at boot, which only works once
// those records exist, so it loads everything up front.
//
// The memo is what makes the load safe to await from a view's async data(): it is
// initiated at most once and later calls get the SAME promise back, so the
// skeleton views (SPEC §16) can await real fetch latency without issuing a second
// request. app.js awaits it once at boot; Home and PostDetail await it again at
// the top of their async data(), which the memo makes free.
let seeded = null;

export function seedStore(store) {
  if (!seeded) {
    seeded = Promise.all([
      store.loadMany('user'),
      store.loadMany('post'),
      store.loadMany('notification'),
    ]);
  }
  return seeded;
}
