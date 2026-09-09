import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// A single Lorem Picsum photo. The store is seeded in app.js's beforeMount from
// picsum's list endpoint — there is no adapter here, so the model is local-only
// (no PUT/GET wiring). Only the metadata is stored; the image URLs are DERIVED
// from the id (picsum serves any size off `/id/<id>/<w>/<h>`), so nothing about
// the pixels lives in the store.
export default class Photo extends PuzzleModel {
  static schema = {
    id: Puzzle.string().primary(),
    author: Puzzle.string().required(),
    width: Puzzle.number(),
    height: Puzzle.number(),
  };

  // The ONE rendition, used by BOTH the grid tile and the fullscreen view
  // (1200×800, 3:2). Same URL in both spots means the morph blob's carried
  // clone, the launching tile, and the landing target are all the same bitmap
  // — the flight reads as one continuous photo with no mid-flight content
  // swap, and the fullscreen image is always already cached (rendering the
  // grid IS the preload). Trade-off: the grid downloads ~60 mid-size images
  // (~6–9 MB) instead of small thumbs; fine for a demo, and picsum's CDN
  // caches hard.
  get src() {
    return `https://picsum.photos/id/${this.id}/1200/800`;
  }
}
