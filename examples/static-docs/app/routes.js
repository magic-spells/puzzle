import HomeView from './views/Home.pzl';
import AboutView from './views/About.pzl';
import PlaygroundView from './views/Playground.pzl';
import TagView from './views/TagView.pzl';
import NotFoundView from './views/NotFound.pzl';
import GuideShell from './views/guide/GuideShell.pzl';
import GuideIndex from './views/guide/GuideIndex.pzl';
import GuideTemplates from './views/guide/GuideTemplates.pzl';
import DefaultLayout from './layouts/Default.pzl';

// Each route carries a `meta.title` (SPEC §2). Under SSG (D67) the prerenderer
// walks the matched layout+view chain leaf → root and injects the nearest-defined
// title into the shell's <title> — the same walk the router's #setTitle does.
export default [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Field Guide',
    },
  },

  // Nested routes (v1.3, D30): the Guide shell renders its matched child pane at
  // its own <Slot/>. Child paths are RELATIVE and JOIN onto /guide, so SSG emits
  // dist/guide/index.html (the index child) and dist/guide/templates/index.html
  // (the sibling). The index child defines no meta.title, so the leaf → root walk
  // falls through to the shell's "Guide · …" — demonstrating the title walk. The
  // sibling defines its own, so it wins at its own path.
  {
    path: '/guide',
    name: 'guide',
    view: GuideShell,
    layout: DefaultLayout,
    meta: {
      title: 'Guide · Puzzle Field Guide',
    },
    children: [
      { path: '', name: 'guide-index', view: GuideIndex },
      {
        path: 'templates',
        name: 'guide-templates',
        view: GuideTemplates,
        meta: { title: 'Template syntax · Puzzle Field Guide' },
      },
    ],
  },

  {
    path: '/about',
    name: 'about',
    view: AboutView,
    layout: DefaultLayout,
    meta: {
      title: 'About · Puzzle Field Guide',
    },
  },

  // Dynamic route (v1 boundary, D67): a `:param` route cannot be prerendered
  // without a `staticPaths()` enumeration (a documented follow-up), so `puzzle
  // build --static` SKIPS it with a build warning and writes NO file. It still
  // works as a normal SPA route once the app is live.
  {
    path: '/tags/:tag',
    name: 'tag',
    view: TagView,
    layout: DefaultLayout,
    meta: {
      title: 'Tag · Puzzle Field Guide',
    },
  },

  // SPA island (v1 boundary, D67): `prerender: false` opts this route OUT of
  // prerendering. The build writes the plain SPA shell (no data-puzzle-ssg
  // marker, no rendered markup) at /playground/, and the runtime renders it
  // client-side like any SPA page — the escape hatch for interactive-only pages.
  {
    path: '/playground',
    name: 'playground',
    view: PlaygroundView,
    layout: DefaultLayout,
    prerender: false,
    meta: {
      title: 'Playground · Puzzle Field Guide',
    },
  },

  // Catch-all (v1.33+, D67 · D19): the top-level `path: '*'` matches any URL no
  // earlier route claims. Under SSG the prerenderer renders it to dist/404.html —
  // the file static hosts (GitHub Pages/Netlify/Render/Cloudflare) serve for
  // unknown paths — and once the SPA takes over the router shows this view for any
  // unmatched client path. Must stay LAST: routes match in order.
  {
    path: '*',
    name: 'not-found',
    view: NotFoundView,
    layout: DefaultLayout,
    meta: {
      title: 'Not found · Puzzle Field Guide',
    },
  },
];
