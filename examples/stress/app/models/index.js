import StressRecord from './record.js';
import FormRecord from './form-record.js';

/**
 * One general-purpose model class registered under one type name per scenario,
 * plus one scenario-specific class.
 *
 *   row   — the keyed-list / virtual-list benchmark rows
 *   sub   — the subscription-precision dataset
 *   nest  — deep-nest's per-node records (plus its one shared `global` record)
 *   storm — write-storm's 10k mutation target
 *   fmt   — the formatter scenario's rows
 *   loop  — loop-trap's single feedback record
 *   form  — form-state's single 24-field draft record (its OWN class)
 *
 * Registering one class under several type names is fine: the store stamps
 * `_type` per record, and generated primary keys are prefixed with the TYPE
 * (`row-1`, `sub-1`, `nest-1`), so the id spaces never collide.
 *
 * `form` is the exception, and deliberately so. `form-state` measures what a
 * single-field `record.update()` costs, and the dominant term is
 * `PuzzleModel.normalizedSchema()` running once per declared field per call —
 * three times per update. StressRecord's 9 fields would understate that by
 * nearly 3x, so FormRecord declares the 24 fields of an ordinary signup form
 * with a realistic required/min/max/oneOf rule mix. Sharing StressRecord would
 * have made the number unrecognisable to an app author.
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
	form: FormRecord,
};
