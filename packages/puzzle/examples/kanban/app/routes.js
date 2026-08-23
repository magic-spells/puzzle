import BoardView from './views/Board.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'board',
    view: BoardView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Kanban'
    }
  }
];
