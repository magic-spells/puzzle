// a first component test: mount the counter on its own, click its buttons the
// way a user would, and check what it renders. run it with `npm test`.
import { expect, test } from 'vitest';
import { mountView } from '@magic-spells/puzzle/testing';
import Counter from '../app/components/Counter.pzl';

test('the counter goes up and down', async () => {
  // mount with the props a parent view would pass
  const view = await mountView(Counter, { props: { label: 'Clicks' } });
  const count = () => view.find('.count')?.textContent;

  expect(count()).toBe('0');

  // click() waits for the re-render, so the page is up to date right after it
  await view.click('[aria-label="Increase"]');
  await view.click('[aria-label="Increase"]');
  expect(count()).toBe('2');

  await view.click('[aria-label="Decrease"]');
  expect(count()).toBe('1');

  // destroy() unmounts the view and releases what it subscribed to
  view.destroy();
});
