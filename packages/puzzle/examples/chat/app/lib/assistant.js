/*
 * The "AI" — a fully local fake assistant. No network, no keys. It keyword-
 * matches a prompt against a small knowledge base of accurate answers about the
 * Puzzle framework (cribbed from constellation/doc/DOC-SPEC.md and CLAUDE.md so
 * the bot never lies about its own host), then streams the reply back one word
 * at a time via a self-scheduling setTimeout chain.
 *
 * streamReply(promptText, { onToken, onDone, model }) -> cancel()
 *   onToken(word)  fires once per word (a leading space is included except on
 *                  the first token) so the caller can append it to the record.
 *   onDone()       fires once, after the last token.
 *   cancel()       stops the drip; NO onToken/onDone fires after it is called.
 *   model          selects the token cadence (see CADENCE); 'puzzle-max' also
 *                  appends one deterministic closing sentence to the answer.
 */

// Per-model token cadence, in ms. Deterministic SELECTION (no Math.random in
// choosing the model or the extra sentence); the per-token jitter stays random.
const CADENCE = {
  'puzzle-nano': { min: 12, jitter: 16 },  // 12–28ms — fastest
  'puzzle-core': { min: 30, jitter: 40 },  // 30–70ms — the original cadence
  'puzzle-max':  { min: 55, jitter: 55 },  // 55–110ms — thorough
};
const DEFAULT_MODEL = 'puzzle-core';
const MAX_SUFFIX =
  ' (puzzle-max adds: every answer in this demo is canned and streamed locally — no tokens were harmed.)';

// Each entry: keywords that select it + the answer. First match wins, so order
// the more specific topics before the general ones.
const KNOWLEDGE = [
  {
    keywords: ['formatter', 'format', 'pipe', 'timeago', 'currency'],
    answer:
      "Formatters are display-only transforms you pipe values through in a template: { price | currency('$', 2) } or { updatedAt | timeago }. They're Liquid-style and chainable — { text | trim | capitalize } — but strictly for presentation. Anything that filters or sorts data belongs in data(), not in a formatter. You register custom ones in the PuzzleApp config; this demo adds a `clock` formatter for message timestamps.",
  },
  {
    keywords: ['animation', 'animate', 'transition', 'motion'],
    answer:
      "Animations are declarative. A component sets an `animations` class field with `in` and `out` specs — each is { from, to, duration, easing?, delay? } — and Puzzle runs them through the Web Animations API on the element's own root, no wrapper. View route transitions are sequential: the old view plays `out`, the swap happens, then the new view plays `in` (non-blocking). Four hooks bracket the phases — viewWillShow/viewDidShow and viewWillHide/viewDidHide — and prefers-reduced-motion zeroes every duration.",
  },
  {
    keywords: ['nested', 'child route', 'slot', 'children'],
    answer:
      "Nested routes let a route carry children: [...] with paths relative to the parent, and the parent view renders its matched child at <Slot />. A path: '' entry is the index child that matches the bare URL. Params merge down the whole chain, so every level's data(params) sees the full merged params. This sidebar-plus-thread layout is exactly that: a Shell parent hosts a Welcome index child and a Thread child at c/:id.",
  },
  {
    keywords: ['route', 'router', 'navigation', 'push', 'url', 'link'],
    answer:
      "Routing is client-side and SPA-only. Routes map a path to a view (and an optional top-level layout); :id segments arrive as params in data(params). You navigate with this.ctx.router.push('/c/123'). The URL commits atomically — only after the new view's data() resolves — so a failed navigation changes nothing. There's a '*' catch-all for 404s, opt-in hash mode for static hosts, and the router owns scroll restoration across back/forward.",
  },
  {
    keywords: ['pzl', 'single-file', 'anatomy', 'component file', 'structure'],
    answer:
      "A .pzl file is a single-file component: an HTML template at the top, a <script> block exporting a class that extends PuzzleView (real JavaScript, handed straight to esbuild), and an optional <style> block. Views and layouts use a <puzzle-view> root; reusable components need one single root element. The Go compiler turns the template into a render() function attached to your class by prototype assignment — it never rewrites your class body.",
  },
  {
    keywords: ['skeleton', 'loading', 'placeholder', 'ghost'],
    answer:
      "A <puzzle-skeleton> section is an optional loading template shown while a component's first data() is still pending, then swapped for the real thing once the data commits. A routed view that declares one commits its navigation immediately and shows the skeleton instead of gating on data(). It uses the full template grammar — a range {#for 1...3} is the idiomatic way to repeat ghost rows — but only created()-seeded state is readable there. This Thread view uses one; it re-appears only on a conversation's first open.",
  },
  {
    keywords: ['store', 'reactive', 'reactivity', 'data', 'record', 'model', 'subscribe'],
    answer:
      "The store is a reactive datastore. Any query you run inside data() — findOne, findMany — auto-subscribes the component, so when a matching record changes the component's data() re-runs and the view patches. That's how a streamed token lands: the assistant message record is update()'d through the store on every word, which re-renders this thread AND bumps the conversation to the top of the sidebar. Local UI state that shouldn't trigger a re-query uses setData() instead.",
  },
  {
    keywords: ['event', 'modifier', 'prevent', 'stop', 'keydown', 'submit', 'handler'],
    answer:
      "Event handlers are @event={ handler } bindings wired per-node — @click={ save }, @submit={ addTodo(event) }. Modifiers stack after a colon: @submit:prevent calls preventDefault, @click:stop stops propagation, @click:once fires exactly once, and key filters like @keydown:escape gate on event.key. This composer uses @submit:prevent on the form and @keydown:escape to clear the draft; each sidebar row's delete button uses @click:stop so it doesn't also select the row.",
  },
  {
    keywords: ['what is puzzle', 'about puzzle', 'framework', 'overview', 'svelte', 'vue'],
    answer:
      "Puzzle is a SPA-first JavaScript framework: single-file .pzl components like Svelte, reactive data like Vue, conventions like Ember, and Liquid-style formatters — compiled by a fast Go toolchain into a small virtual-DOM runtime. It's client-side only, no SSR. This chat app is a demo showcasing the v1.5–v1.8 features: skeleton loading, {#case}/{#unless}, event modifiers, nested routes, and store-driven streaming.",
  },
];

