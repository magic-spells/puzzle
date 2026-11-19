/**
 * Opt-in forms (D192) — `@magic-spells/puzzle/forms`.
 *
 * one function, `createForm(view, Model, options)`, builds a controller that holds a
 * form's draft and its bookkeeping: which fields the user has left (touched),
 * which differ from the saved values (changed), the model's errors per field,
 * a submitting flag, server errors mapped back onto fields, and reset. an app
 * that never imports this module never ships it.
 *
 * ```js
 * import { createForm } from '@magic-spells/puzzle/forms';
 *
 * created() {
 *   this.form = createForm(this, Post, { from: this.props.post, fields: ['title'] });
 * }
 * ```
 *
 * the controller writes itself to the view's state under `key` (default
 * 'form'), so a template reads `form.values.title`, `form.errors.title`,
 * `form.submitting` with nothing else to wire. every change writes that key
 * again, which schedules one re-render through setState().
 *
 * `values` is a stable object with one accessor per field, so a two-way bind
 * (`value={ form.values.title }`, D147) writes through the setter and the form
 * sees every edit. the controller carries the D170 render revision and bumps it
 * on every change, so a child handed `form={ form }` (the Field piece)
 * re-renders through propsEqual's revision check.
 *
 * the controller is a class instance on purpose: the dev HMR snapshot (D57)
 * keeps only plain objects, so it drops the controller instead of restoring a
 * method-less copy over the one created() rebuilds.
 */

import { reportError } from './errors.js';
import { PuzzleValidationError } from './model.js';
import { RENDER_REV } from './renderRev.js';

/**
 * @typedef {import('./views/PuzzleView.js').PuzzleView} PuzzleView
 * @typedef {typeof import('./model.js').PuzzleModel} ModelClass
 * @typedef {Record<string, string | null>} FieldMessages
 * @typedef {(error: unknown) => Record<string, string> | null | undefined} ServerErrorMapper
 * @typedef {{ from?: object | null, fields?: string[], key?: string, serverErrors?: ServerErrorMapper }} FormOptions
 */

/**
 * whether two field values count as the same for `changed`. nullish and the
 * empty string are one "empty" value (a cleared input writes '' over a field
 * the record never set), and dates compare by time.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function same(a, b) {
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	return Object.is(a ?? '', b ?? '');
}

/**
 * the built-in server-error mapping. reads a model's own validation error, or
 * an adapter error whose json body carries `errors` as `{ field: message }`,
 * `{ field: [message, …] }` or `[{ field, message }]`. returns null when the
 * error has no field-shaped errors at all (an unexpected failure).
 * @param {any} error
 * @returns {Record<string, string> | null}
 */
function mapServerErrors(error) {
	const list = error instanceof PuzzleValidationError ? error.errors : error?.body?.errors;
	if (!list || typeof list !== 'object') return null;
	/** @type {Record<string, string>} */
	const out = {};
	if (Array.isArray(list)) {
		// the array form: keep the first message per field
		for (const item of list) {
			if (item?.field != null && !(item.field in out)) out[item.field] = String(item.message ?? '');
		}
	} else {
		// the object form: a field maps to a message or a list of messages
		for (const field of Object.keys(list)) {
			const message = Array.isArray(list[field]) ? list[field][0] : list[field];
			if (message != null) out[field] = String(message);
		}
	}
	return Object.keys(out).length ? out : null;
}

/**
 * the form controller. built by createForm(), never constructed directly.
 * @template {Record<string, any>} [V=Record<string, any>] the draft's shape
 */
class PuzzleForm {
	// ---- private state --------------------------------------------------

	/** @type {PuzzleView} the view whose state holds this controller */
	#view;
	/** @type {ModelClass} the model whose schema validates the draft */
	#model;
	/** @type {string} the view state key the controller is written to */
	#key;
	/** @type {string[]} the fields this form edits */
	#fields;
	/** @type {Record<string, any>} the draft behind the `values` accessors */
	#current = {};
	/** @type {Record<string, any>} what `changed` compares against */
	#baseline = {};
	/** @type {Record<string, string>} server messages, cleared per field on edit */
	#server = {};
	/** @type {boolean} a submit was attempted, so every error shows */
	#attempted = false;
	/** @type {ServerErrorMapper} */
	#mapErrors;

	// ---- public, read by templates ---------------------------------------

