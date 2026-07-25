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
 *
 * `copy` is what the clipboard gets, and it deliberately differs from `full`:
 * a string copies as its CONTENTS, not as a quoted JS literal (matching what
 * Chrome's own "Copy value" does), while everything else copies as JSON.
 */
export function entriesOf(object, max = PREVIEW_MAX) {
	if (!object || typeof object !== 'object') return [];
	return Object.keys(object).map((label) => {
		const value = object[label];
		return {
			label,
			value: preview(value, max),
			full: preview(value, Infinity),
			copy: clipboardText(value),
			kind: valueKind(value),
			raw: value,
		};
	});
}

/** The clipboard form of a value: strings bare, everything else JSON. */
export function clipboardText(value) {
	if (typeof value === 'string') return value;
	return preview(value, Infinity);
}

/**
 * The role a view plays, read off its `__pzlModule` stamp's DIRECTORY segments —
 * `layouts/Shell.pzl` is a layout, `components/ui/Badge.pzl` a component. Only
 * directories are considered, so a view stamped `views/components.pzl` is not
 * mistaken for one. Anything unrecognized — including a hand-written class with
 * no module at all — is a plain view, which is the safe default.
 */
export function viewKind(module) {
	if (typeof module !== 'string' || module === '') return 'view';
	const directories = module.split('/').slice(0, -1);
	if (directories.includes('layouts')) return 'layout';
	if (directories.includes('components')) return 'component';
	return 'view';
}

/**
 * The dimmed path fragment shown after a view's name — the BASENAME only, and
 * only when it carries information.
 *
 * `MainLayout` living in `layouts/MainLayout.pzl` is pure redundancy: the row
 * would read "MainLayout MainLayout.pzl" and the repetition is what makes a
 * dense tree unreadable. That case returns '' and the row shows just the name.
 * Nothing is lost — the full path moves to the row's title (`moduleTitle`).
 */
export function moduleLabel(name, module) {
	if (typeof module !== 'string' || module === '') return '';
	const basename = module.split('/').pop();
	return basename === `${name}.pzl` ? '' : basename;
}

/** The row tooltip: the full module path, or the bare name when there is none. */
export function moduleTitle(name, module) {
	return typeof module === 'string' && module !== '' ? module : name;
}

/**
 * Split a store subscription key into its parts.
 *
 * The runtime builds record keys as `type + REC_SEP + id` where REC_SEP is a
 * SPACE (client-runtime/datastore/store.js: "never appears in a type name") —
 * so a live key looks like `todo t2`, NOT `todo:t2`. The bridge passes keys
 * through verbatim, and the panel renders them raw for the same reason: this is
 * the string the app itself subscribes with, and inventing a prettier
 * separator would make the panel disagree with `store.subscribe` output.
 *
 * Split ONCE, on the first space: the type can never contain one, but a primary
 * key can contain anything, spaces included.
 *
 * @returns {{ type: string, id: string|null, kind: 'collection'|'record' }}
 */
export function subscriptionParts(key) {
	const text = String(key);
	const at = text.indexOf(' ');
	if (at === -1) return { type: text, id: null, kind: 'collection' };
	return { type: text.slice(0, at), id: text.slice(at + 1), kind: 'record' };
}

/**
 * A store key's shape: `todo` is a collection query, `todo t2` a single record.
 * That distinction is the only grouping the subscription rail needs.
 */
export function subscriptionKind(key) {
	return subscriptionParts(key).kind;
}

/**
 * Field-level diff of one record snapshot against the previous one.
 *
 * Pure and order-stable: previous fields first (in their own order), then keys
 * only the next snapshot carries. `_synced` is ignored — it is provenance the
 * bridge synthesizes per snapshot, not a field the app changed, so letting it
 * through would put a spurious row in the changelog on every save.
 *
 * A field that appears reports `from: undefined`; one that disappears reports
 * `to: undefined`. Comparison is `Object.is`, so `NaN` does not report as a
 * change; object-valued fields fall back to JSON equality, because snapshots
 * are re-serialized on every flush and would otherwise differ by identity every
 * single time.
 *
 * @returns {{ field: string, from: any, to: any }[]} empty when nothing changed.
 */
export function diffRecord(previous, next) {
	const before = previous && typeof previous === 'object' ? previous : {};
	const after = next && typeof next === 'object' ? next : {};

	const fields = Object.keys(before);
	for (const key of Object.keys(after)) if (!fields.includes(key)) fields.push(key);

	const changes = [];
	for (const field of fields) {
		if (field === '_synced') continue;
		const from = before[field];
		const to = after[field];
		if (sameValue(from, to)) continue;
		changes.push({ field, from, to });
	}
	return changes;
}

/** Object.is for primitives; JSON equality for structures re-serialized per snapshot. */
function sameValue(a, b) {
	if (Object.is(a, b)) return true;
	const structural = a !== null && typeof a === 'object' && b !== null && typeof b === 'object';
	if (!structural) return false;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch (err) {
		return false;
	}
}

/**
 * Prepend `changes` to a capped, newest-first changelog.
 *
 * Returns the SAME array reference when there is nothing to add, so the common
 * no-change flush cannot churn a re-render.
 */
export function appendHistory(history, changes, at, limit = 30) {
	const list = Array.isArray(history) ? history : [];
	if (!changes || changes.length === 0) return list;
	const entries = changes.map((change) => ({ ...change, at }));
	return [...entries, ...list].slice(0, limit);
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
