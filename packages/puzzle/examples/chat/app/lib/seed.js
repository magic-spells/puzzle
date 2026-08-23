/*
 * Post-mount seed for the in-memory store (mirrors how the blog example seeds
 * after app.mount()). Two finished conversations with deterministic ids and
 * staggered timestamps in the past, so `timeago` in the sidebar shows variety.
 *
 * The first thread deliberately includes one `system` message and one `error`
 * message so all four {#case} branches in MessageBubble (user / assistant /
 * system / error) render from real data.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function seed(store) {
  const now = Date.now();

  // --- Conversation 1: the welcome tour (exercises every message role) -------
  store.createRecord('conversation', {
    id: 'c-welcome',
    title: 'Welcome to Puzzle Chat',
    createdAt: new Date(now - 26 * HOUR),
    updatedAt: new Date(now - 25 * HOUR),
  });

  const c1 = [
    {
      id: 'm-w-1',
      role: 'system',
      content: 'This is a local demo — replies are canned and generated entirely in the browser.',
      createdAt: new Date(now - 26 * HOUR),
    },
    {
      id: 'm-w-2',
      role: 'user',
      content: 'What is Puzzle?',
      createdAt: new Date(now - 26 * HOUR + 1 * MIN),
    },
    {
      id: 'm-w-3',
      role: 'assistant',
      model: 'puzzle-core',
      content:
        "Puzzle is a SPA-first JavaScript framework: single-file .pzl components, a reactive datastore, Liquid-style formatters, and a fast Go compiler that emits a small virtual-DOM runtime. This chat app is a demo of its newer features.",
      createdAt: new Date(now - 26 * HOUR + 2 * MIN),
    },
    {
      id: 'm-w-4',
      role: 'error',
      content: 'Example error message: the model timed out. (Seeded so the error bubble style is visible.)',
      createdAt: new Date(now - 25 * HOUR),
    },
  ];

  // --- Conversation 2: a short framework Q&A --------------------------------
  store.createRecord('conversation', {
    id: 'c-animations',
    title: 'How do animations work?',
    createdAt: new Date(now - 3 * HOUR),
    updatedAt: new Date(now - 3 * HOUR + 3 * MIN),
  });

  const c2 = [
    {
      id: 'm-a-1',
      role: 'user',
      content: 'How do animations work?',
      createdAt: new Date(now - 3 * HOUR),
    },
    {
      id: 'm-a-2',
      role: 'assistant',
      model: 'puzzle-max',
      content:
        "You declare an `animations` class field with `in` and `out` specs, and Puzzle runs them through the Web Animations API on the component's root — no wrapper element. View transitions are sequential: the old view animates out, the swap happens, then the new view animates in.",
      createdAt: new Date(now - 3 * HOUR + 3 * MIN),
    },
  ];

  for (const m of [...c1, ...c2]) {
    store.createRecord('message', {
      ...m,
      conversationId: m.id.startsWith('m-w-') ? 'c-welcome' : 'c-animations',
      pending: false,
    });
  }
}

export default seed;
