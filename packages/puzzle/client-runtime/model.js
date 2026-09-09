/**
 * PuzzleModel + Puzzle field builders — the model layer (constellation/doc/DOC-SPEC.md §7).
 *
 * Records ARE instances of the user's model class, so plain getters and
 * instance methods work anywhere a record is read. Schemas are declared with
 * the `Puzzle.*` builders; each builder accumulates a plain descriptor
 * (the internal normalized format).
 *
 * v1 enforcement: `.default()` and `.primary()` are honored (applyDefaults /
 * primaryKey). Since v1.16 the validation rules (`required`, `min`, `max`,
 * `oneOf`, `validate`) enforce at the local write boundary — see
 * constellation/doc/DOC-SPEC.md §20 (D48): createRecord/update throw
 * PuzzleValidationError, and Model.validate/record.validate return
 * { valid, errors } without throwing.
 */

import { parseDateInput } from './dates.js';

/**
 * Normalize record identity at every index/comparison boundary — never a
 * record's fields (D112).
 *
 * Subscription keys (`type + REC_SEP + id`) and adapter URLs already
 * string-coerce identity, so the record Map was the only type-sensitive index
 * in the datastore: a string route param (`findOne('post', '1')`) missed the
 * record a numeric-id JSON payload created, while the subscription still
 * fired. update()'s pk-immutability guard compares through the same
 * normalization, so `update({ id: '1' })` on a record keyed 1 is the no-op it
 * reads as.
 *
 * ONLY numbers convert. null/undefined/objects pass through untouched, which
 * keeps belongsTo's null-FK short-circuit intact and stops String(null) from
 * colliding with a real 'null' string id. Record fields keep whatever type
 * the server sent.
 */
export const recordKey = (id) => (typeof id === 'number' ? String(id) : id);

class FieldBuilder {
	constructor(type) {
		this.def = { type, validate: [] };
	}

	primary() {
		this.def.primary = true;
		this.def.required = true;
		return this;
	}

	required(message) {
		this.def.required = true;
		// Record that required was asked for BY THE AUTHOR, distinct from the
		// `required` that `.primary()` implies. fieldErrors reads this to keep the
		// auto-generatable-primary exemption from swallowing an explicit
		// `.primary().required()` on a user-supplied key (e.g. a slug pk).
		this.def.explicitRequired = true;
		if (message) this.def.requiredMessage = message;
		return this;
	}

	default(value) {
		this.def.default = value;
		return this;
	}

	min(value, message) {
		this.def.validate.push({ rule: 'min', value, message });
		return this;
	}

	max(value, message) {
		this.def.validate.push({ rule: 'max', value, message });
		return this;
	}

	oneOf(values, message) {
		this.def.validate.push({ rule: 'oneOf', value: values, message });
		return this;
	}

	validate(fn, message) {
		this.def.validate.push({ rule: 'custom', value: fn, message });
		return this;
	}
}

/**
 * Relationship builder — `Puzzle.belongsTo('user')` / `Puzzle.hasMany('comment')`
 * (constellation/doc/DOC-SPEC.md §21, D49). A DISTINCT kind from FieldBuilder:
 * no chainable rule modifiers, because a relationship is not a field — it never
 * reaches applyDefaults, primaryKey, or the §20 validation engine. The Store
 * turns each descriptor into a lazy prototype getter at construction.
 *
 * Descriptor: `{ kind: 'hasMany'|'belongsTo', type, key? }`. The only option is
 * `{ key: 'fieldName' }` to override the by-convention foreign key.
 */
class RelationshipBuilder {
	constructor(kind, type, options = {}) {
		this.def = { kind, type };
		if (options && options.key) this.def.key = options.key;
	}
}

/**
 * Schema field builders — `Puzzle.string().required().min(1, 'msg')` — plus the
 * relationship builders `belongsTo`/`hasMany` (§21, D49). The only documented
 * way to declare fields (constellation/doc/DOC-DECISIONS.md D5).
 */
export const Puzzle = {
	string: () => new FieldBuilder('string'),
	number: () => new FieldBuilder('number'),
	boolean: () => new FieldBuilder('boolean'),
	date: () => new FieldBuilder('date'),
	array: () => new FieldBuilder('array'),
	object: () => new FieldBuilder('object'),

	// Relationships (constellation/doc/DOC-SPEC.md §21, D49) — resolve as lazy
	// store-backed getters installed by the Store; options is `{ key }` only.
	belongsTo: (type, options) => new RelationshipBuilder('belongsTo', type, options),
	hasMany: (type, options) => new RelationshipBuilder('hasMany', type, options),
};

