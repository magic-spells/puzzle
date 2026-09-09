import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

// Persist the whole store to localStorage (SPEC §2/§8). The store hydrates from
// this on construction, so a reload restores every page and block with no extra
// wiring. Guard for non-browser (SSR/build/test) contexts — pass `undefined`
// there and the store stays in-memory.
const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  storage,

  // Seed a fresh grimoire before navigation #0 — but only when the store didn't
  // hydrate any pages from storage, so the user's spellbook is left untouched.
  // Seeding here is visible to the first data().
  beforeMount(app) {
    if (app.store.findMany('page').length === 0) {
      seedGrimoire(app.store);
    }
  },
});

// Seed one page + its ordered blocks. createRecord applies schema defaults and
// persists on each call (store owns persistence).
function seedPage(store, page, blocks) {
  store.createRecord('page', page);
  blocks.forEach((b, i) => {
    store.createRecord('block', {
      pageId: page.id,
      order: i,
      type: b.type || 'paragraph',
      text: b.text || '',
      checked: !!b.checked,
      indent: b.indent || 0,
    });
  });
}

// Only seed a fresh grimoire — if the store hydrated any pages from storage,
// leave the user's spellbook untouched.
function seedGrimoire(store) {
  // Page 1 — the guided tour. Uses every block type at least once.
  seedPage(
    store,
    { id: 'page-welcome', title: 'Welcome to Grimoire', icon: '👋', order: 0 },
    [
      { type: 'heading1', text: 'Welcome to Grimoire ✦' },
      { type: 'paragraph', text: "You've opened a spellbook of living pages. Every note here is kept in your browser's local vault — no server, no summoning circle required." },
      { type: 'paragraph', text: 'Grimoire is a Notion-style demo for the Puzzle framework. This chapter reads and renders your pages; a later chapter teaches them to accept the quill.' },
      { type: 'heading2', text: 'The block bestiary' },
      { type: 'paragraph', text: 'Every creature a page can hold, gathered here so you can see how each is rendered:' },
      { type: 'bullet', text: 'Bullet lists, for loose collections of thoughts' },
      { type: 'bullet', text: 'Todos, for spells you still intend to cast' },
      { type: 'bullet', text: 'Quotes and code, for wisdom borrowed and wisdom written' },
      { type: 'heading3', text: 'How to conjure a new page' },
      { type: 'numbered', text: 'Tap "＋ New page" in the margin to your left' },
      { type: 'numbered', text: 'Give it a title and an emoji sigil' },
      { type: 'numbered', text: 'Fill it with blocks (editing arrives in the next chapter)' },
      { type: 'todo', text: 'Sketch the structure of the grimoire', checked: true },
      { type: 'todo', text: 'Teach the pages to be edited', checked: false },
      { type: 'quote', text: 'Any sufficiently organized notebook is indistinguishable from magic.' },
      { type: 'code', text: "store.createRecord('block', { type: 'paragraph', text: 'Hello, world' });" },
      { type: 'divider' },
      { type: 'paragraph', text: 'That is the whole bestiary. Wander the sidebar to visit the other pages.' },
    ]
  );

  // Page 2 — todos + bullets.
  seedPage(
    store,
    { id: 'page-spells', title: 'Spell Ideas', icon: '✨', order: 1 },
    [
      { type: 'heading1', text: 'Spell Ideas ✨' },
      { type: 'paragraph', text: 'A scratch pad for enchantments worth attempting.' },
      { type: 'todo', text: 'Levitation charm for heavy sidebars', checked: false },
      { type: 'todo', text: 'Summoning circle for lost bookmarks', checked: false },
      { type: 'todo', text: 'Invisibility ink for unfinished drafts', checked: true },
      { type: 'heading3', text: 'Ingredients on hand' },
      { type: 'bullet', text: 'A pinch of reactive dust' },
      { type: 'bullet', text: 'Three drops of virtual DOM' },
      { type: 'bullet', text: 'One well-rested compiler' },
    ]
  );

  // Page 3 — numbered items.
  seedPage(
    store,
    { id: 'page-reading', title: 'Reading List', icon: '📚', order: 2 },
    [
      { type: 'heading1', text: 'Reading List 📚' },
      { type: 'paragraph', text: 'Tomes to study before the next full moon.' },
      { type: 'numbered', text: 'The Compendium of Reactive Runes' },
      { type: 'numbered', text: 'On the Weaving of Single-File Components' },
      { type: 'numbered', text: 'Liquid Formatters & Other Display Sorcery' },
      { type: 'numbered', text: 'A Field Guide to Client-Side Routing' },
    ]
  );
}

app.mount();

// Dev-only handle for console probing (e.g. flipping a block's type through the
// store to verify island re-seeding). Guarded so it never leaks into a prod
// bundle's global scope beyond a harmless reference.
if (typeof window !== 'undefined') {
  window.__grimoire = app;
}

export default app;
