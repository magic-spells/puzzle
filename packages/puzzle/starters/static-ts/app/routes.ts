import type { Route } from '@magic-spells/puzzle';
import HomeView from './views/Home.pzl';
import AboutView from './views/About.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

// Each route is a page: / is dist/index.html, /about is dist/about/index.html,
// and the catch-all is dist/404.html, which hosts serve for a missing page.
const routes: Route[] = [
	{ path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home' } },
	{ path: '/about', name: 'about', view: AboutView, layout: DefaultLayout, meta: { title: 'About us' } },
	{ path: '*', name: 'not-found', view: NotFoundView, layout: DefaultLayout, meta: { title: 'Not found' } },
];

export default routes;
