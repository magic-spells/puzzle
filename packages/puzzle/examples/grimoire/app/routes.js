import Home from './views/Home.pzl';
import Doc from './views/Doc.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'home',
    view: Home,
    layout: DefaultLayout,
    meta: { title: 'Grimoire' },
  },
  {
    path: '/p/:id',
    name: 'doc',
    view: Doc,
    layout: DefaultLayout,
    meta: { title: 'Grimoire' },
  },
  // Catch-all: unmatched URLs fall back to Home, which redirects to the first
  // page (or shows the empty state). Always matched last (SPEC §9).
  {
    path: '*',
    name: 'not-found',
    view: Home,
    layout: DefaultLayout,
    meta: { title: 'Grimoire' },
  },
];
