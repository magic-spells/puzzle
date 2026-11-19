// a store test: the todo model on its own, with no view mounted.
import { afterEach, expect, test } from 'vitest';
import { PuzzleValidationError } from '@magic-spells/puzzle';
import { createTestApp } from '@magic-spells/puzzle/testing';
import models from '../app/models/index.js';
import routes from '../app/routes.js';

let app;

// boot a real app in memory. its store starts empty: the seed rows live in
// app/app.js, which a test does not run.
async function boot() {
  app = await createTestApp({ routes, models });
  return app;
}

// each test boots its own app, so records never leak from one test to the next
afterEach(() => app?.destroy());

test('markComplete() finishes a todo', async () => {
  const { store } = await boot();
  const todo = store.createRecord('todo', { text: 'Water the plants' });

  // schema defaults fill in what createRecord() did not pass
  expect(todo.completed).toBe(false);
  expect(todo.isActive).toBe(true);

  todo.markComplete();

  expect(todo.completed).toBe(true);
  expect(store.findMany('todo').filter((t) => t.isActive)).toHaveLength(0);
});

test('a todo needs text', async () => {
  const { store } = await boot();

  // the schema marks text required, so an empty todo never reaches the store
  expect(() => store.createRecord('todo', { text: '' })).toThrow(PuzzleValidationError);
  expect(store.findMany('todo')).toHaveLength(0);
});
