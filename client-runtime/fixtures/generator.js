/**
 * Schema-driven fixture generation (v1.57, D95) — the data half of `store.seed()`.
 *
 * Part of the detachable `/fixtures` module (D98): nothing in the core runtime
 * imports this file. It reaches an app only when the build was made with
 * `puzzle dev --fixtures` / `puzzle build --fixtures`, or when a test imports
 * `@magic-spells/puzzle/fixtures` directly. There is no build define to fold —
 * an app that never installs the module never links it.
 *
 * The schema ALREADY declares the types: `Puzzle.string()`, `.number()`,
 * `.oneOf()`, `.min()/.max()`, `belongsTo`. That is enough to generate believable
 * records with no second declaration anywhere, which is why this can exist at all
 * — a fixture library bolted onto an untyped store would need every shape spelled
 * out by hand.
 *
 * Determinism is the whole contract. Nothing here reads `Math.random()` or the
 * clock: values come from a seeded mulberry32 stream the module keeps per Store
 * (state.js), so two stores generating under the same seed produce byte-identical
 * data and a test snapshot never churns. (The ONE exception is an auto-generated
 * primary key: fixtures deliberately leave the pk to the Store's existing
 * `_genId`, which is random — see generateFixture. Pass explicit ids when a test
 * needs them stable.)
 *
 * Generated records go through the normal `createRecord` path, so schema defaults
 * (D48) and pk assignment behave exactly as in production. A fixture that could
 * not exist at runtime would be worthless.
 */