/**
 * Thrown by store.createRecord() and record.update() when data fails the
 * schema's declared validation rules (constellation/doc/DOC-SPEC.md §20, D48).
 * `.errors` is `[{ field, rule, message }]` in schema-declaration order;
 * `.message` is the first error's message so a bare `err.message` is useful.
 */
export class PuzzleValidationError extends Error {
	constructor(errors = []) {
		super(errors.length ? errors[0].message : 'Validation failed');
		this.name = 'PuzzleValidationError';
		this.errors = errors;
	}
}

/**
 * Validate a single field's value against its normalized descriptor, returning
 * the field's errors in declared-rule order (constellation/doc/DOC-SPEC.md §20).
 *
 * `required` runs first and short-circuits the field's remaining rules on
 * failure; a NON-required field whose value is undefined/null skips its
 * remaining rules entirely. No type coercion anywhere — rules compare exactly
 * what they are given, and an incomparable/NaN-ish comparison is a pass (never
 * a throw). A custom validate(fn) that THROWS is left to propagate (a broken
 * validator is a programming error, not a validation failure).
 */
function fieldErrors(field, def, value) {
	const errors = [];
	const missing = value === undefined || value === null || value === '';

	// required first — short-circuits this field's remaining rules on failure.
	// A nullish primary key is the one exception: createRecord generates it before
	// enforcing D48, so the public pre-check must accept the same input. Keep ''
	// invalid because the Store only generates for null/undefined — real parity,
	// not a broader relaxation of `.primary()`'s required contract.
	//
	// The exemption applies ONLY to `.primary()`'s IMPLIED required, not to an
	// explicit `.primary().required()`. When the author chains `.required()`, a
	// user-supplied pk (e.g. `slug: string().primary().required()`) is contractually
	// mandatory: a blank value must surface the required error so a create form's
	// pre-check blocks submission instead of letting the Store silently auto-generate
	// a random key. See constellation/feature/FEATURE-VALIDATE-PK-PARITY.md.
	const autoGeneratablePrimary =
		def.primary && !def.explicitRequired && (value === undefined || value === null);
	if (def.required && missing && !autoGeneratablePrimary) {
		errors.push({
			field,
			rule: 'required',
			message: def.requiredMessage || `"${field}" is required`,
		});
		return errors;
	}

	// A non-required (or satisfied-required) field that is undefined/null has
	// nothing more to check — skip its remaining rules.
	if (value === undefined || value === null) return errors;

	for (const rule of def.validate || []) {
		const err = checkRule(field, def, rule, value);
		if (err) errors.push(err);
	}
	return errors;
}

/** Evaluate one non-required rule; returns an error entry or null (pass). */
function checkRule(field, def, rule, value) {
	switch (rule.rule) {
		case 'min':
		case 'max':
			return checkBound(field, def, rule, value);
		case 'oneOf': {
			const options = rule.value;
			if (Array.isArray(options) && options.includes(value)) return null;
			return {
				field,
				rule: 'oneOf',
				message: rule.message || `"${field}" must be one of: ${(options || []).join(', ')}`,
			};
		}
		case 'custom': {
			// A thrown exception propagates (D48) — only a falsy return is invalid.
			if (rule.value(value)) return null;
			return { field, rule: 'custom', message: rule.message || `"${field}" is invalid` };
		}
		default:
			return null;
	}
}

/**
 * min/max: strings & arrays compare `.length`; numbers & dates compare value.
 * Anything else — or a NaN-ish comparison — is a pass, never a throw (§20).
 *
 * Type-aware (constellation/doc/DOC-SPEC.md §20): a field DECLARED number/date
 * measures the VALUE, so a form-bound string like "150" must NOT satisfy
 * number().max(120) by its 3-char length — a wrong-runtime-type value is a type
 * mismatch (`"age" must be a number`), reported under the originating rule name.
 * NaN / an invalid Date stays a pass (incomparable). string/array and untyped
 * fields keep the .length semantics unchanged.
 */
