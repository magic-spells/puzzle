import Shell from './layouts/Shell.pzl';
import ConnectionView from './views/Connection.pzl';
import ViewsView from './views/Views.pzl';
import StoreView from './views/Store.pzl';
import SubscriptionsView from './views/Subscriptions.pzl';
import RouterView from './views/Router.pzl';
import PerformanceView from './views/Performance.pzl';

// Hash routing: the panel is loaded from chrome-extension://<id>/panel.html, so
// pathname routing would push URLs Chrome cannot serve on reload.
export default [
	{
		path: '/',
		name: 'connection',
		view: ConnectionView,
		layout: Shell,
		meta: { title: 'Puzzle · Connection' },
	},
	{
		path: '/views',
		name: 'views',
		view: ViewsView,
		layout: Shell,
		meta: { title: 'Puzzle · Views' },
	},
	{
		path: '/store',
		name: 'store',
		view: StoreView,
		layout: Shell,
		meta: { title: 'Puzzle · Store' },
	},
	{
		path: '/subscriptions',
		name: 'subscriptions',
		view: SubscriptionsView,
		layout: Shell,
		meta: { title: 'Puzzle · Subscriptions' },
	},
	{
		path: '/router',
		name: 'router',
		view: RouterView,
		layout: Shell,
		meta: { title: 'Puzzle · Router' },
	},
	{
		path: '/performance',
		name: 'performance',
		view: PerformanceView,
		layout: Shell,
		meta: { title: 'Puzzle · Performance' },
	},
	// The catch-all matches everything, so it stays LAST.
	{
		path: '*',
		name: 'not-found',
		view: ConnectionView,
		layout: Shell,
	},
];
