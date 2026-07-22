import { PuzzleApp } from '@magic-spells/puzzle';
import { enableMorph } from '@magic-spells/puzzle/morph';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  // An overlay-route app: leave window scroll alone so the morph stays
  // anchored to the card you clicked (the default scrolls to top on push).
  scrollBehavior: false,

  // Seed the board before navigation #0, but only into an empty store. Seeding
  // here is visible to the first data().
  beforeMount(app) {
    if (app.store.findMany('task').length > 0) return;

    seedTasks.forEach((task) => {
      app.store.createRecord('task', task);
    });
  },
});

// The whole morph opt-in (v1.23, D55). Cards and the dialog shell share
// data-puzzle-morph values; the router pairs them on every swap — open,
// close, and browser back/forward. Returns the engine for live tuning.
enableMorph(app);

const seedTasks = [
  {
    id: 'task-1',
    title: 'Map pointer event lifecycle',
    status: 'todo',
    order: 0,
    description:
      'Trace pointerdown → pointermove → pointerup across the board and document where PENDING promotes to DRAGGING. The 5px threshold is what lets a plain click fall through to the task dialog.',
  },
  {
    id: 'task-2',
    title: 'Add ghost card styling',
    status: 'todo',
    order: 1,
    description:
      'The drag ghost is a cloned card fixed to the pointer with a slight rotate and scale. Keep the drop shadow heavy enough to read as "lifted" against the dark board.',
  },
  {
    id: 'task-3',
    title: 'Verify empty-column hit testing',
    status: 'todo',
    order: 2,
    description:
      'Dropping into a column with no cards must land at index 0. Hit testing walks card midpoints, so an empty column has to short-circuit cleanly instead of reading undefined rects.',
  },
  {
    id: 'task-4',
    title: 'Tune FLIP animation timing',
    status: 'doing',
    order: 0,
    description:
      'Neighboring cards slide out of the way with a 180ms FLIP driven from beforeUpdate/afterUpdate rect snapshots. This coexists with the morph: FLIP fires on drag reorders, the morph on navigation — never at the same time.',
  },
  {
    id: 'task-5',
    title: 'Keep pointermove imperative',
    status: 'doing',
    order: 1,
    description:
      'The two-lane rule: per-frame ghost movement writes transforms directly and never touches the store; only slot changes go through setData + refresh. Sixty store flushes a second is how boards die.',
  },
  {
    id: 'task-6',
    title: 'Reindex orders on drop',
    status: 'done',
    order: 0,
    description:
      'A drop rewrites order for every task in the affected columns so the sort stays dense. One store flush, every column re-renders from data() — no manual DOM bookkeeping.',
  },
  {
    id: 'task-7',
    title: 'Guard placeholder grabs',
    status: 'done',
    order: 1,
    description:
      'The dashed landing slot is a fake record (__placeholder) injected by data(). It must never start a drag, open a dialog, or morph — TaskCard checks before forwarding the grab.',
  },
  {
    id: 'task-8',
    title: 'Cancel outside column without store writes',
    status: 'done',
    order: 2,
    description:
      'Releasing a drag outside every column cancels: the ghost is removed, the placeholder vanishes, and the store is untouched — cancel is a pure re-render of what already was.',
  },
];

app.mount();

export default app;