function checkBound(field, def, rule, value) {
	if (def.type === 'number' && typeof value !== 'number') {
		return { field, rule: rule.rule, message: `"${field}" must be a number` };
	}
	if (def.type === 'date' && !(value instanceof Date)) {
		return { field, rule: rule.rule, message: `"${field}" must be a date` };
	}

	const isLength = typeof value === 'string' || Array.isArray(value);
	let measured;
	if (isLength) {
		measured = value.length;
	} else if (typeof value === 'number') {
		measured = value;
	} else if (value instanceof Date) {
		measured = value.getTime();
	} else {
		return null; // incomparable → pass
	}

	const n = rule.value;
	const bound = n instanceof Date ? n.getTime() : n;
	if (typeof measured !== 'number' || typeof bound !== 'number' || Number.isNaN(measured) || Number.isNaN(bound)) {
		return null; // NaN-ish / incomparable → pass
	}

	const outOfBound = rule.rule === 'min' ? measured < bound : measured > bound;
	if (!outOfBound) return null;

	const dir = rule.rule === 'min' ? 'at least' : 'at most';
	const message =
		rule.message ||
		(isLength ? `"${field}" length must be ${dir} ${n}` : `"${field}" must be ${dir} ${n}`);
	return { field, rule: rule.rule, message };
}

/**
 * Resolve a schema `.default()` for ONE record. A function default is invoked
 * per record; a non-null object/array default is deep-cloned per record so the
 * descriptor's single literal (`Puzzle.array().default([])`) is never shared by
 * reference across records — otherwise one record's push() would leak into every
 * other record AND into the schema descriptor. Primitives pass through as-is.
 */
function resolveDefault(value) {
	if (typeof value === 'function') return value();
	if (value !== null && typeof value === 'object') return structuredClone(value);
	return value;
}

// The prototype-pollution family — keys whose [[Set]] can re-prototype a record
// or shadow its class. `__proto__` hits Object.prototype's accessor setter (see
// safeAssign's note); an own `constructor`/`prototype` key doesn't re-prototype,
// but it SHADOWS the class reference on the instance, so `record.constructor.
// primaryKey()` / `_collectErrors` (which read the model class through the
// instance) then throw and blank the render. Both safeAssign and safeMerge skip
// this whole family; safeMerge adds the reserved internals below.
const POLLUTION_SKIP = new Set(['__proto__', 'constructor', 'prototype']);

// Keys that must never be copied off a server/storage payload onto a live record:
// the pollution family (above) plus the framework-reserved non-enumerable
// internals (`_store`/`_type`/`_synced`/`_deleted`).
const MERGE_SKIP = new Set([...POLLUTION_SKIP, '_store', '_type', '_synced', '_deleted']);

/**
 * The one save-after-removal message. save() raises it at CALL time; the Store's
 * _saveRecordNow raises the identical error when a save that was QUEUED behind
 * another write discovers the removal only on reaching the front of the chain.
 * Callers cannot tell those apart and must not have to, so the string lives here
 * and the Store imports it. Not re-exported from index.js — internal, not API.
 */
// Per-record local-mutation state used by save-response reconciliation. Weak
// storage keeps it off the deliberate record shape and releases it with the
// record. Each update() advances the record revision once and stamps every field
// in that patch, so a response can merge untouched fields while skipping only
// fields edited after its request was dispatched. Construction does NOT stamp
// (see safeAssignTracked), so a record that is never update()d never allocates
// an entry here at all.
const MUTATION_REVISIONS = new WeakMap();

// Warn-once state is allocated lazily inside the development gate below. A
// production build still must walk descriptors to avoid the strict-mode throw,
// but it should not allocate diagnostic bookkeeping it can never read.
let COLLISION_WARNINGS;

// What a payload key resolved to on the record's prototype chain. 0 = nothing in
// the way (assign it).
const COLLIDES_GETTER = 1;
const COLLIDES_METHOD = 2;
// Not a chain lookup — the key is in a skip set (reserved internal / pollution
// family). Only the update() path reports it; see assignSkipping.
const COLLIDES_RESERVED = 3;

