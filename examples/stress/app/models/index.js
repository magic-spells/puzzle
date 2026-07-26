import StressRecord from './record.js';

/**
 * Two registered types, one model class.
 *
 * The scenarios must not disturb each other's data, so each owns a type:
 *   row — the keyed-list benchmark rows
 *   sub — the subscription-precision dataset
 *
 * Registering one class under two type names is fine: the store stamps `_type`
 * per record, and generated primary keys are prefixed with the TYPE (`row-1`,
 * `sub-1`), so the id spaces never collide.
 *
 * The nine unimplemented scenarios previously had placeholder types here; they
 * were removed along with the rest of their scaffolding. See README.md.
 */
export default {
	row: StressRecord,
	sub: StressRecord,
};
