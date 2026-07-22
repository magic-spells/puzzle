import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';

// ---------------------------------------------------------------------------
// Two apps, one page — a side-by-side of v1.24 route transition modes (§26).
//
// Both apps mount the SAME three-route module. The only difference is the
// PuzzleApp config: the left app omits `transitionMode` (→ sequential, the
// default), the right app sets `transitionMode: 'overlap'`. A shared control
// bar drives BOTH routers at once so the contrast is instant.
//
// The routers run in MEMORY mode (SPEC §15) — the route lives entirely in
// router state, so two apps coexist on one page with zero URL / history /
// document.title side effects stepping on each other. `routerInitialPath`
// names the first route (there is no URL to read in memory mode).
// ---------------------------------------------------------------------------

const seqApp = new PuzzleApp({
  target: '#app-seq',
  routes,
  models: {},
  routerMode: 'memory',
  routerInitialPath: '/'
  // no transitionMode → 'sequential' (byte-identical to v1.23): the old view's
  // `out` fully plays, THEN the new view mounts and plays `in` — the tell-tale
  // blank gap between the two slides.
});

const overlapApp = new PuzzleApp({
  target: '#app-overlap',
  routes,
  models: {},
  routerMode: 'memory',
  routerInitialPath: '/',
  transitionMode: 'overlap'
  // 'overlap' (SPEC §26): the router pins the leaver in place (position:fixed at
  // its measured rect, no wrapper) and mounts the newcomer immediately, so both
  // slides play concurrently — a shared-axis cross-slide with no gap.
});

// The three routes, in nav order, wired to the control-bar buttons below.
const NAV = [
  { path: '/', name: 'aurora', label: 'Aurora' },
  { path: '/gallery', name: 'gallery', label: 'Gallery' },
  { path: '/about', name: 'about', label: 'About' }
];

// Mount both, THEN wire the shared control bar (app.router exists once mount()
// has run — we await both so the initial active state reads a live router).
Promise.all([seqApp.mount(), overlapApp.mount()]).then(wireControls);

// ---------------------------------------------------------------------------
// Shared control bar — plain DOM built against the #controls div in index.html.
// Every button fires the same router method on BOTH apps, so a single click
// navigates the sequential and overlap apps in lockstep and you watch the two
// transition styles resolve side by side.
// ---------------------------------------------------------------------------
function wireControls() {
  const bar = document.querySelector('#controls');

  // Route buttons — push the same path into both routers at once.
  const routeButtons = NAV.map(({ path, name, label }) => {
    const btn = document.createElement('button');
    btn.className = 'ctl ctl-route';
    btn.textContent = label;
    btn.dataset.name = name;
    btn.addEventListener('click', () => navigate(path));
    return btn;
  });

  // History buttons — go/back/forward land in memory mode too (SPEC §15/§9).
  const backBtn = document.createElement('button');
  backBtn.className = 'ctl ctl-history';
  backBtn.textContent = '← Back';
  backBtn.addEventListener('click', () => step('back'));

  const fwdBtn = document.createElement('button');
  fwdBtn.className = 'ctl ctl-history';
  fwdBtn.textContent = 'Forward →';
  fwdBtn.addEventListener('click', () => step('forward'));

  const routeGroup = document.createElement('div');
  routeGroup.className = 'ctl-group';
  routeButtons.forEach((b) => routeGroup.appendChild(b));

  const historyGroup = document.createElement('div');
  historyGroup.className = 'ctl-group';
  historyGroup.appendChild(backBtn);
  historyGroup.appendChild(fwdBtn);

  bar.appendChild(routeGroup);
  bar.appendChild(historyGroup);

  // Drive both routers, then re-mark the active route button.
  function navigate(path) {
    Promise.all([seqApp.router.push(path), overlapApp.router.push(path)]).then(renderActive);
  }

  function step(dir) {
    Promise.all([seqApp.router[dir](), overlapApp.router[dir]()]).then(renderActive);
  }

  // Highlight the button whose route is currently committed. Read it back from a
  // live router (both are always in sync) rather than tracking it separately.
  function renderActive() {
    const activeName = seqApp.router.current?.route?.name;
    routeButtons.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.name === activeName);
    });
  }

  renderActive();
}

export { seqApp, overlapApp };