/**
 * Follow the same resolved-property path [[Set]] would follow — all the way to
 * Object.prototype — and report what the key collides with. A model getter or
 * method may live on any superclass, not only the concrete model's immediate
 * prototype. Finding the FIRST descriptor matters too: an OWN property
 * legitimately shadows an inherited one and remains assignable.
 *
 * Object.prototype is IN the walk. POLLUTION_SKIP covers only the three names
 * that can re-prototype a record (`__proto__`/`constructor`/`prototype`); it
 * says nothing about the primitive-conversion pair. A payload key `toString` or
 * `valueOf` lands as an own DATA property, and the record then has no callable
 * conversion method at all — `String(record)`, `${record}`, and every template
 * that interpolates the whole record throw
 * `TypeError: Cannot convert object to primitive value`, blanking the render.
 * That is the same "a data field silently shadows a method" failure the model-
 * method rule exists to stop, so it takes the same answer: drop the value and
 * warn. Object.prototype's other methods (`hasOwnProperty`, `toLocaleString`,
 * `isPrototypeOf`, `propertyIsEnumerable`) ride along under the one rule rather
 * than an enumerated list that the next Object.prototype addition would outdate.
 */
function resolveCollision(target, key) {
	let owner = target;
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			// Accessor: getter-only is unassignable (strict-mode throw); an accessor
			// WITH a setter keeps its setter behavior, D49 relationships included.
			if ('get' in descriptor) {
				return descriptor.set === undefined ? COLLIDES_GETTER : 0;
			}
			// A method inherited from the model class (or PuzzleModel itself). An own
			// data property already shadows whatever is behind it and stays assignable.
			if (owner !== target && typeof descriptor.value === 'function') return COLLIDES_METHOD;
			return 0;
		}
		owner = Object.getPrototypeOf(owner);
	}
	return 0;
}

/** Warn once per (model class, key) that an incoming value was dropped. */
function warnCollision(target, key, reason) {
	COLLISION_WARNINGS ||= new WeakMap();
	const Model = target.constructor;
	let warned = COLLISION_WARNINGS.get(Model);
	if (!warned) {
		warned = new Set();
		COLLISION_WARNINGS.set(Model, warned);
	}
	if (warned.has(key)) return;
	warned.add(key);
	const name = Model.name || 'PuzzleModel';
	console.warn(
		reason === COLLIDES_GETTER
			? `[puzzle] "${key}" collides with a computed getter on model "${name}" — the incoming value was ignored`
			: reason === COLLIDES_METHOD
				? `[puzzle] "${key}" collides with a method on model "${name}" — the incoming value was ignored`
				: `[puzzle] "${key}" is a reserved record field on model "${name}" — the incoming value was ignored`
	);
}

/**
 * Shared body of safeAssign/safeMerge: assign every allowed own key.
 *
 * `applied` marks the LOCAL update() path: accepted keys are collected into it
 * for the mutation stamp (a skipped key must never be stamped), and a
 * reserved-key skip warns in development — a patch is author-written, so a
 * dropped key there is a mistake worth naming, while a server payload carrying a
 * reserved key is routine and stays silent.
 */
function assignSkipping(target, src, skipSet, allow, applied) {
	for (const key of Object.keys(src)) {
		if (skipSet.has(key)) {
			if (applied && (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__)) {
				warnCollision(target, key, COLLIDES_RESERVED);
			}
			continue;
		}
		if (allow && !allow(key)) continue;
		// Computed properties are plain prototype getters (SPEC §7), and model
		// methods are plain prototype functions. ESM is strict mode, so assigning a
		// payload key that resolves to a getter-only property throws in the MIDDLE
		// of this loop: earlier fields land, later fields do not, and a save
		// response never reaches its post-merge _synced flip. A key resolving to a
		// METHOD does not throw — it does something quieter and worse, writing an
		// own data property that SHADOWS the method, so the next
		// `record.update(...)` / `save()` / `toJSON()` fails as "not a function"
		// deep inside app code. Both take D49's reserved-relationship posture: drop
		// the colliding value and warn once.
		const collision = resolveCollision(target, key);
		if (collision) {
			if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) {
				warnCollision(target, key, collision);
			}
			continue;
		}
		target[key] = src[key];
		if (applied) applied.push(key);
	}
	return target;
}

/** Stamp one local-assignment revision across the fields accepted from a patch. */
function recordMutation(target, fields) {
	if (fields.length === 0) return;
	let state = MUTATION_REVISIONS.get(target);
	if (!state) {
		state = { current: 0, fields: new Map() };
		MUTATION_REVISIONS.set(target, state);
	}
	const revision = ++state.current;
	for (const field of fields) state.fields.set(field, revision);
}

