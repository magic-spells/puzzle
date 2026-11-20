import { mountView, createTestApp } from '@magic-spells/puzzle/testing';
import Home from '../app/views/Home.pzl';
import formatters from '../app/formatters.js';

const shout = (s) => s.toUpperCase();

it('mounts', async () => {
  const view = await mountView(Home, { props: {}, formatters: { shout } });
  view.instance.setData('x', 1);
  const app = await createTestApp({ routes: [], formatters });
  expect(app).toBeTruthy();
});
