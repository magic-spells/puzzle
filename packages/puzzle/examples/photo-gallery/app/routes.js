import GalleryView from './views/Gallery.pzl';
import AlbumView from './views/Album.pzl';
import AlbumIndex from './views/AlbumIndex.pzl';
import PhotoView from './views/PhotoView.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

// TWO morph shapes, one namespace (data-puzzle-morph="photo-<id>"):
//
// • All Photos ('/' → '/photo/:id') is a SIBLING top-level view swap sharing
//   DefaultLayout — the grid (Gallery) unmounts as the fullscreen (PhotoView)
//   mounts, so the card <img> is gone by the time the overlay exists. That is
//   the shape D68 CROSS-VIEW CAPTURE FLIGHTS pair across: the engine snapshots
//   the leaving card's rect and flies a clone into the arriving image.
//
// • An album ('/album/:slug' → '/album/:slug/photo/:id') is a NESTED CHILD swap
//   (D30). AlbumView is the shared parent and stays mounted while only its
//   <Slot/> child swaps (AlbumIndex → PhotoView), so the grid card <img> and the
//   fullscreen <img> are BOTH in the DOM at once — a D55 LIVE PAIR the engine
//   morphs with a real show/hide round trip (and flies back on close/back).
//
// Same PhotoView, same morph id, both directions — the example demos both.
export default [
  { path: '/',          name: 'gallery',   view: GalleryView,  layout: DefaultLayout, meta: { title: 'All Photos · Puzzle Photos' } },

  {
    path: '/album/:slug',
    view: AlbumView,
    layout: DefaultLayout,
    meta: { title: 'Album · Puzzle Photos' },
    // AlbumView renders its matched child at <Slot/>. The index child renders
    // nothing (AlbumView owns the grid); the photo child overlays fullscreen.
    // Keeping AlbumView mounted across the child swap is what makes the album
    // morph a live pair instead of a capture flight (see the note above).
    children: [
      { path: '',           name: 'album',       view: AlbumIndex },
      { path: 'photo/:id',  name: 'album-photo', view: PhotoView,  meta: { title: 'Photo · Puzzle Photos' } },
    ],
  },

  { path: '/photo/:id', name: 'photo',     view: PhotoView,    layout: DefaultLayout, meta: { title: 'Photo · Puzzle Photos' } },
  { path: '*',          name: 'not-found', view: NotFoundView, layout: DefaultLayout, meta: { title: 'Not Found · Puzzle Photos' } },
];
