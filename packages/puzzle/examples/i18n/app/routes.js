import Home from './views/Home.pzl';
import About from './views/About.pzl';
import NotFound from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

// Route titles are plain strings here; `meta: { title: { t: 'key' } }` would
// translate them (D177). Under prefix routing no route may start with a locale
// tag (/es, /pl): those are the other languages' URLs.
export default [
	{ path: '/', name: 'home', view: Home, layout: DefaultLayout, meta: { title: 'Puzzle · i18n' } },
	{ path: '/about', name: 'about', view: About, layout: DefaultLayout, meta: { title: 'Puzzle · i18n' } },
	{ path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Puzzle · i18n' } },
];
