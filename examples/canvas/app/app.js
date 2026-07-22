import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,

  // Seed the opening scene before navigation #0, but only into an empty store
  // (a persisted store keeps the user's arrangement). Seeding here is visible to
  // the first data().
  beforeMount(app) {
    if (app.store.findMany('element').length > 0) return;

    seedElements.forEach((element) => {
      app.store.createRecord('element', element);
    });
  },
});

// A hand-arranged opening scene. Top-level `z` is render/stacking order
// (0 = bottom). Frame children carry their own 0-based `z` (stack + paint
// order within the frame). See constellation-style intent notes in geometry.js.
const seedElements = [
  // --- Frame: "Profile card" (vertical stack) --------------------------------
  {
    id: 'seed-profile', type: 'frame', name: 'Profile card', frameId: '',
    x: 96, y: 120, w: 320, h: 300, z: 0,
    fill: '#191B20', radius: 16, shadowBlur: 32, shadowY: 10,
    layout: 'stack-v', padding: 24, gap: 12,
  },
  {
    id: 'seed-avatar', type: 'rect', name: 'Avatar', frameId: 'seed-profile',
    x: 0, y: 0, w: 272, h: 120, z: 0, fill: '#5B8DEF', radius: 8,
  },
  {
    id: 'seed-title', type: 'text', name: 'Title', frameId: 'seed-profile',
    x: 0, y: 0, w: 272, h: 26, z: 1, text: 'Puzzle Studio', fontSize: 20,
    fill: '#E9E9EE',
  },
  {
    id: 'seed-subtitle', type: 'text', name: 'Subtitle', frameId: 'seed-profile',
    x: 0, y: 0, w: 272, h: 36, z: 2,
    text: 'Drag, arrange, edit options in the inspector.', fontSize: 13,
    fill: '#979AA4',
  },

  // --- Frame: "Palette" (free layout) ----------------------------------------
  {
    id: 'seed-palette', type: 'frame', name: 'Palette', frameId: '',
    x: 96, y: 500, w: 320, h: 140, z: 1, fill: '#141519', radius: 12,
    layout: 'free',
  },
  {
    id: 'seed-swatch-1', type: 'rect', name: 'Swatch 1', frameId: 'seed-palette',
    x: 24, y: 34, w: 72, h: 72, z: 0, fill: '#8B7CF6', radius: 12,
  },
  {
    id: 'seed-swatch-2', type: 'rect', name: 'Swatch 2', frameId: 'seed-palette',
    x: 124, y: 34, w: 72, h: 72, z: 1, fill: '#EF6BA8', radius: 12,
  },
  {
    id: 'seed-swatch-3', type: 'rect', name: 'Swatch 3', frameId: 'seed-palette',
    x: 224, y: 34, w: 72, h: 72, z: 2, fill: '#F1934C', radius: 12,
  },

  // --- Free-floating elements ------------------------------------------------
  {
    id: 'seed-sun', type: 'ellipse', name: 'Sun', frameId: '',
    x: 520, y: 140, w: 140, h: 140, z: 2, fill: '#E8C34A',
    shadowBlur: 48, shadowY: 16,
  },
  {
    id: 'seed-panel', type: 'rect', name: 'Panel', frameId: '',
    x: 540, y: 360, w: 220, h: 140, z: 3, fill: '#58BB8A', radius: 20,
  },
  {
    id: 'seed-hint', type: 'text', name: 'Hint', frameId: '',
    x: 520, y: 560, w: 260, h: 24, z: 4, text: 'Click anything to inspect it',
    fontSize: 14, fill: '#5C5F6A',
  },
];

app.mount();

export default app;
