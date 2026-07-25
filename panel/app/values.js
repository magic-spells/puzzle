/**
 * values.js — turning inspected payloads into things a template can render.
 *
 * Everything the panel shows arrives as already-JSON-safe data (the runtime
 * bridge filters records, DOM nodes and functions out before serializing), so
 * this module is about DISPLAY, not safety: one-line previews, a primitive-kind
 * tag that decides whether a field is editable, and the key/value rows the
 * inspector and the record detail card both render.
 *
 * Template expressions are lexed rather than parsed (SPEC §6), so views cannot
 * build these shapes inline — every derived string is computed here or in
 * `data()` and handed to the template ready to print.
 */

/** Longest preview a table cell or inspector row will print before eliding. */
export const PREVIEW_MAX = 160;

/**
 * The primitive kinds the record editor can round-trip through an `<input>`.
 * Anything else (arrays, objects, null, undefined) is display-only — patching
 * it would mean parsing user-typed JSON, which is a v2 problem.
 */
export function valueKind(value) {
	const type = typeof value;
	if (type === 'string' || type === 'number' || type === 'boolean') return type;
	return 'other';
}

/**
 * One-line rendering of any JSON-safe value.
 *
 * Strings print quoted so an empty string and a missing field cannot be
 * confused — the difference matters when you are staring at a validation error.
 */
export function preview(value, max = PREVIEW_MAX) {
	let text;
	if (value === undefined) text = 'undefined';
	else if (value === null) text = 'null';
	else if (typeof value === 'string') text = JSON.stringify(value);
	else {
		try {
			text = JSON.stringify(value);
		} catch (err) {
			text = String(value);
		}
		if (text === undefined) text = String(value);
	}
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The text an `<input>` starts with for a primitive field. */
export function inputValue(value) {
	if (value === null || value === undefined) return '';
	return String(value);
}

/**
 * Read an edited field back into the type the record had, so a patch never
 * silently changes a number into a string.
 *
 * Returns `{ ok, value }` rather than throwing: a malformed number is a user
 * mistake the editor reports inline, not an exception.
 */
export function coerceInput(raw, kind) {
	if (kind === 'number') {
		const trimmed = String(raw).trim();
		if (trimmed === '') return { ok: false, value: null, error: 'expected a number' };
		const parsed = Number(trimmed);
		if (!Number.isFinite(parsed)) return { ok: false, value: null, error: 'expected a number' };
		return { ok: true, value: parsed };
	}
	if (kind === 'boolean') return { ok: true, value: raw === true || raw === 'true' };
	return { ok: true, value: String(raw) };
}

/**
 * `{ key: value }` → the row shape the inspector groups and the record detail
 * card both render. Insertion order is preserved (it is the order the runtime
 * serialized the layer in, which reads better than alphabetical).
 *
 * `value` is the elided one-liner the cell prints; `full` is the same value
 * uncapped, for the row's `title`. In a half-width card at a short dock height
 * the printed form is almost always clipped, so hover has to be able to show
 * the whole thing.
 */
export function entriesOf(object, max = PREVIEW_MAX) {
	if (!object || typeof object !== 'object') return [];
	return Object.keys(object).map((label) => {
		const value = object[label];
		return {
			label,
			value: preview(value, max),
			full: preview(value, Infinity),
			kind: valueKind(value),
			raw: value,
		};
	});
}

/**
 * Column order for a record table: the primary key first, then every other key
 * any row carries, in first-seen order, capped so a wide model cannot push the
 * table off the panel. `_synced` is excluded — it renders as a badge, not a
 * column.
 *
 * @param {object[]} rows
 * @param {number} limit  maximum non-pk columns
 */
export function deriveColumns(rows, limit = 7) {
	const columns = [];
	const seen = new Set(['_synced']);
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		for (const key of Object.keys(row)) {
			if (seen.has(key)) continue;
			seen.add(key);
			columns.push(key);
		}
	}
	// The pk is whatever the bridge serialized first on the first row; every
	// Puzzle model has one and toJSON emits it, so `id` is a fallback, not a
	// guess about the app's schema.
	const pk = columns.includes('id') ? 'id' : columns[0];
	const rest = columns.filter((key) => key !== pk);
	const kept = rest.slice(0, Math.max(0, limit));
	return {
		pk: pk ?? 'id',
		columns: pk ? [pk, ...kept] : kept,
		hidden: rest.length - kept.length,
	};
}
