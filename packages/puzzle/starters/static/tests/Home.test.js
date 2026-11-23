// a first test: mount the home page, click its counter the way a user would,
// and check what it renders. run it with `npm test`.
import { expect, test } from 'vitest';
import { mountView } from '@magic-spells/puzzle/testing';
import Home from '../app/views/Home.pzl';

test('the home page counter counts clicks', async () => {
  const view = await mountView(Home);
  const label = () => view.find('button').textContent;

  expect(label()).toBe('Clicked 0 times');

  // click() waits for the re-render, so the page is up to date right after it
  await view.click('button');
  expect(label()).toBe('Clicked 1 time');

  // destroy() unmounts the view and releases what it subscribed to
  view.destroy();
});
