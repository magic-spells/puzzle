import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';
import { loadState, saveState } from './storage.js';

// Short month names for the date formatters below.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Parse an ISO yyyy-mm-dd as a LOCAL date (append T00:00:00 so it isn't shifted
// into the previous day by the UTC parse). Returns null for junk input so the
// formatters can degrade gracefully instead of throwing in a template.
function isoDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The v1 config surface is intentionally small: target, routes, models,
// formatters, apiURL — see constellation/doc/DOC-SPEC.md §2.
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  // No apiURL prefix: each model's adapter endpoint (e.g. '/listings.json') is
  // root-relative, so the seed files sit flat at the site root next to
  // index.html (dist/listings.json) and host anywhere with zero path wiring.
  // Point apiURL at a CDN/host later and the same endpoints follow it.
  apiURL: '',

  // Display-only formatters (logic belongs in data(), per SPEC §8). These only
  // shape values for presentation — money, ratings, word forms, and dates.
  formatters: {
    // Whole-dollar money with thousands separators: 149 -> "$149".
    currency: (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`,

    // Two-decimal rating: 4.9 -> "4.90", 4.875 -> "4.88".
    rating: (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2),

    // Pick a word form: plural(1,'night') -> 'night', plural(3,'night') -> 'nights'.
    plural: (count, singular, plural) => (count === 1 ? singular : plural || `${singular}s`),

    // Shorten big counts: 1200 -> "1.2K", 3_400_000 -> "3.4M".
    compact: (n) => {
      const num = Number(n) || 0;
      if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1)}M`;
      if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 10_000 ? 0 : 1)}K`;
      return String(num);
    },

    // 'Jul 12' — short month + day, no year.
    monthDay: (iso) => {
      const d = isoDate(iso);
      return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : '';
    },

    // 'July 2026' — long month + year.
    monthYear: (iso) => {
      const d = isoDate(iso);
      return d ? `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : '';
    },

    // A stay's date span. Collapses the month when both dates share it and
    // always shows the checkout year only:
    //   same month:  dateRange('2026-07-12','2026-07-17') -> 'Jul 12 – 17, 2026'
    //   cross month: dateRange('2026-07-28','2026-08-02') -> 'Jul 28 – Aug 2, 2026'
    dateRange: (a, b) => {
      const d1 = isoDate(a);
      const d2 = isoDate(b);
      if (!d1 || !d2) return '';
      const year = d2.getFullYear();
      const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();
      const left = `${MONTHS[d1.getMonth()]} ${d1.getDate()}`;
      const right = sameMonth
        ? `${d2.getDate()}`
        : `${MONTHS[d2.getMonth()]} ${d2.getDate()}`;
      return `${left} – ${right}, ${year}`;
    },
  },

  // Seed the store from the static JSON (D21 read path) before navigation #0.
  // loadAll upserts by primary key and notifies subscribers, so it must never run
  // inside data(). Seeding here is visible to the first data(); then hydrate
  // persisted state and wire the persistence writes.
  async beforeMount(app) {
    await Promise.all([
      app.store.loadAll('listing').catch((err) => console.error('[stays] listing seed failed:', err)),
      app.store.loadAll('host').catch((err) => console.error('[stays] host seed failed:', err)),
      app.store.loadAll('review').catch((err) => console.error('[stays] review seed failed:', err)),
      app.store.loadAll('trip').catch((err) => console.error('[stays] trip seed failed:', err)),
      app.store.loadAll('traveler').catch((err) => console.error('[stays] traveler seed failed:', err)),
    ]);

    // Restore wishlist + locally-created reservations from localStorage.
    const saved = loadState();

    // Flip `saved: true` on each wishlisted listing so the heart renders filled.
    for (const id of saved.savedIds) {
      const listing = app.store.findOne('listing', id);
      if (listing) listing.update({ saved: true });
    }

    // Re-seed reservations the user booked in a previous session. These have
    // 't-local-' ids and aren't in trips.json, so without this they'd vanish on
    // reload. createRecord upserts by primary key, so double-adds are harmless.
    for (const t of saved.trips) {
      if (!t || !t.id) continue;
      if (app.store.findOne('trip', t.id)) continue;
      app.store.createRecord('trip', {
        id: t.id,
        listingId: t.listingId,
        checkIn: t.checkIn,
        checkOut: t.checkOut,
        status: t.status || 'upcoming',
      });
    }

    // Persist a snapshot when the tab is hidden or closed (covers the dev server's
    // full-page live-reload too, so the wishlist and reservations survive a
    // rebuild). We store the saved listing ids plus every locally-created trip.
    const persist = () => {
      saveState({
        savedIds: app.store.findMany('listing').filter((l) => l.saved).map((l) => l.id),
        trips: app.store
          .findMany('trip')
          .filter((t) => String(t.id).startsWith('t-local-'))
          .map((t) => ({
            id: t.id,
            listingId: t.listingId,
            checkIn: t.checkIn,
            checkOut: t.checkOut,
            status: t.status,
          })),
      });
    };
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist();
    });
    window.addEventListener('beforeunload', persist);
  },
});

app.mount();

export default app;