const FALLBACKS = [
  "I'm a local demo assistant, so I only really know about the Puzzle framework itself. Try asking about formatters, animations, nested routes, the store, event modifiers, skeleton loading, or what a .pzl file looks like.",
  "Good question! This assistant is fully offline — its answers are canned and keyword-matched. Ask me how animations, routing, reactivity, or the template grammar work and I'll have a real answer for you.",
];

function pickAnswer(promptText) {
  const q = String(promptText || '').toLowerCase();
  for (const entry of KNOWLEDGE) {
    if (entry.keywords.some((k) => q.includes(k))) return entry.answer;
  }
  // Deterministic fallback so the same prompt always yields the same reply.
  const idx = q.length % FALLBACKS.length;
  return FALLBACKS[idx];
}

export function streamReply(promptText, { onToken, onDone, model } = {}) {
  const cadence = CADENCE[model] || CADENCE[DEFAULT_MODEL];
  let answer = pickAnswer(promptText);
  // puzzle-max is more "thorough": deterministically append one closing line.
  if (model === 'puzzle-max') answer += MAX_SUFFIX;
  // Keep the spaces attached to the following word so re-joining is exact.
  const words = answer.split(' ');
  let i = 0;
  let timer = null;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    if (i >= words.length) {
      timer = null;
      if (typeof onDone === 'function') onDone();
      return;
    }
    const word = i === 0 ? words[i] : ' ' + words[i];
    i += 1;
    if (typeof onToken === 'function') onToken(word);
    // Per-model cadence + jitter so the drip feels alive rather than metronomic.
    timer = setTimeout(tick, cadence.min + Math.floor(Math.random() * cadence.jitter));
  };

  // Kick off after a beat so the typing indicator is visible before word one.
  timer = setTimeout(tick, 260);

  return function cancel() {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
