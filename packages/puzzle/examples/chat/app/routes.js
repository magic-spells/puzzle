import Shell from './views/Shell.pzl';
import Welcome from './views/Welcome.pzl';
import Thread from './views/Thread.pzl';
import NotFound from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

// One top-level route with NESTED CHILDREN (v1.3, D30): the Shell view is the
// persistent sidebar-plus-pane frame, and it renders its matched child at
// <Slot />. `path: ''` is the index child (Welcome, the empty state); `c/:id`
// is a thread. `layout` is a top-level-only field — the children inherit it.
// Params merge down the chain, so Shell's data(params) sees `id` when a thread
// is open. The '*' catch-all handles unknown URLs.
export default [
  {
    path: '/',
    name: 'shell',
    view: Shell,
    layout: DefaultLayout,
    meta: { title: 'Puzzle Chat' },
    children: [
      { path: '', name: 'welcome', view: Welcome, meta: { title: 'Puzzle Chat' } },
      { path: 'c/:id', name: 'thread', view: Thread, meta: { title: 'Puzzle Chat' } },
    ],
  },
  { path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Not found · Puzzle Chat' } },
];
