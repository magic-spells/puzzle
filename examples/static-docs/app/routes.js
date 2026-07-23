import HomeView from './views/Home.pzl';
import AboutView from './views/About.pzl';
import PlaygroundView from './views/Playground.pzl';
import NotFoundView from './views/NotFound.pzl';
import GuideShell from './views/guide/GuideShell.pzl';
import GuideIndex from './views/guide/GuideIndex.pzl';
import GuideTemplates from './views/guide/GuideTemplates.pzl';
import DefaultLayout from './layouts/Default.pzl';

// Each route carries a `meta.title` (SPEC §2). In static mode (D80) the build
// walks the matched layout+view chain leaf → root and injects the nearest-defined
// title into each page's <title> — the same walk the SPA router's #setTitle does.
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
  // its own <Slot/>. Child paths are RELATIVE and JOIN onto /guide, so the build
  // emits dist/guide/index.html (the index child) and dist/guide/templates/index.html
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

  // Client-rendered island (D67/D80): `prerender: false` opts this route OUT of
  // prerendering. In static mode the build writes an empty-target shell at
  // /playground/ — no baked markup, `#app` unstamped — but still ships the page's
  // data island and entry module, so the view renders entirely client-side. The
  // escape hatch for routes that are pure interaction.
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

  // Catch-all (D67 · D19): the top-level `path: '*'` matches any URL no earlier
  // route claims. In static mode the build renders it to dist/404.html — the file
  // static hosts (GitHub Pages/Netlify/Render/Cloudflare) serve for unknown paths.
  // Must stay LAST: routes match in order. (A dynamic `:param` route would be
  // SKIPPED here with a build warning — the static build cannot enumerate its
  // paths; a staticPaths() hook is the planned follow-up.)
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