/**
 * Copy `src`'s own enumerable keys onto `target` WITHOUT triggering prototype
 * setters — the safe replacement for `Object.assign(this, data)` on JSON-derived
 * data. JSON.parse produces a literal "__proto__" as a real OWN property, and
 * both Object.assign and a plain `target[k] = v` assignment invoke [[Set]], which
 * for "__proto__" hits Object.prototype's accessor SETTER: it re-prototypes the
 * record and severs every PuzzleModel method (update/save/validate/toJSON). The
 * upstream store shape guards only reject null/array/non-object, so a payload
 * like `{"id":1,"__proto__":{}}` reaches here. Skipping the POLLUTION_SKIP family
 * (`__proto__`/`constructor`/`prototype`) neutralizes both re-prototyping AND the
 * class-shadowing an own `constructor`/`prototype` key would cause (matching
 * safeMerge — a payload that reaches a fresh `new Model(data)` is just as hostile
 * as one that reaches an update merge). A key resolving to a getter-only computed
 * property is also dropped: strict-mode assignment would throw and leave the
 * ordered copy half-applied. Every remaining key keeps exact assignment semantics,
 * including accessors WITH setters, and Object.keys preserves enumeration order
 * (identical to Object.assign for normal data). A legitimate data field literally
 * named `constructor` therefore cannot be set at construction — intended, and
 * symmetric with safeMerge.
 */
function safeAssign(target, src) {
	return assignSkipping(target, src, POLLUTION_SKIP);
}

/**
 * The update() assignment path: MERGE_SKIP semantics plus the local-mutation
 * stamp.
 *
 * It skips the SAME reserved set as safeMerge, not just the pollution family.
 * `_type` is installed with `Object.defineProperty` and is therefore read-only,
 * so `record.update({ title, _type, done })` used to throw TypeError in the
 * MIDDLE of the copy under strict mode — `title` applied, `done` lost,
 * `recordChanged()` never reached — while `update({ _store: null })` quietly
 * detached a record the store still indexes. Neither is worth a throw: a
 * reserved key in a patch is dropped and warned about once, exactly like a
 * getter/method collision.
 *
 * Only the keys that actually LANDED are stamped; stamping a skipped key would
 * make save reconciliation preserve a local value that was never written.
 *
 * Construction deliberately does NOT stamp. A stamp costs a key array, a
 * `{current, fields: Map}` state object and one Map entry per field, and every
 * record hydrated from the server pays it for data only save()-response
 * reconciliation ever reads. It is also redundant: an unstamped record makes
 * recordMutationRevision() return 0, and safeMerge's filter then tests
 * `(fields.get(key) ?? 0) <= 0` → `0 <= 0` → true for every field. That is the
 * right answer — a record with no local edits since dispatch should accept
 * everything the server returns, which is exactly what stamping every
 * constructor field at revision 1 and capturing requestRevision 1 also produced.
 *
 * The two schemes stay equivalent under later edits because the constructor
 * stamp shifted EVERY revision by the same constant: a field stamped by update k
 * compared `k+1 <= j+1` against a request dispatched after j updates, where it
 * now compares `k <= j`. Same predicate.
 */
function safeAssignTracked(target, src) {
	const applied = [];
	assignSkipping(target, src, MERGE_SKIP, null, applied);
	recordMutation(target, applied);
	return target;
}

/** Current local-mutation revision, captured when save() dispatches its body. */
export function recordMutationRevision(record) {
	return MUTATION_REVISIONS.get(record)?.current ?? 0;
}

/**
 * Merge `src`'s own enumerable keys onto a live store RECORD without triggering a
 * prototype setter OR clobbering a framework internal — the safe replacement for
 * `Object.assign(record, serverJSON)` at the store's upsert / save-reconciliation /
 * hydration merge sites. It skips the same POLLUTION_SKIP family as safeAssign
 * (`__proto__`/`constructor`/`prototype` — JSON.parse produces a literal own
 * `__proto__`, whose [[Set]] would hit Object.prototype's accessor setter and
 * re-prototype the record, severing every PuzzleModel method; `constructor`/`prototype`
 * would shadow the class), and ADDITIONALLY skips the reserved
 * `_store`/`_type`/`_synced`/`_deleted` fields so a hostile or accidental payload
 * can't detach a record from its store, retype it, forge its sync provenance, or
 * impersonate a locally removed instance. Getter-only computed-property collisions
 * are dropped too, before their strict-mode throw can strand a half-merged record;
 * accessors with setters (including D49 relationships) retain their setter behavior.
 * Callers that legitimately set `_synced` do so explicitly right after this merge.
 * Every remaining key keeps exact `record[key] = src[key]` assignment semantics;
 * Object.keys preserves enumeration order (identical to Object.assign for ordinary
 * data).
 *
 * When `throughRevision` is provided by save reconciliation, a field changed by
 * update() after that request's dispatch revision is skipped. Other merge sites
 * omit it and remain server-authoritative exactly as before.
 */
