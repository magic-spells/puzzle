import BoardView from './views/Board.pzl';
import EmptyOverlay from './views/EmptyOverlay.pzl';
import TaskDialog from './views/TaskDialog.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'board',
    view: BoardView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Kanban — Morph'
    },
    // The board stays mounted while the task dialog swaps in and out of its
    // <Slot/> — the shape a shared-element morph needs (the card must survive
    // the dialog's whole lifetime; D55).
    children: [
      { path: '', name: 'board-index', view: EmptyOverlay },
      { path: 'task/:taskId', name: 'task', view: TaskDialog }
    ]
  }
];