	/** @type {V} the draft, one accessor per field */
	values = /** @type {V} */ ({});
	/** @type {{ [K in keyof V]: string | null }} the error the user should see, per field */
	errors = /** @type {any} */ ({});
	/** @type {{ [K in keyof V]: boolean }} fields the user has left, or every field after a submit attempt */
	touched = /** @type {any} */ ({});
	/** @type {{ [K in keyof V]: boolean }} fields whose value differs from the baseline */
	changed = /** @type {any} */ ({});
	/** whether any field changed */
	dirty = false;
	/** whether every field passes the model's rules (regardless of touched) */
	valid = true;
	/** whether a submit's callback is in flight */
	submitting = false;
	/** @type {string | null} a form-level message from an error no field owns */
	error = null;
	/** @type {object | null} the record or object the draft was seeded from */
	source = null;

	/**
	 * @param {PuzzleView} view
	 * @param {ModelClass} Model
	 * @param {FormOptions} options
	 */
	constructor(view, Model, options) {
		this.#view = view;
		this.#model = Model;
		this.#key = options.key ?? 'form';
		this.#fields = options.fields ?? Object.keys(Model.normalizedSchema());
		this.#mapErrors = options.serverErrors ?? mapServerErrors;

		// one accessor per field: a bind's plain-object write (`target[key] = v`)
		// lands in the setter, so the form sees every keystroke
		for (const field of this.#fields) {
			Object.defineProperty(this.values, field, {
				enumerable: true,
				get: () => this.#current[field],
				set: (value) => this.set(field, value),
			});
		}
		this.#seed(options.from ?? null);
	}