export function safeMerge(record, src, throughRevision) {
	if (throughRevision === undefined) return assignSkipping(record, src, MERGE_SKIP);
	const state = MUTATION_REVISIONS.get(record);
	return assignSkipping(
		record,
		src,
		MERGE_SKIP,
		(key) => (state?.fields.get(key) ?? 0) <= throughRevision
	);
}

/**
 * Does `key` resolve to a plain method on this model's prototype chain?
 * Stops before Object.prototype, mirroring resolveCollision's walk.
 */
// Walks to Object.prototype for the same reason resolveCollision does: a schema
// field named `toString`/`valueOf` is unusable by construction, so the two walks
// must agree on what "is a method" means. If this one stopped short, such a field
// would register cleanly and then never hold data — the exact trap this check
// exists to close.
function resolvesToMethod(proto, key) {
	let owner = proto;
	while (owner) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) return !('get' in descriptor) && typeof descriptor.value === 'function';
		owner = Object.getPrototypeOf(owner);
	}
	return false;
}

/**
 * Reject a schema entry whose NAME the record shape has already spoken for —
 * checked once, when the Store registers the model, so the mistake surfaces at
 * app construction instead of as a `TypeError: record.update is not a function`
 * from inside app code the first time a payload carries the key.
 *
 * Two families, one failure: a field the merge paths refuse to write can never
 * hold data, so `required` on it fails forever and save() rejects with no
 * request ever sent — a silence with nothing pointing at the name.
 *
 * - **Methods.** A field named after a method would shadow it, so every write
 *   path drops the incoming value. Both plain fields and relationships are
 *   checked — a relationship additionally installs a prototype getter, which
 *   would replace the method for every record of the class. Covers PuzzleModel's
 *   own verbs (update/destroy/validate/toJSON, plus save/delete once the adapter
 *   capability is installed — PuzzleApp installs it before constructing the
 *   Store), any method the author's subclass declares, and Object.prototype's
 *   (see resolveCollision on why `toString`/`valueOf` are load-bearing).
 * - **Reserved record fields** (MERGE_SKIP): the framework internals
 *   `_store`/`_type`/`_synced`/`_deleted` and the pollution family
 *   `__proto__`/`constructor`/`prototype`. These are not method collisions —
 *   nothing shadows anything — so the method walk above never saw them, and a
 *   schema could declare one and register cleanly. `_type` is Sanity's field
 *   convention and `_deleted` is CouchDB/PouchDB's, so this is a name a real
 *   payload arrives with, not a hypothetical.
 */
export function assertSchemaNames(Model, type) {
	if (typeof Model !== 'function' || !Model.prototype) return;
	const schema = Model.schema;
	if (!schema || typeof schema !== 'object') return;
	const proto = Model.prototype;
	for (const name of Object.keys(schema)) {
		// Reserved first: `constructor` is in both families, and "reserved" is the
		// more useful thing to tell someone who declared it.
		if (MERGE_SKIP.has(name)) {
			throw new Error(
				`[puzzle] model "${type}" declares schema entry "${name}", which is a reserved record field — every merge path (update, upsert, save response, storage hydration) drops it, so the field can never hold data: a required rule on it fails forever and save() rejects without dispatching. Rename the field.`
			);
		}
		if (!resolvesToMethod(proto, name)) continue;
		throw new Error(
			`[puzzle] model "${type}" declares schema entry "${name}", which is a method on ${Model.name || 'the model class'} — a field cannot shadow a model method (payloads carrying it are dropped). Rename the field or the method.`
		);
	}
}

// Per-model list of `date()` field names, computed once. normalizedSchema()
// rebuilds an object on every call, and hydration runs per record in a loop.
const DATE_FIELDS = new WeakMap();

function dateFieldsFor(Model) {
	let fields = DATE_FIELDS.get(Model);
	if (!fields) {
		fields = [];
		for (const [name, def] of Object.entries(Model.normalizedSchema())) {
			if (def && def.type === 'date') fields.push(name);
		}
		DATE_FIELDS.set(Model, fields);
	}
	return fields;
}

