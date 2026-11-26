import type { Route } from '@magic-spells/puzzle';
import HomeView from './views/Home.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

const routes: Route[] = [
	{
		path: '/',
		name: 'home',
		view: HomeView,
		layout: DefaultLayout,
		meta: {
			title: 'Home',
		},
	},
	{
		path: '*',
		name: 'not-found',
		view: NotFoundView,
		layout: DefaultLayout,
		meta: {
			title: 'Not found',
		},
	},
];

export default routes;
