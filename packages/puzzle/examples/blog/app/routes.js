import { lazy } from '@magic-spells/puzzle';
import HomeView from './views/Home.pzl';
import PostsView from './views/Posts.pzl';
import PostDetailView from './views/PostDetail.pzl';
import AboutView from './views/About.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Press'
    }
  },
  {
    path: '/posts',
    name: 'posts',
    view: PostsView,
    layout: DefaultLayout,
    meta: {
      title: 'All Posts · Puzzle Press'
    }
  },
  {
    path: '/posts/:id',
    name: 'post',
    view: PostDetailView,
    layout: DefaultLayout,
    meta: {
      title: 'Post · Puzzle Press'
    }
  },
  {
    path: '/about',
    name: 'about',
    view: AboutView,
    layout: DefaultLayout,
    meta: {
      title: 'About · Puzzle Press'
    }
  },
  // Nested routes (v1.3, D30): the Settings shell renders its matched child
  // pane at its <Slot/>. Child paths are RELATIVE; `path: ''` is the index
  // child that fills the slot at the bare /settings URL.
  //
  // Settings is also this app's LAZY section (v1.77, D163): most readers never
  // open it, so `lazy(() => import(...))` keeps the shell and all three panes
  // out of the initial bundle. With `build: { splitting: true }` in
  // puzzle.config.js each one becomes its own dist/chunks/ file, fetched the
  // first time a navigation matches it; with splitting off the same code stays
  // inlined in app.js and lazy() still works, just without a separate request.
  // The shell and its matched pane load in PARALLEL, after the route's guards
  // pass and before any constructor or data() runs — so a failed download is a
  // failed push that leaves this page exactly where it is.
  {
    path: '/settings',
    name: 'settings',
    view: lazy(() => import('./views/settings/Settings.pzl')),
    layout: DefaultLayout,
    meta: {
      title: 'Settings · Puzzle Press'
    },
    children: [
      { path: '', name: 'settings-general', view: lazy(() => import('./views/settings/General.pzl')) },
      { path: 'profile', name: 'settings-profile', view: lazy(() => import('./views/settings/Profile.pzl')), meta: { title: 'Profile Settings · Puzzle Press' } },
      { path: 'notifications', name: 'settings-notifications', view: lazy(() => import('./views/settings/Notifications.pzl')) }
    ]
  },
  {
    path: '*',
    name: 'not-found',
    view: NotFoundView,
    layout: DefaultLayout,
    meta: {
      title: 'Not Found · Puzzle Press'
    }
  }
];