/**
 * Revive schema-declared `date()` fields on a JSON-sourced payload — the
 * hydration boundary for every read path (upsert / loadMany / loadOne / save
 * response / storage restore).
 *
 * JSON has no Date type, so a `Puzzle.date()` field arrives as an ISO string (or
 * epoch millis). §20 validation deliberately does NOT coerce, so an uncoerced
 * string fails `min`/`max` on that field — and save() validates the FULL record
 * before dispatching, so one server-supplied date string makes every later
 * save() reject with no request ever sent. Converting where JSON enters keeps
 * the validation rules strict and gives app code the Date it declared.
 *
 * A bare `YYYY-MM-DD` is a calendar date and becomes LOCAL midnight (D114, the
 * same rule the date formatters use); anything unparseable is left exactly as it
 * arrived so validation still reports it.
 *
 * Serialization is a round trip, not a one-way convert. An instant needs
 * nothing — Date's own toJSON emits the ISO string again — but a calendar date
 * revived to a plain local-midnight Date would go back out as `toISOString()`,
 * a UTC instant naming the PREVIOUS day for everyone east of UTC: a
 * `2026-08-23` loaded in Berlin saved as `2026-08-22T22:00:00.000Z`. So a
 * date-only value revives to a CalendarDate (dates.js), whose toJSON writes the
 * calendar date back byte-identically in every zone.
 *
 * Non-destructive — the payload is copied only if something actually changes.
 */
export function coerceJSONDates(Model, data) {
	if (!data || typeof data !== 'object' || typeof Model?.normalizedSchema !== 'function') {
		return data;
	}
	const fields = dateFieldsFor(Model);
	if (fields.length === 0) return data;
	let out = data;
	for (const field of fields) {
		if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
		const value = data[field];
		if (typeof value !== 'string' && typeof value !== 'number') continue;
		const parsed = parseDateInput(value);
		if (Number.isNaN(parsed.getTime())) continue; // unparseable → leave it for §20
		if (out === data) out = { ...data };
		out[field] = parsed;
	}
	return out;
}

export class PuzzleModel {
	/**
	 * @param {object} data initial field values (defaults are the store's job
	 *   via applyDefaults; passing pre-defaulted data here is also fine)
	 */
	constructor(data = {}) {
		// safeAssign (not Object.assign) so an own "__proto__" key in JSON-derived
		// data can't re-prototype the record and strip its methods.
		safeAssign(this, data);

		// Store back-reference for update()/destroy() notification.
		// Non-enumerable: never serialized, never rendered.
		Object.defineProperty(this, '_store', {
			value: null,
			writable: true,
			enumerable: false,
		});

		// Synced-provenance flag (constellation/doc/DOC-SPEC.md §22, D50): true once
		// the record has been round-tripped with the server (loaded, upserted,
		// hydrated from storage, or saved successfully). Drives save()'s POST-vs-PUT
		// choice. createRecord() leaves it false. Non-enumerable, so it never reaches
		// toJSON()/persistence — it is provenance only, not a persisted field.
		Object.defineProperty(this, '_synced', {
			value: false,
			writable: true,
			enumerable: false,
		});

		// Removed-instance flag (D50 lifecycle amendment): removeRecord sets it for
		// both confirmed delete() and local destroy(), allowing a stale reference's
		// later delete() to resolve idempotently while a never-added instance still
		// rejects. Non-enumerable: record data and persistence never see it.
		Object.defineProperty(this, '_deleted', {
			value: false,
			writable: true,
			enumerable: false,
		});
	}

	/**
	 * Normalized descriptor map for this model's schema:
	 * FieldBuilder values collapse to their .def, plain descriptors pass through.
	 */
	static normalizedSchema() {
		const schema = this.schema || {};
		const out = {};
		for (const [field, value] of Object.entries(schema)) {
			// Relationships are schema entries but NOT fields (constellation/doc/DOC-SPEC.md §21,
			// D49): exclude them so applyDefaults, primaryKey, and the §20
			// validation engine (_collectErrors iterates this map) never see them.
			if (value instanceof RelationshipBuilder) continue;
			out[field] = value instanceof FieldBuilder ? value.def : value;
		}
		return out;
	}

