import HomeView from './views/Home.pzl';
import ExploreView from './views/Explore.pzl';
import NotificationsView from './views/Notifications.pzl';
import PostDetailView from './views/PostDetail.pzl';
import ProfileShell from './views/profile/ProfileShell.pzl';
import ProfileChirps from './views/profile/ProfileChirps.pzl';
import ProfileReplies from './views/profile/ProfileReplies.pzl';
import ProfileLikes from './views/profile/ProfileLikes.pzl';
import NotFoundView from './views/NotFound.pzl';

import MainLayout from './layouts/MainLayout.pzl';

// One layout for the whole app (constellation/doc/DOC-SPEC.md §12, D28): Home,
// Explore, Notifications, PostDetail, the profile chain and 404 all share
// MainLayout, so navigating between them is a "view swap inside a reused layout"
// — the left sidebar, right rail and mobile tab bar stay mounted, only the
// center <Slot/> animates.
//
// /u/:handle is a NESTED route (v1.3, D30): ProfileShell renders its matched
// child pane (Chirps / Replies / Likes) at its own <Slot/>. Child paths are
// RELATIVE; `path: ''` is the index child that fills the slot at the bare
// /u/:handle URL, so a profile opens on the Chirps tab. `layout` is a
// top-level-route-only field — the children inherit MainLayout from the chain.
// Swapping tabs reuses ProfileShell (its data() re-runs with the full merged
// params, so `params.handle` is available to every pane); only the leaf animates.
export default [
  { path: '/',              name: 'home',          view: HomeView,          layout: MainLayout, meta: { title: 'Home · Chirp' } },
  { path: '/explore',       name: 'explore',       view: ExploreView,       layout: MainLayout, meta: { title: 'Explore · Chirp' } },
  { path: '/notifications', name: 'notifications', view: NotificationsView, layout: MainLayout, meta: { title: 'Notifications · Chirp' } },
  { path: '/post/:id',      name: 'post',          view: PostDetailView,    layout: MainLayout, meta: { title: 'Chirp' } },
  {
    path: '/u/:handle', name: 'profile', view: ProfileShell, layout: MainLayout,
    meta: { title: 'Profile · Chirp' },
    children: [
      { path: '',        name: 'profile-chirps',  view: ProfileChirps },
      { path: 'replies', name: 'profile-replies', view: ProfileReplies },
      { path: 'likes',   name: 'profile-likes',   view: ProfileLikes },
    ],
  },
  { path: '*', name: 'not-found', view: NotFoundView, layout: MainLayout, meta: { title: 'Not found · Chirp' } },
];
