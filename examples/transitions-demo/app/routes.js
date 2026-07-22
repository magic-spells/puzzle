import AuroraView from './views/Aurora.pzl';
import GalleryView from './views/Gallery.pzl';
import AboutView from './views/About.pzl';
import DefaultLayout from './layouts/Default.pzl';

// Three routes, one shared layout. Because every route reuses DefaultLayout,
// navigation takes the reused-layout path — the routed VIEW animates alone
// while the layout stays put (SPEC §12 "one animator per transition"). That is
// exactly the swap overlap mode pins and cross-fades (SPEC §26).
export default [
  {
    path: '/',
    name: 'aurora',
    view: AuroraView,
    layout: DefaultLayout,
    meta: { title: 'Aurora' }
  },
  {
    path: '/gallery',
    name: 'gallery',
    view: GalleryView,
    layout: DefaultLayout,
    meta: { title: 'Gallery' }
  },
  {
    path: '/about',
    name: 'about',
    view: AboutView,
    layout: DefaultLayout,
    meta: { title: 'About' }
  }
];
