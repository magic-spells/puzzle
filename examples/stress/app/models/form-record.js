import { Puzzle, PuzzleModel } from '@magic-spells/puzzle';

/**
 * A realistic 24-field form record — `form-state`'s single `form:draft` record.
 *
 * It is deliberately NOT `StressRecord`. The whole point of the `type-store`
 * arm is what ONE `record.update({ text })` costs, and the dominant term in that
 * cost is `PuzzleModel.normalizedSchema()` (client-runtime/model.js), which is
 * recomputed from scratch on every call:
 *
 *   Object.entries(this.schema) → filter relationships → collapse FieldBuilders
 *
 * That is O(schema fields), it is not memoized, and a single-field update()
 * reaches it three times:
 *
 *   1. `primaryKey()`          — the immutable-pk guard in update()
 *   2. `_collectErrors()`      — the §20 validation pass (which iterates ALL
 *                                declared fields and skips the ones not in the
 *                                patch, so the `fields` filter narrows the
 *                                CHECKS but never the iteration)
 *   3. `primaryKey()` again    — Store.recordChanged() building the notify key
 *
 * A 9-field record would understate that by nearly 3x. Twenty-four fields is an
 * ordinary signup/checkout form, so the number the scenario reports is one an
 * app author can recognise.
 *
 * The rule mix (required / min / max / oneOf) is not decoration either: it is
 * what `_collectErrors` walks. Fields carrying `.default()` are also the ones
 * the store's applyDefaults owns, so the seed data below only supplies the
 * required fields plus `text`.
 *
 * `text` is the field the typing arms drive. Its `.max(400)` clears the
 * 200-character progressive-typing strokes with room to spare — a bound that
 * rejected a stroke would turn a measurement into a thrown validation error.
 */
export default class FormRecord extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary().required(),

		// The typed field. Every keystroke in `type-store` is one update() of this.
		text: Puzzle.string().required().min(1).max(400),

		firstName: Puzzle.string().required().min(1).max(60),
		lastName: Puzzle.string().required().min(1).max(60),
		email: Puzzle.string().required().min(3).max(120),
		phone: Puzzle.string().max(24),
		company: Puzzle.string().max(120),
		jobTitle: Puzzle.string().max(120),

		addressLine1: Puzzle.string().required().min(1).max(160),
		addressLine2: Puzzle.string().max(160),
		city: Puzzle.string().required().min(1).max(80),
		region: Puzzle.string().max(80),
		postalCode: Puzzle.string().required().min(3).max(12),
		country: Puzzle.string().required().oneOf(['US', 'CA', 'GB', 'DE', 'FR', 'JP', 'AU', 'BR']),

		plan: Puzzle.string().required().oneOf(['free', 'pro', 'team', 'enterprise']),
		seats: Puzzle.number().min(1).max(500).default(1),
		billingCycle: Puzzle.string().oneOf(['monthly', 'annual']).default('monthly'),
		discountPct: Puzzle.number().min(0).max(100).default(0),

		notes: Puzzle.string().max(2000),
		newsletter: Puzzle.boolean().default(false),
		termsAccepted: Puzzle.boolean().default(false),
		contactMethod: Puzzle.string().oneOf(['email', 'phone', 'sms', 'none']).default('email'),

		startsOn: Puzzle.date(),
		updatedAt: Puzzle.date(),
	};
}

/**
 * The record `form-state` creates, minus the six `.default()`-owned fields.
 *
 * Every `.required()` field is present and every `.min()` satisfied, so
 * `store.createRecord()` — the one path that validates (D48) — cannot throw
 * while the scenario is building its dataset.
 */
export const FORM_DRAFT_SEED = {
	text: 'draft',
	firstName: 'Ada',
	lastName: 'Lovelace',
	email: 'ada@example.com',
	phone: '+1 555 0100',
	company: 'Analytical Engines',
	jobTitle: 'Engineer',
	addressLine1: '1 Bernoulli Way',
	addressLine2: 'Suite 2',
	city: 'London',
	region: 'Greater London',
	postalCode: 'NW1 4RY',
	country: 'GB',
	plan: 'pro',
	notes: 'seeded by examples/stress/app/scenarios/FormState.pzl',
};
