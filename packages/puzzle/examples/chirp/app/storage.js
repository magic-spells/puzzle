// Tiny localStorage persistence layer. v1's store is in-memory, so this is how
// the local-only state — likes, rechirps, follows, read-notification flags, and
// chirps you composed in the browser — survives a reload (including the dev
// server's full-page live-reload). Kept as plain functions with defensive JSON
// handling: a corrupt or absent key just yields empty defaults rather than
// throwing during boot. Mirrors examples/stays/app/storage.js.
const KEY = 'puzzle-chirp-state-v1';

// Every field defaults to an empty array so a partial/legacy snapshot can never
// crash the restore loop in app.js.
export function loadState() {
  const empty = {
    likedIds: [],
    rechirpedIds: [],
    followedIds: [],
    readNotificationIds: [],
    chirps: [],
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      likedIds: Array.isArray(parsed.likedIds) ? parsed.likedIds : [],
      rechirpedIds: Array.isArray(parsed.rechirpedIds) ? parsed.rechirpedIds : [],
      followedIds: Array.isArray(parsed.followedIds) ? parsed.followedIds : [],
      readNotificationIds: Array.isArray(parsed.readNotificationIds)
        ? parsed.readNotificationIds
        : [],
      chirps: Array.isArray(parsed.chirps) ? parsed.chirps : [],
    };
  } catch {
    return empty;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — non-fatal for a demo */
  }
}
