import type { Route } from '@magic-spells/puzzle';
import HomeView from './views/Home.pzl';
import DefaultLayout from './layouts/Default.pzl';

const routes: Route[] = [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: { title: 'Typed Todos' },
  },
];

export default routes;