	/**
	 * Relationship descriptors declared on this model's schema:
	 * name → `{ kind, type, key? }`. The Store reads this at construction to
	 * install lazy getters (constellation/doc/DOC-SPEC.md §21, D49). Empty when
	 * the model declares none.
	 */
	static relationshipDefs() {
		const schema = this.schema || {};
		const out = {};
		for (const [name, value] of Object.entries(schema)) {
			if (value instanceof RelationshipBuilder) out[name] = value.def;
		}
		return out;
	}

	/** The field marked `.primary()`, defaulting to 'id'. */
	static primaryKey() {
		for (const [field, def] of Object.entries(this.normalizedSchema())) {
			if (def.primary) return field;
		}
		return 'id';
	}

	/**
	 * Apply schema `.default()`s to a data object (non-destructive).
	 * Function defaults are invoked per record; a non-function object/array
	 * default is deep-cloned per record (see resolveDefault).
	 */
	static applyDefaults(data = {}) {
		const out = { ...data };
		for (const [field, def] of Object.entries(this.normalizedSchema())) {
			if (out[field] === undefined && 'default' in def) {
				out[field] = resolveDefault(def.default);
			}
		}
		return out;
	}

	/**
	 * Collect validation errors for a subset of schema-declared fields, in
	 * schema-declaration order (constellation/doc/DOC-SPEC.md §20). `fields`
	 * limits which fields are checked (the update-patch path passes the patched
	 * keys); omit it to validate every declared field. Non-throwing.
	 * @returns {Array<{field:string, rule:string, message:string}>}
	 */
	static _collectErrors(data = {}, fields = null) {
		const schema = this.normalizedSchema();
		const errors = [];
		for (const [field, def] of Object.entries(schema)) {
			if (fields && !fields.includes(field)) continue;
			errors.push(...fieldErrors(field, def, data[field]));
		}
		return errors;
	}

	/**
	 * Validate a data object without throwing — the pre-create form-check surface
	 * (constellation/doc/DOC-SPEC.md §20, D48). `options.fields` exposes the same
	 * partial-field machinery used by update(); omitted means every declared field.
	 * @returns {{ valid: boolean, errors: Array<{field, rule, message}> }}
	 */
	static validate(data = {}, { fields } = {}) {
		const errors = this._collectErrors(this.applyDefaults(data), fields);
		return { valid: errors.length === 0, errors };
	}

	/**
	 * Validate this record's CURRENT field values, without throwing — the
	 * renderable surface for form UX (constellation/doc/DOC-SPEC.md §20, D48).
	 * @returns {{ valid: boolean, errors: Array<{field, rule, message}> }}
	 */
	validate() {
		return this.constructor.validate(this);
	}

	/**
	 * Merge a patch into the record and notify the owning store (which batches
	 * and re-runs subscribed components' data()). Returns the record so model
	 * methods can chain: `toggle() { return this.update({...}) }`.
	 */
	update(patch = {}) {
		// Primary keys are immutable once a record is attached to a store: the
		// store indexes records by pk, so reassigning it would corrupt the index
		// (findOne would key the record under its old id). Setting the pk to its
		// current value is a no-op and allowed. Store-less records are unaffected.
		if (this._store) {
			const pk = this._store.modelFor(this._type).primaryKey();
			if (
				Object.prototype.hasOwnProperty.call(patch, pk) &&
				recordKey(patch[pk]) !== recordKey(this[pk])
			) {
				throw new Error(
					`Cannot change primary key "${pk}": primary keys are immutable after creation.`
				);
			}
		}

		// Validate ONLY the schema-declared fields present in the patch (own
		// keys) — rules are per-field, so this is exact and a record created
		// under laxer rules can't be bricked by an unrelated update. Throw
		// BEFORE Object.assign so a failed update leaves the record untouched.
		// Applies to store-less records too — the rules live on the class
		// (constellation/doc/DOC-SPEC.md §20, D48).
		const patched = Object.keys(patch);
		const errors = this.constructor._collectErrors(patch, patched);
		if (errors.length) throw new PuzzleValidationError(errors);

		// Tracked: this is a LOCAL edit, and its revision is what stops an
		// in-flight save() response from clobbering it (D125).
		safeAssignTracked(this, patch);
		this._store?.recordChanged(this);
		return this;
	}

	/** Remove the record from its store. */
	destroy() {
		this._store?.removeRecord(this);
		return this;
	}

	toJSON() {
		return { ...this };
	}
}