/**
 * mulberry32 — 32-bit seeded PRNG, ~10 lines, no dependency. Returns a function
 * producing floats in [0, 1). Chosen over xorshift for the shorter body and a
 * full 2^32 period, which is far more than a fixture run needs.
 */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function next() {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Default seed when `installFixtures()` is given no `seed` (0x5eed — "seed"). */
export const DEFAULT_FIXTURE_SEED = 0x5eed;

/**
 * Offset applied to the fixture seed for the mock adapter's own PRNG stream, so
 * latency ranges and `failRate` rolls do NOT share a stream with value
 * generation. Sharing would mean that adding a `store.seed()` call to a test
 * silently changed which requests fail — deterministic, but uselessly fragile.
 * Both streams still derive from the one seed.
 */
export const MOCK_STREAM_OFFSET = 0x9e3779b9;

// Deliberately small corpus: enough for readable values, not a faker clone.
const WORDS = [
	'alpha', 'beacon', 'cedar', 'delta', 'ember', 'fable',
	'garnet', 'harbor', 'indigo', 'juniper', 'kestrel', 'lumen',
	'marble', 'nimbus', 'onyx', 'pebble', 'quartz', 'ripple',
	'summit', 'tangent', 'umber', 'violet', 'willow', 'zephyr',
];

// Fixture "now". Dates are derived from the SEED, never the clock (a clock-based
// fixture is not reproducible), so the spread hangs off one fixed epoch.
const DAY = 86400000;
const FIXTURE_EPOCH = Date.UTC(2026, 0, 1);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

function words(rand, count) {
	const out = [];
	for (let i = 0; i < count; i++) out.push(pick(rand, WORDS));
	return out;
}

/** First declared value for a rule name ('min'/'max'), or undefined. */
function ruleValue(def, name) {
	for (const rule of def.validate || []) {
		if (rule.rule === name) return rule.value;
	}
	return undefined;
}

/** The `.oneOf()` allow-list when one is declared and usable, else null. */
function oneOfValues(def) {
	const values = ruleValue(def, 'oneOf');
	return Array.isArray(values) && values.length ? values : null;
}

/**
 * Field-name-aware string. Cheap heuristics only — an `email` field should look
 * like an email and a `title` like words, because a fixture you cannot read is
 * barely better than no fixture. Everything else is two words.
 */
function generateString(field, rand, index) {
	const name = field.toLowerCase();
	if (name.includes('email')) return `${pick(rand, WORDS)}.${index + 1}@example.com`;
	if (name.includes('url') || name.includes('href') || name.includes('link') || name.includes('website')) {
		return `https://example.com/${words(rand, 2).join('-')}`;
	}
	if (name.includes('slug')) return `${words(rand, 2).join('-')}-${index + 1}`;
	if (name.includes('name') || name.includes('title') || name.includes('label') || name.includes('subject')) {
		return words(rand, 2).map(capitalize).join(' ');
	}
	if (
		name.includes('description') || name.includes('summary') || name.includes('body') ||
		name.includes('content') || name.includes('note') || name.includes('text')
	) {
		return `${capitalize(words(rand, 6).join(' '))}.`;
	}
	return words(rand, 2).join(' ');
}

/**
 * Bring a generated string inside the declared `.min()`/`.max()` LENGTH bounds
 * (§20 measures strings by length). Pad first, then clamp — so a contradictory
 * `min(20).max(5)` schema, which nothing can satisfy, resolves toward max rather
 * than looping.
 */
function clampLength(value, rand, min, max) {
	let out = value;
	while (typeof min === 'number' && out.length < min) out += ` ${pick(rand, WORDS)}`;
	if (typeof max === 'number' && out.length > max) out = out.slice(0, Math.max(0, max));
	return out;
}

/** Integer inside `.min()`/`.max()`; an unbounded field spreads over [0, 100]. */
function generateNumber(rand, min, max) {
	const lo = typeof min === 'number' ? min : 0;
	const hi = typeof max === 'number' ? max : lo + 100;
	if (hi <= lo) return lo;
	const value = Math.min(hi, lo + Math.floor(rand() * (hi - lo + 1)));
	return value < lo ? lo : value;
}

/**
 * A date in the 30 days before the fixture epoch — "recent" without touching the
 * clock. Declared `.min()`/`.max()` Dates replace the bounds. Rounded to the
 * second so serialized fixtures stay readable.
 */
function generateDate(rand, min, max) {
	const lo = min instanceof Date ? min.getTime() : FIXTURE_EPOCH - 30 * DAY;
	const hi = max instanceof Date ? max.getTime() : FIXTURE_EPOCH;
	if (!(hi > lo)) return new Date(lo);
	const at = lo + Math.floor(rand() * (hi - lo));
	return new Date(Math.max(lo, Math.floor(at / 1000) * 1000));
}

/**
 * One field's value from its normalized descriptor, or undefined to leave the
 * field absent. `.oneOf()` wins over the type generator — never generate a value
 * the schema would immediately reject. array/object are empty by design: the
 * schema does not describe their inner shape, and inventing one would be fiction.
 */
function generateValue(field, def, rand, index) {
	const allowed = oneOfValues(def);
	if (allowed) return pick(rand, allowed);

	const min = ruleValue(def, 'min');
	const max = ruleValue(def, 'max');
	switch (def.type) {
		case 'string':
			return clampLength(generateString(field, rand, index), rand, min, max);
		case 'number':
			return generateNumber(rand, min, max);
		case 'boolean':
			return rand() < 0.5;
		case 'date':
			return generateDate(rand, min, max);
		case 'array':
			return [];
		case 'object':
			return {};
		default:
			// An untyped descriptor says nothing generatable — leave it absent
			// rather than guess (a wrong guess fails validation at createRecord).
			return undefined;
	}
}

/**
 * Author-supplied primary key (`.primary().required()` — a slug, a code). Shaped
 * for UNIQUENESS first, because a duplicate pk throws at createRecord: `todo-1`,
 * `todo-2`, … off the Store's monotonic fixture index. Word-salad would collide.
 */
function generatePrimaryKey(type, def, index) {
	if (def.type === 'number') return index + 1;
	return `${type}-${index + 1}`;
}

/**
 * `belongsTo` foreign keys (D49). The FK is `<relationshipName>Id` by convention,
 * or `{ key }`. When the target type already holds records, wire the FK to a REAL
 * one so `record.author` resolves; when it holds none, leave the FK unset — a
 * fixture pointing at a nonexistent id is worse than one with no parent, and
 * recursively creating the parent would silently invent records the caller never
 * asked for (seed the parent type first).
 *
 * Reads `recordsByType` directly rather than `findMany`: seeding inside a tracked
 * `data()` must not subscribe the component to the parent collection.
 */
function relationshipKeys(store, Model, rand, overrides) {
	const out = {};
	const defs = typeof Model.relationshipDefs === 'function' ? Model.relationshipDefs() : {};
	for (const [name, def] of Object.entries(defs)) {
		if (def.kind !== 'belongsTo') continue;
		const fkKey = def.key || `${name}Id`;
		if (hasOwn(overrides, fkKey)) continue; // caller pinned it
		const parents = store.recordsByType.get(def.type);
		if (!parents || parents.size === 0) continue; // no parent → no dangling FK
		const list = [...parents.values()];
		const parent = list[Math.floor(rand() * list.length)];
		out[fkKey] = parent[store.modelFor(def.type).primaryKey()];
	}
	return out;
}

/**
 * Build ONE fixture's data object for `type` (v1.57, D95). The caller hands it to
 * `createRecord`, so this only has to produce plausible INPUT — defaults,
 * validation, and pk assignment stay the Store's job.
 *
 * Precedence, highest first: caller overrides → belongsTo FK wiring → declared
 * `.default()` (left absent so `applyDefaults` resolves it, including function
 * and deep-cloned object defaults) → generated value. An overridden field draws
 * NO random numbers, which keeps a fixed-override call's stream position honest.
 *
 * @param {Store} store
 * @param {string} type      registry type name
 * @param {object} overrides caller-supplied fields (always win)
 * @param {number} index     the monotonic fixture counter for this store
 * @param {Function} rand    the store's seeded fixture stream (state.js) — passed
 *   in rather than read off the Store, which owns no fixture state (D98)
 */
export function generateFixture(store, type, overrides, index, rand) {
	const Model = store.modelFor(type);
	const schema = Model.normalizedSchema();
	const pk = Model.primaryKey();
	const foreignKeys = relationshipKeys(store, Model, rand, overrides);

	const data = {};
	for (const [field, def] of Object.entries(schema)) {
		if (hasOwn(overrides, field)) continue;
		if (hasOwn(foreignKeys, field)) continue;
		if ('default' in def) continue; // applyDefaults owns it (D48)
		if (field === pk) {
			// An auto-generatable pk is the Store's to assign (_genId). Only an
			// EXPLICIT `.primary().required()` key must be supplied — that is exactly
			// the field createRecord rejects when blank (FEATURE-VALIDATE-PK-PARITY).
			if (def.explicitRequired) data[field] = generatePrimaryKey(type, def, index);
			continue;
		}
		const value = generateValue(field, def, rand, index);
		if (value !== undefined) data[field] = value;
	}

	return { ...data, ...foreignKeys, ...overrides };
}
