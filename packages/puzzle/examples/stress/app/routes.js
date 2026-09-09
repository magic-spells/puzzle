import StressLayout from './layouts/StressLayout.pzl';
import Home from './views/Home.pzl';
import { rcRoutes } from './rc-routes.js';

/**
 * Two entries, and they answer to different questions.
 *
 * `/` is THE LAB. Scenario selection rides on the QUERY STRING
 * (`/?scenario=…&n=…`), not on the path, so switching scenarios is a
 * `router.replace()` that re-runs Home's `data()` with a new route snapshot —
 * no route table churn, and the URL of any measurement is copy-pasteable.
 * Every scenario but one lives here, hosted in `#scenario-stage`.
 *
 * `/rc/…` is ROUTE-CHURN, the exception, because it measures the ROUTER and so
 * cannot be a component inside a stage — it needs real route nodes: five nested
 * ancestor levels and 50 leaves. It is a SIBLING subtree with its own layout,
 * so selecting it navigates out of `/` and Home unmounts; RcLayout registers
 * the scenario API and carries its own minimal panel. `rc-routes.js` records
 * why a sibling subtree beat the two alternatives (a second PuzzleApp, which
 * would tear down the DevTools bridge, and nesting under `/`, which would make
 * heavyweight Home a measured ancestor).
 *
 * This replaces the earlier deleted scaffolding, which imported six `.pzl`
 * files that were never written.
 */
export default [
	{
		path: '/',
		name: 'stress-home',
		view: Home,
		layout: StressLayout,
		meta: { title: 'Puzzle Stress Lab' },
	},
	...rcRoutes(),
];
