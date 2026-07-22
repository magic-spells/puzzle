import EditorView from './views/Editor.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'editor',
    view: EditorView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Studio'
    }
  }
];
