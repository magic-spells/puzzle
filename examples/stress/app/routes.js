import StressLayout from './layouts/StressLayout.pzl';
import Home from './views/Home.pzl';

/**
 * One route. Scenario selection rides on the QUERY STRING (`/?scenario=…&n=…`),
 * not on the path, so switching scenarios is a `router.replace()` that re-runs
 * Home's `data()` with a new route snapshot — no route table churn, and the
 * URL of any measurement is copy-pasteable.
 *
 * REMOVED (previous scaffolding): a `/route-churn` subtree — five nested levels
 * plus 50 generated leaf routes — that imported six `.pzl` files which were
 * never written. It is listed as future work in README.md.
 */
export default [
	{
		path: '/',
		name: 'stress-home',
		view: Home,
		layout: StressLayout,
		meta: { title: 'Puzzle Stress Lab' },
	},
];
