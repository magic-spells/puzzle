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
	if (def.required && missing) {
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
// internals (`_store`/`_type`/`_synced`).
const MERGE_SKIP = new Set([...POLLUTION_SKIP, '_store', '_type', '_synced']);

/** Shared body of safeAssign/safeMerge: assign every own key not in `skipSet`. */
function assignSkipping(target, src, skipSet) {
	for (const key of Object.keys(src)) {
		if (skipSet.has(key)) continue;
		target[key] = src[key];
	}
	return target;
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
 * as one that reaches an update merge). All other keys keep exact assignment
 * semantics and Object.keys preserves enumeration order (identical to
 * Object.assign for normal data). A legitimate data field literally named
 * `constructor` therefore cannot be set at construction — intended, and symmetric
 * with safeMerge.
 */
function safeAssign(target, src) {
	return assignSkipping(target, src, POLLUTION_SKIP);
}

/**
 * Merge `src`'s own enumerable keys onto a live store RECORD without triggering a
 * prototype setter OR clobbering a framework internal — the safe replacement for
 * `Object.assign(record, serverJSON)` at the store's upsert / save-reconciliation /
 * hydration merge sites. It skips the same POLLUTION_SKIP family as safeAssign
 * (`__proto__`/`constructor`/`prototype` — JSON.parse produces a literal own
 * `__proto__`, whose [[Set]] would hit Object.prototype's accessor setter and
 * re-prototype the record, severing every PuzzleModel method; `constructor`/`prototype`
 * would shadow the class), and ADDITIONALLY skips the reserved `_store`/`_type`/`_synced`
 * fields so a hostile or accidental payload can't detach a record from its store,
 * retype it, or forge its sync provenance. Callers that
 * legitimately set `_synced` do so explicitly right after this merge. All other keys
 * keep exact `record[key] = src[key]` assignment semantics; Object.keys preserves
 * enumeration order (identical to Object.assign for ordinary data).
 */
export function safeMerge(record, src) {
	return assignSkipping(record, src, MERGE_SKIP);
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
	 * Validate a data object against ALL schema-declared fields, without
	 * throwing — the pre-create form-check surface (constellation/doc/DOC-SPEC.md §20, D48).
	 * @returns {{ valid: boolean, errors: Array<{field, rule, message}> }}
	 */
	static validate(data = {}) {
		const errors = this._collectErrors(data);
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
				patch[pk] !== this[pk]
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

		safeAssign(this, patch);
		this._store?.recordChanged(this);
		return this;
	}

	/** Remove the record from its store. */
	destroy() {
		this._store?.removeRecord(this);
		return this;
	}

	/**
	 * Sync this record to the server (constellation/doc/DOC-SPEC.md §22, D50). The
	 * Store owns the network; the verb just delegates. Local-first: the mutation is
	 * already on screen, so a failed save() rejects and keeps the dirty local state
	 * (retry by calling again). A store-less record has nowhere to sync — reject
	 * asynchronously (never a sync throw) so callers only ever `await`.
	 * @returns {Promise<PuzzleModel>}
	 */
	save() {
		if (!this._store) {
			return Promise.reject(
				new Error('[puzzle] cannot save() a store-less record — create it via store.createRecord() first')
			);
		}
		return this._store.saveRecord(this);
	}

	/**
	 * Confirmed server delete (constellation/doc/DOC-SPEC.md §22, D50): DELETE first,
	 * local remove on ack. Distinct from destroy() (local-only, unchanged). Reject
	 * asynchronously for a store-less record.
	 * @returns {Promise<PuzzleModel>}
	 */
	delete() {
		if (!this._store) {
			return Promise.reject(
				new Error('[puzzle] cannot delete() a store-less record — create it via store.createRecord() first')
			);
		}
		return this._store.deleteRecord(this);
	}

	toJSON() {
		return { ...this };
	}
}

export default PuzzleModel;
