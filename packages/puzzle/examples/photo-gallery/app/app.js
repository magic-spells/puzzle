import { PuzzleApp } from '@magic-spells/puzzle';
import { enableMorph } from '@magic-spells/puzzle/morph';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,

  // Seed the store from Lorem Picsum before navigation #0. beforeMount is
  // awaited, so the store is fully populated before the first data() runs — a
  // missing photo is then a genuine not-found, not a mid-load blank (SPEC §30).
  //
  // limit=60 pulls enough of the catalog that several photographers appear more
  // than once, so the derived "Albums" (grouped by author, see app/albums.js)
  // have real multi-photo contents to show.
  //
  // Network failure must NOT reject the mount: we catch inside and let the app
  // boot with an empty store, so the gallery shows its empty state instead of a
  // blank screen (SPEC §34 — a beforeMount throw aborts the whole mount).
  async beforeMount(app) {
    try {
      const res = await fetch('https://picsum.photos/v2/list?page=1&limit=60');
      if (!res.ok) throw new Error(`Picsum responded ${res.status}`);
      const list = await res.json();
      for (const item of list) {
        app.store.createRecord('photo', {
          id: String(item.id),
          author: item.author,
          width: item.width,
          height: item.height,
        });
      }
    } catch (err) {
      console.error('[photo-gallery] photo fetch failed:', err);
    }
  },
});

// Shared-element morph opt-in (v1.23 D55; v1.35 cross-view flights, D68). The
// grid card <img> and the fullscreen <img> carry the SAME plain symmetric
// `data-puzzle-morph="photo-<id>"`, so the router pairs them on the sibling view
// swap in BOTH directions — the thumbnail flies up into the fullscreen image on
// click, and the fullscreen image flies back into its card on close (browser
// back/forward included). Plain (not -trigger/-target) is what makes it
// bidirectional. No app code beyond this one call.
// friction raised from the 0.32 default: more damping = the flight settles
// onto the landing rect with less spring-bounce (photos read better landing
// crisply than wobbling). 0.42 felt over-damped; 0.37 keeps a hint of life.
// No clone/reveal timing overrides needed: the grid tile and the fullscreen
// view render the SAME rendition (photo.src), so the blob's carried clone and
// the landing target are the same bitmap — the engine's crossfades happen
// between identical pixels and the photo reads as one continuous surface.
enableMorph(app, { friction: 0.37 });

app.mount();

export default app;
