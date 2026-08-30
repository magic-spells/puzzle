/**
 * The two value-shape helpers the route-view checks share.
 *
 * They live here rather than in lazy.js so router.js can validate a route's
 * `view`/`layout` without importing the D163 resolver: the `__PUZZLE_HAS_LAZY__`
 * gate (D89 pattern) folds every lazy.js reference out of an app that never
 * calls `lazy()`, and validation must survive that fold — a route table is
 * checked whether or not the app uses lazy routes.
 */

import { PuzzleView } from '../views/PuzzleView.js';

/** Whether a value is the PuzzleView base class or a subclass of it. */
export function isViewClass(value) {
	return (
		typeof value === 'function' && (value === PuzzleView || value.prototype instanceof PuzzleView)
	);
}

/** A short, allocation-free description of a rejected value for diagnostics. */
export function describeValue(value) {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	return typeof value;
}
