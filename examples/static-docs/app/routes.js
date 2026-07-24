import HomeView from './views/Home.pzl';
import AboutView from './views/About.pzl';
import PlaygroundView from './views/Playground.pzl';
import NotFoundView from './views/NotFound.pzl';
import GuideShell from './views/guide/GuideShell.pzl';
import GuideIndex from './views/guide/GuideIndex.pzl';
import GuideTemplates from './views/guide/GuideTemplates.pzl';
import DefaultLayout from './layouts/Default.pzl';

// Each route carries a `meta.title` (SPEC §2). In static mode (D81) the build
// walks the matched layout+view chain leaf → root and injects the nearest-defined
// title into each page's <title> — the same walk the SPA router's #setTitle does.
//
// Since v1.50 (D84) `meta` also carries the other RESERVED head fields —
// `description`, `canonical`, `socialImage` — rendered as managed head tags
// (each stamped data-puzzle-head) baked into every prerendered page, so
// crawlers and link unfurlers see them before any JavaScript runs. Each field
// resolves independently, nearest-defined leaf → root; `undefined` inherits,
// `null` explicitly suppresses. Static strings only.
export default [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Field Guide',
      description: 'A short field guide to the Puzzle framework, shipped as true static pages — no router, no app.js, one small module per page.',
      // socialImage → og:image + twitter:image (+ twitter:card). Real
      // deployments should point at an absolute URL — unfurlers don't resolve
      // relative paths — served from app/public/.
      socialImage: 'https://puzzle.magic-spells.dev/og-card.png',
    },
  },

  // Nested routes (v1.3, D30): the Guide shell renders its matched child pane at
  // its own <Slot/>. Child paths are RELATIVE and JOIN onto /guide, so the build
  // emits dist/guide/index.html (the index child) and dist/guide/templates/index.html
  // (the sibling). The index child defines no meta.title, so the leaf → root walk
  // falls through to the shell's "Guide · …" — demonstrating the title walk. The
  // sibling defines its own, so it wins at its own path.
  //
  // The same walk runs PER HEAD FIELD (v1.50): the index child also inherits the
  // shell's `description`, while the templates sibling sets `description: null`
  // — explicit suppression, so dist/guide/templates/index.html ships NO
  // description tags at all (compare it with dist/guide/index.html).
  {
    path: '/guide',
    name: 'guide',
    view: GuideShell,
    layout: DefaultLayout,
    meta: {
      title: 'Guide · Puzzle Field Guide',
      description: 'The guide section of the Puzzle field guide: how templates, views, and static output fit together.',
    },
    children: [
      { path: '', name: 'guide-index', view: GuideIndex },
      {
        path: 'templates',
        name: 'guide-templates',
        view: GuideTemplates,
        meta: { title: 'Template syntax · Puzzle Field Guide', description: null },
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
      description: 'Why this example exists: build-time data, rehydration, and the three principles baked into the About page.',
    },
  },

  // Client-rendered island (D67/D81): `prerender: false` opts this route OUT of
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
