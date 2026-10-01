import Home from './views/Home.pzl';
import About from './views/About.pzl';
import NotFound from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

// Route titles stay static strings (D84); translated tab titles are future work.
export default [
	{ path: '/', name: 'home', view: Home, layout: DefaultLayout, meta: { title: 'Puzzle · i18n' } },
	{ path: '/about', name: 'about', view: About, layout: DefaultLayout, meta: { title: 'Puzzle · i18n' } },
	{ path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Puzzle · i18n' } },
];
