import HomeView from './views/Home.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Todos - Simple and Fast'
    }
  },
  {
    path: '*',
    name: 'not-found',
    view: NotFoundView,
    layout: DefaultLayout,
    meta: {
      title: 'Not found'
    }
  }
];
