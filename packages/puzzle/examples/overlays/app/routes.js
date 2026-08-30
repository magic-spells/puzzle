import { lazy } from '@magic-spells/puzzle';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'home',
		view: lazy(() => import('./views/Home.pzl')),
    layout: DefaultLayout,
    meta: {
      title: 'Overlays — Puzzle <Portal>',
    },
  },
];
