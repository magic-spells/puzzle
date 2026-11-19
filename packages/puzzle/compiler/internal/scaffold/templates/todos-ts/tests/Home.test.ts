// a view test: mount the home view with the app's models, add a todo through
// the form the way a user would, and check that the list shows it.
import { expect, test } from 'vitest';
import { mountView } from '@magic-spells/puzzle/testing';
import Home from '../app/views/Home.pzl';
import models from '../app/models';

test('adding a todo shows it in the list', async () => {
  // models gives the view its own empty store, so the list starts empty
  const view = await mountView(Home, { models });

  // type() fills the bound input; click() submits and waits for the re-render
  await view.type('input[type="text"]', 'Buy oat milk');
  await view.click('button[type="submit"]');

  expect(view.element?.textContent).toContain('Buy oat milk');
  expect(view.store.findMany('todo')).toHaveLength(1);

  view.destroy();
});
