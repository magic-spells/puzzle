import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,

  // Seed the board before navigation #0, but only into an empty store. Seeding
  // here is visible to the first data().
  beforeMount(app) {
    if (app.store.findMany('task').length > 0) return;

    seedTasks.forEach((task) => {
      app.store.createRecord('task', task);
    });
  },
});

const seedTasks = [
  { id: 'task-1', title: 'Map pointer event lifecycle', status: 'todo', order: 0 },
  { id: 'task-2', title: 'Add ghost card styling', status: 'todo', order: 1 },
  { id: 'task-3', title: 'Verify empty-column hit testing', status: 'todo', order: 2 },
  { id: 'task-4', title: 'Tune FLIP animation timing', status: 'doing', order: 0 },
  { id: 'task-5', title: 'Keep pointermove imperative', status: 'doing', order: 1 },
  { id: 'task-6', title: 'Reindex orders on drop', status: 'done', order: 0 },
  { id: 'task-7', title: 'Guard placeholder grabs', status: 'done', order: 1 },
  { id: 'task-8', title: 'Cancel outside column without store writes', status: 'done', order: 2 },
];

app.mount();

export default app;