	/**
	 * write one field, as a bind or the Field piece does. clears that field's
	 * server error, since the user is answering it. an unknown name is ignored.
	 * @param {string} name
	 * @param {any} value
	 */
	set(name, value) {
		if (!this.#fields.includes(name)) return;
		this.#current[name] = value;
		delete this.#server[name];
		this.#commit();
	}

	/**
	 * mark a field touched so its error shows. takes a field name, or a focus
	 * event whose target's `name` is a field, so one `@focusout` on the <form>
	 * covers every control. touching an already-touched field does nothing.
	 * @param {string | Event} nameOrEvent
	 */
	touch(nameOrEvent) {
		const name =
			typeof nameOrEvent === 'string'
				? nameOrEvent
				: /** @type {any} */ (nameOrEvent)?.target?.name;
		if (!this.#fields.includes(name) || this.touched[name]) return;
		this.touched = { ...this.touched, [name]: true };
		this.#commit();
	}

	/**
	 * validate, then hand a plain copy of the draft to `fn` and wait for it.
	 * resolves true when `fn` succeeded; false when the draft is invalid, a
	 * submit is already in flight, or `fn` threw. an error `fn` throws is mapped
	 * onto fields; one that maps to nothing becomes `error` and reaches the
	 * app's onError with phase 'submit'. it is never rethrown, because event
	 * handlers are fire-and-forget and a rethrow would be an unhandled rejection.
	 * @param {Event | null | ((values: V) => any)} [event] the submit event (its default is prevented), or `fn` itself
	 * @param {(values: V) => any} [fn] the save, given a plain copy of the values
	 * @returns {Promise<boolean>}
	 */
	async submit(event, fn) {
		// allow submit(fn) without an event
		if (typeof event === 'function') {
			fn = event;
			event = null;
		}
		/** @type {Event | null | undefined} */ (event)?.preventDefault?.();
		if (this.submitting) return false;

		// a submit attempt shows every error and drops the last server answer
		this.#attempted = true;
		this.#server = {};
		this.error = null;
		this.#commit();
		if (!this.valid) {
			// put the cursor on the first invalid control the submitted form holds
			const first = this.#fields.find((field) => this.errors[field]);
			/** @type {any} */ (event)?.target?.elements?.namedItem?.(first)?.focus?.();
			return false;
		}

		this.submitting = true;
		this.#commit();
		try {
			await fn?.(/** @type {V} */ ({ ...this.#current }));
		} catch (err) {
			this.submitting = false;
			this.#fail(err);
			this.#commit();
			return false;
		}

		// success: what was submitted is the new baseline, so dirty goes false
		this.submitting = false;
		this.#baseline = { ...this.#current };
		this.#untouch();
		this.#commit();
		return true;
	}

	/**
	 * put the draft back to its baseline, or reseed it from a new source (a
	 * record that loaded after created(), or the next record to edit). clears
	 * touched, errors and the form-level error.
	 * @param {object | null} [from] a new source; omit to keep the current one
	 */
	reset(from) {
		if (from !== undefined) this.#seed(from);
		else {
			this.#current = { ...this.#baseline };
			this.#untouch();
			this.#commit();
		}
	}

	// ---- internals -----------------------------------------------------

	/**
	 * seed the draft and baseline from a source (or the schema defaults), then
	 * commit. undefined becomes null so a template never reads an undefined field.
	 * @param {any} from
	 */
	#seed(from) {
		/** @type {Record<string, any>} */
		const picked = {};
		for (const field of this.#fields) picked[field] = from?.[field];
		// applyDefaults fills every schema field; keep only the ones this form edits
		const defaulted = this.#model.applyDefaults(picked);
		/** @type {Record<string, any>} */
		const seeded = {};
		for (const field of this.#fields) seeded[field] = defaulted[field] ?? null;
		this.source = from;
		this.#baseline = seeded;
		this.#current = { ...seeded };
		this.#untouch();
		this.#commit();
	}

	/** forget touched, the submit attempt and every server answer. */
	#untouch() {
		this.#attempted = false;
		this.#server = {};
		this.error = null;
		this.touched = /** @type {any} */ (Object.fromEntries(this.#fields.map((field) => [field, false])));
	}

	/**
	 * map an error the submit callback threw. field messages go to `errors`;
	 * a message for a name the form doesn't edit becomes `error`; an error with
	 * no field-shaped messages at all is unexpected, so it also goes to onError.
	 * @param {any} err
	 */
	#fail(err) {
		const mapped = this.#mapErrors(err);
		if (!mapped) {
			this.error = String(err?.message ?? err);
			const view = /** @type {any} */ (this.#view);
			reportError(
				view.ctx,
				err,
				{ phase: 'submit', view, route: view.route },
				'[puzzle] form submit failed:',
				err
			);
			return;
		}
		for (const name of Object.keys(mapped)) {
			if (this.#fields.includes(name)) this.#server[name] = mapped[name];
			else this.error ??= mapped[name];
		}
	}

	/**
	 * recompute everything derived from the draft, bump the render revision,
	 * and write the controller back to the view so it re-renders. validation
	 * runs over every field each time; it is per-field rule checks, cheap
	 * enough for a keystroke.
	 */
	#commit() {
		const { errors } = this.#model.validate(this.#current, { fields: this.#fields });
		/** @type {Record<string, string>} first model message per field */
		const first = {};
		for (const issue of errors) first[issue.field] ??= issue.message;

		/** @type {FieldMessages} */
		const visible = {};
		/** @type {Record<string, boolean>} */
		const changed = {};
		let dirty = false;
		for (const field of this.#fields) {
			// a server message wins; a model message shows once the user left the
			// field or tried to submit ("late to show, quick to clear")
			const shown = this.touched[field] || this.#attempted;
			visible[field] = this.#server[field] ?? ((shown && first[field]) || null);
			changed[field] = !same(this.#current[field], this.#baseline[field]);
			dirty ||= changed[field];
		}
		// fresh objects each change, so anything comparing by identity sees it
		this.errors = /** @type {any} */ (visible);
		this.changed = /** @type {any} */ (changed);
		this.dirty = dirty;
		this.valid = errors.length === 0;

		// D170 render revision: a child holding `form={ form }` re-renders
		const self = /** @type {any} */ (this);
		self[RENDER_REV] = (self[RENDER_REV] ?? 0) + 1;
		this.#view.setState(this.#key, this);
	}
}

/**
 * build a form controller for `view`, validated by `Model`'s schema, and
 * write it to the view's state under `options.key` (default 'form').
 *
 * @template {Record<string, any>} [V=Record<string, any>] the draft's shape
 * @param {PuzzleView} view the view that owns the form (call from created())
 * @param {ModelClass} Model the model whose schema validates the draft
 * @param {FormOptions} [options]
 * @returns {PuzzleForm<V>}
 */
export function createForm(view, Model, options = {}) {
	if (typeof Model?.validate !== 'function') {
		throw new TypeError('[puzzle] createForm(view, Model): Model must be a PuzzleModel class');
	}
	return /** @type {PuzzleForm<V>} */ (new PuzzleForm(view, Model, options));
}
