import StressRecord from './record.js';

/**
 * One model class, registered under one type name per scenario.
 *
 * The scenarios must not disturb each other's data, so each owns a type:
 *   row   — the keyed-list / virtual-list benchmark rows
 *   sub   — the subscription-precision dataset
 *   nest  — deep-nest's per-node records (plus its one shared `global` record)
 *   storm — write-storm's 10k mutation target
 *   fmt   — the formatter scenario's rows
 *   loop  — loop-trap's single feedback record
 *
 * Registering one class under several type names is fine: the store stamps
 * `_type` per record, and generated primary keys are prefixed with the TYPE
 * (`row-1`, `sub-1`, `nest-1`), so the id spaces never collide.
 *
 * `islands` is deliberately absent — that scenario's 20,000 nodes are plain DOM
 * built from instance state, not store records. Giving it a type would imply the
 * island subtree is reactive, and the whole point is that it is frozen.
 */
export default {
	row: StressRecord,
	sub: StressRecord,
	nest: StressRecord,
	storm: StressRecord,
	fmt: StressRecord,
	loop: StressRecord,
};
