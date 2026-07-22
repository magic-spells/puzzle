import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';
import { seedStore } from './seed.js';
import { loadState, saveState } from './storage.js';

// Short month names for the date formatters below.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse a full ISO datetime; returns null for junk so the formatters can degrade
// to '' instead of throwing inside a template.
function isoDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 12-hour clock piece for chirpDate: '2:41 PM'.
function clockTime(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// The v1 config surface is intentionally small: target, routes, models,
// formatters, apiURL — see constellation/doc/DOC-SPEC.md §2.
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  // No apiURL prefix: each model's adapter endpoint (e.g. '/posts.json') is
  // root-relative, so the seed files sit flat at the site root next to
  // index.html (dist/posts.json) and host anywhere with zero path wiring.
  // Point apiURL at a CDN/host later and the same endpoints follow it.
  apiURL: '',

  // Display-only formatters (logic belongs in data(), per SPEC §8). These only
  // shape values for presentation — relative/absolute times, big counts, and
  // word forms. ChirpCard/NotificationRow/PostDetail lean on these heavily.
  formatters: {
    // Twitter-style relative time. 'now' (<60s), '5m', '2h', '3d' (<7d), then
    // 'Jul 3' for older-this-year, and 'Jul 3, 2025' when the year differs.
    // Degrades to '' on junk input so a bad timestamp never breaks a row.
    timeago: (iso) => {
      const d = isoDateTime(iso);
      if (!d) return '';
      const secs = Math.floor((Date.now() - d.getTime()) / 1000);
      if (secs < 60) return 'now';
      if (secs < 3600) return `${Math.floor(secs / 60)}m`;
      if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
      if (secs < 604800) return `${Math.floor(secs / 86400)}d`;
      const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
      return d.getFullYear() === new Date().getFullYear()
        ? label
        : `${label}, ${d.getFullYear()}`;
    },

    // Shorten big counts: 847 -> "847", 1200 -> "1.2K", 3_400_000 -> "3.4M".
    // Copied from examples/stays so both demos read counts identically.
    compact: (n) => {
      const num = Number(n) || 0;
      if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1)}M`;
      if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 10_000 ? 0 : 1)}K`;
      return String(num);
    },

    // Pick a word form: plural(1,'reply') -> 'reply', plural(3,'reply') -> 'replies'.
    plural: (count, singular, plural) => (count === 1 ? singular : plural || `${singular}s`),

    // Full detail-page timestamp: '2:41 PM · Jul 9, 2026'.
    chirpDate: (iso) => {
      const d = isoDateTime(iso);
      if (!d) return '';
      return `${clockTime(d)} · ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    },
  },

  // Seed the store from the static JSON via the memoized seedStore (D21 read
  // path) before navigation #0. loadAll upserts by primary key and notifies
  // subscribers, so it must never run inside data() — seedStore guarantees a
  // single load that skeleton views can safely re-await. Seeding here is visible
  // to the first data(); then hydrate the persisted local-only state and wire the
  // persistence writes.
  async beforeMount(app) {
    await seedStore(app.store).catch((err) => console.error('[chirp] seed failed:', err));

    // Restore likes / rechirps / follows / read-flags / locally-composed chirps.
    const saved = loadState();

    // Flip local-only post flags so the like/rechirp buttons render in their
    // saved state. Guard each lookup — an id in storage might no longer exist.
    for (const id of saved.likedIds) {
      const post = app.store.findOne('post', id);
      if (post && !post.liked) post.update({ liked: true });
    }
    for (const id of saved.rechirpedIds) {
      const post = app.store.findOne('post', id);
      if (post && !post.rechirped) post.update({ rechirped: true });
    }

    // Flip followedByMe on followed users. We intentionally do NOT re-bump
    // followerCount here (toggleFollow adjusts it live during a session, but only
    // the followed-id set is persisted): after a reload the count simply shows the
    // seed baseline. A one-off ±1 display drift is fine for a demo and keeps the
    // restore path trivial.
    for (const id of saved.followedIds) {
      const user = app.store.findOne('user', id);
      if (user && !user.followedByMe) user.update({ followedByMe: true });
    }

    // Mark previously-read notifications read (drains the layout's unread badge).
    for (const id of saved.readNotificationIds) {
      const note = app.store.findOne('notification', id);
      if (note && !note.read) note.update({ read: true });
    }

    // Re-create chirps the user composed in a previous session. These carry
    // 'c-local-' ids and aren't in posts.json, so without this they'd vanish on
    // reload. createRecord upserts by primary key, so double-adds are harmless.
    // We seed each with zero counts (their engagement was never on a server).
    for (const c of saved.chirps) {
      if (!c || !c.id) continue;
      if (app.store.findOne('post', c.id)) continue;
      app.store.createRecord('post', {
        id: c.id,
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt,
        replyToId: c.replyToId || '',
        likeCount: 0,
        rechirpCount: 0,
        replyCount: 0,
        liked: false,
        rechirped: false,
      });
    }

    // Recompute every parent's replyCount from the ACTUAL store contents. Seed
    // rows already carry correct counts, but re-created local replies bump their
    // parent's total — the simplest correct approach is to recount from scratch
    // over all posts after re-creation and update only where the number changed
    // (so we don't fire needless subscriber notifications).
    const posts = app.store.findMany('post');
    const replyTotals = {};
    for (const p of posts) {
      if (p.replyToId) replyTotals[p.replyToId] = (replyTotals[p.replyToId] || 0) + 1;
    }
    for (const p of posts) {
      const actual = replyTotals[p.id] || 0;
      if (p.replyCount !== actual) p.update({ replyCount: actual });
    }

    // Persist a snapshot when the tab is hidden or closed (covers the dev server's
    // full-page live-reload too, so likes/follows and composed chirps survive a
    // rebuild). We store just the local-only flags plus every 'c-local-' chirp.
    const persist = () => {
      const all = app.store.findMany('post');
      saveState({
        likedIds: all.filter((p) => p.liked).map((p) => p.id),
        rechirpedIds: all.filter((p) => p.rechirped).map((p) => p.id),
        followedIds: app.store.findMany('user').filter((u) => u.followedByMe).map((u) => u.id),
        readNotificationIds: app.store
          .findMany('notification')
          .filter((n) => n.read)
          .map((n) => n.id),
        chirps: all
          .filter((p) => String(p.id).startsWith('c-local-'))
          .map((p) => ({
            id: p.id,
            authorId: p.authorId,
            body: p.body,
            createdAt: p.createdAt,
            replyToId: p.replyToId,
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
