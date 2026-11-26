/**
 * Declarations for the `@magic-spells/puzzle/forms` subpath (D192).
 *
 * ```ts
 * import { createForm } from '@magic-spells/puzzle/forms';
 *
 * created() {
 *   this.form = createForm(this, Post, { from: this.props.post, fields: ['title'] });
 * }
 * ```
 *
 * Mirrors client-runtime/forms.js exactly.
 */

import type { PuzzleModel, PuzzleView } from './index.js';

/** Maps an error a submit callback threw to `{ field: message }`, or null when none apply. */
export type ServerErrorMapper = (error: unknown) => Record<string, string> | null | undefined;

/** Options for `createForm()`. */
export interface FormOptions<V extends Record<string, any> = Record<string, any>> {
	/** Record or plain object that seeds the draft. Omitted: the schema's defaults. */
	from?: Partial<V> | object | null;
	/** Field names the form edits and validates. Omitted: every schema field. */
	fields?: Array<keyof V & string>;
	/** View state key the controller is written to. Default `'form'`. */
	key?: string;
	/** Replaces the built-in mapping of a submit error onto fields. */
	serverErrors?: ServerErrorMapper;
}

/**
 * The form controller `createForm()` returns and writes to the view's state.
 * Read it in the template (`form.values.title`, `form.errors.title`); call its
 * methods from a view handler.
 */
export interface PuzzleForm<V extends Record<string, any> = Record<string, any>> {
	/** The draft, one accessor per field. Bind it directly: `value={ form.values.title }`. */
	readonly values: V;
	/** The error the user should see, per field: shown once touched or after a submit attempt, or a server message. */
	readonly errors: { readonly [K in keyof V]: string | null };
	/** `true` per field the user has left (or every field after a submit attempt). */
	readonly touched: { readonly [K in keyof V]: boolean };
	/** `true` per field whose value differs from the baseline. */
	readonly changed: { readonly [K in keyof V]: boolean };
	/** Whether any field changed. */
	readonly dirty: boolean;
	/** Whether every field passes the model's rules, touched or not. */
	readonly valid: boolean;
	/** Whether a submit callback is in flight. */
	readonly submitting: boolean;
	/** A form-level message from a submit error no field owns, else null. */
	readonly error: string | null;
	/** The record or object the draft was seeded from. */
	readonly source: object | null;
	/** Write one field. An unknown name is ignored. */
	set<K extends keyof V & string>(name: K, value: V[K]): void;
	/** Mark a field touched, by name or from a focus event whose target carries the field's `name`. */
	touch(nameOrEvent: (keyof V & string) | Event): void;
	/**
	 * Validate, then await `fn` with a plain copy of the values. Resolves `true`
	 * on success, `false` when invalid, already submitting, or `fn` threw.
	 */
	submit(event: Event | null | undefined, fn: (values: V) => unknown): Promise<boolean>;
	submit(fn: (values: V) => unknown): Promise<boolean>;
	/** Back to the baseline, or reseed from a new source. Clears touched and errors. */
	reset(from?: Partial<V> | object | null): void;
}

/**
 * Build a form controller for `view`, validated by `Model`'s schema, and write
 * it to the view's state under `options.key` (default `'form'`).
 */
export function createForm<V extends Record<string, any> = Record<string, any>>(
	view: PuzzleView,
	Model: typeof PuzzleModel,
	options?: FormOptions<V>
): PuzzleForm<V>;
