// Tiny localStorage persistence layer. v1's store is in-memory, so this is how
// wishlisted listings and locally-created reservations survive a reload. Kept as
// plain functions with defensive JSON handling — a corrupt or absent key just
// yields defaults rather than throwing during boot.
const KEY = 'puzzle-stays-v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { savedIds: [], trips: [] };
    const parsed = JSON.parse(raw);
    return {
      savedIds: Array.isArray(parsed.savedIds) ? parsed.savedIds : [],
      trips: Array.isArray(parsed.trips) ? parsed.trips : [],
    };
  } catch {
    return { savedIds: [], trips: [] };
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — non-fatal for a demo */
  }
}
