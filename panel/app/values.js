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

/* -------------------------------------------------------------------------- */
/* Profiler projections — `snapshot:profile` → the Performance panel's rows.   */
/* -------------------------------------------------------------------------- */

/**
 * Everything below turns one profile report into ready-to-print rows. It lives
 * here rather than in Performance.pzl for the usual reason (template
 * expressions are lexed, not parsed — SPEC §6) and one extra one: the panel
 * re-renders this table on every poll tick, so the ORDERING rules have to be
 * deterministic, and rules you can unit-test are the only ones you can trust to
 * be.
 *
 * Every reader is defensive about missing fields. The runtime half of this
 * feature ships separately from the extension, so a report from an older or
 * newer framework build will be missing counters this code names — that must
 * render as a zero, never as `NaN` or a crash.
 */

/** Reads any wire value as a finite number. Missing counter ⇒ 0, never NaN. */
function toNumber(value) {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}

/** Integer with thousands separators, locale-independent so tests are stable. */
export function formatCount(value) {
	const n = Math.round(toNumber(value));
	const sign = n < 0 ? '-' : '';
	return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A millisecond timing, for a dense numeric column. One decimal under 100ms
 * (where per-view timings actually live) and whole milliseconds above it, so a
 * column of these stays the same visual width as the numbers grow.
 */
export function formatMs(value) {
	const n = toNumber(value);
	if (n <= 0) return '0';
	if (n < 100) return n.toFixed(1);
	return formatCount(n);
}

/** Elapsed recording time: seconds under a minute, `m:ss` past it. */
export function formatDuration(value) {
	const ms = toNumber(value);
	if (ms <= 0) return '0.0s';
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * A ratio as a percentage. A non-zero ratio never prints as "0%" — the
 * difference between "no waste" and "a little waste" is the whole point of the
 * column, so it degrades to "<1%" instead.
 */
export function formatPercent(ratio) {
	const n = toNumber(ratio);
	if (n <= 0) return '0%';
	const pct = n * 100;
	if (pct < 1) return '<1%';
	return `${Math.round(pct)}%`;
}

/**
 * The share of a view's renders that changed no DOM at all.
 *
 * A "wasted render" is a pass where the framework re-ran the view and re-diffed
 * its tree and nothing came out — pure burned CPU. Clamped to 0..1 so a runtime
 * that reports more wasted than total (a counter race across a poll boundary)
 * cannot produce a 140% bar.
 */
export function wastedRatio(renders, wasted) {
	const total = toNumber(renders);
	const idle = toNumber(wasted);
	if (total <= 0 || idle <= 0) return 0;
	return Math.min(1, idle / total);
}

/** At or above this share of wasted renders a view is called out, not just tinted. */
export const WASTE_HIGH_RATIO = 0.5;
/**
 * ...but only once there are enough renders for the ratio to mean anything. A
 * view that rendered twice and wasted one is 50% wasted and completely
 * uninteresting; this floor keeps the alarm for views actually burning CPU.
 */
export const WASTE_HIGH_MIN = 4;

/** 'none' | 'some' | 'high' — how loudly a view's waste should be drawn. */
export function wasteLevel(renders, wasted) {
	const idle = toNumber(wasted);
	if (idle <= 0) return 'none';
	if (idle >= WASTE_HIGH_MIN && wastedRatio(renders, wasted) >= WASTE_HIGH_RATIO) return 'high';
	return 'some';
}

/**
 * A view's heat bucket — 0 (never rendered) through 4 — as a share of the
 * busiest view in the SAME report.
 *
 * Relative rather than absolute: the interesting question is never "is 40 renders
 * a lot" (it depends entirely on what you did while recording) but "which views
 * are carrying the load compared to their neighbours".
 */
export function heatLevel(renders, peak) {
	const n = toNumber(renders);
	const max = toNumber(peak);
	if (n <= 0 || max <= 0) return 0;
	const share = n / max;
	if (share > 0.75) return 4;
	if (share > 0.5) return 3;
	if (share > 0.25) return 2;
	return 1;
}

/**
 * The heat bar's width. Floored at 4% so a view with a single render still draws
 * something — the bar is one of the two non-colour channels carrying this
 * number, so it may not vanish.
 */
export function heatWidth(renders, peak) {
	const n = toNumber(renders);
	const max = toNumber(peak);
	if (n <= 0 || max <= 0) return '0%';
	return `${Math.max(4, Math.min(100, Math.round((n / max) * 100)))}%`;
}

/**
 * Heat ramp class per level. The strings are LITERAL because Tailwind v4 scans
 * this file (styles.css `@source`s the app's .js) for the class names it must
 * emit — a computed `bg-heat-<level>` would produce no CSS at all.
 */
const HEAT_BAR = ['bg-line', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4'];

/** How the wasted cell is inked, by severity. */
const WASTE_TEXT = {
	none: 'text-faint',
	some: 'text-warn',
	high: 'text-danger font-semibold',
};

/** The re-render causes SPEC §55 names, in the order the tooltip prints them. */
export const CAUSE_ORDER = ['data', 'store', 'parent', 'route', 'manual', 'slot'];

/**
 * `{ data: 12, store: 3 }` → `'data 12 · store 3'`, skipping zeros.
 *
 * Causes this build does not know about are appended rather than dropped, so a
 * newer runtime's new cause is still readable here without a panel update.
 */
export function causeSummary(causes) {
	if (!causes || typeof causes !== 'object') return '';
	const parts = [];
	for (const name of CAUSE_ORDER) {
		const n = toNumber(causes[name]);
		if (n > 0) parts.push(`${name} ${formatCount(n)}`);
	}
	for (const name of Object.keys(causes)) {
		if (CAUSE_ORDER.includes(name)) continue;
		const n = toNumber(causes[name]);
		if (n > 0) parts.push(`${name} ${formatCount(n)}`);
	}
	return parts.join(' · ');
}

/** The per-view table's columns, left to right. `key` is also the sort key. */
export const PROFILE_COLUMNS = Object.freeze([
	{ key: 'name', label: 'view', numeric: false, hint: 'Sort by view name' },
	{ key: 'renders', label: 'renders', numeric: true, hint: 'Render passes' },
	{
		key: 'wasted',
		label: 'wasted',
		numeric: true,
		hint: 'Render passes that produced no DOM mutations at all — burned CPU',
	},
	{ key: 'mutations', label: 'DOM', numeric: true, hint: 'DOM mutations applied' },
	{ key: 'renderMs', label: 'render', numeric: true, hint: 'Time in the render function (ms)' },
	{ key: 'patchMs', label: 'patch', numeric: true, hint: 'Time diffing and patching the DOM (ms)' },
	{ key: 'dataMs', label: 'data', numeric: true, hint: 'Time in data() (ms)' },
]);

/** Wasted renders are the headline, so the table opens on the worst offenders. */
export const DEFAULT_PROFILE_SORT = 'wasted';
export const DEFAULT_PROFILE_DIRECTION = 'desc';

const SORT_VALUE = {
	name: (row) => row.name.toLowerCase(),
	renders: (row) => row.renders,
	wasted: (row) => row.wasted,
	mutations: (row) => row.mutations,
	renderMs: (row) => row.renderMs,
	patchMs: (row) => row.patchMs,
	dataMs: (row) => row.dataMs,
};

function compare(a, b) {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/**
 * Click behaviour for a column header: the same column toggles direction, a new
 * column adopts the direction that makes it useful — descending for "how much",
 * ascending for a name.
 */
export function nextSortState(sort, direction, key) {
	if (key === sort) {
		return { sort, direction: direction === 'asc' ? 'desc' : 'asc' };
	}
	return { sort: key, direction: key === 'name' ? 'asc' : 'desc' };
}

/**
 * Sort normalized rows, with a tiebreak chain that does NOT flip with the arrow.
 *
 * This matters more than it looks: the table is rebuilt from a fresh report
 * every poll tick, and views tie constantly (every view with zero wasted
 * renders ties on the default sort). Without a total order the rows would
 * reshuffle once a second under the reader's cursor.
 */
export function sortProfileViews(rows, key, direction) {
	const read = SORT_VALUE[key] ?? SORT_VALUE[DEFAULT_PROFILE_SORT];
	const sign = direction === 'asc' ? 1 : -1;
	return [...rows].sort((a, b) => {
		const primary = compare(read(a), read(b));
		if (primary !== 0) return primary * sign;
		if (a.wasted !== b.wasted) return b.wasted - a.wasted;
		if (a.renders !== b.renders) return b.renders - a.renders;
		const byName = compare(a.name.toLowerCase(), b.name.toLowerCase());
		if (byName !== 0) return byName;
		return compare(toNumber(a.id), toNumber(b.id));
	});
}

/** One `views[]` entry, with every counter forced to a number. */
function normalizeProfileView(view) {
	return {
		id: view.id,
		name: typeof view.name === 'string' && view.name !== '' ? view.name : 'View',
		module: typeof view.module === 'string' && view.module !== '' ? view.module : null,
		renders: toNumber(view.renders),
		wasted: toNumber(view.wastedRenders),
		mutations: toNumber(view.domMutations),
		renderMs: toNumber(view.renderMs),
		patchMs: toNumber(view.patchMs),
		dataMs: toNumber(view.dataMs),
		causes: view.causes && typeof view.causes === 'object' ? view.causes : {},
		memoHits: toNumber(view.memoHits),
		memoMisses: toNumber(view.memoMisses),
		propsBailouts: toNumber(view.propsBailouts),
		propsReruns: toNumber(view.propsReruns),
	};
}

/** The row tooltip carries the counters the table has no column for. */
function rowTitle(view, causes) {
	const identity = view.module ? `#${view.id} ${view.name} · ${view.module}` : `#${view.id} ${view.name}`;
	const detail = [
		`${formatCount(view.renders)} renders`,
		`${formatCount(view.wasted)} wasted (${formatPercent(wastedRatio(view.renders, view.wasted))})`,
		`${formatCount(view.mutations)} DOM mutations`,
	];
	if (causes) detail.push(`causes: ${causes}`);
	if (view.memoHits > 0 || view.memoMisses > 0) {
		detail.push(`memo ${formatCount(view.memoHits)} hit / ${formatCount(view.memoMisses)} miss`);
	}
	if (view.propsBailouts > 0 || view.propsReruns > 0) {
		detail.push(
			`props ${formatCount(view.propsBailouts)} bailed / ${formatCount(view.propsReruns)} rerun`
		);
	}
	return `${identity} — ${detail.join(' · ')}`;
}

/**
 * `report.views` → sorted, print-ready rows carrying their own heat.
 *
 * Heat is computed against the peak render count in THIS report, so it is
 * recomputed on every poll — a newly busy view re-scales the whole column,
 * which is the behaviour you want from a heatmap of a live session.
 */
export function profileRows(views, options = {}) {
	const {
		sort = DEFAULT_PROFILE_SORT,
		direction = DEFAULT_PROFILE_DIRECTION,
		knownIds = null,
	} = options;

	const normalized = (Array.isArray(views) ? views : [])
		.filter((view) => view && typeof view === 'object')
		.map(normalizeProfileView);

	const peak = normalized.reduce((max, view) => Math.max(max, view.renders), 0);

	return sortProfileViews(normalized, sort, direction).map((view) => {
		const waste = wasteLevel(view.renders, view.wasted);
		const causes = causeSummary(view.causes);
		// A profile can name a view that has since been destroyed. Same rule as
		// the Subscriptions panel's subscriber list: it still renders, it just is
		// not a link to somewhere that exists.
		const navigable = knownIds ? knownIds.has(view.id) : true;

		return {
			id: view.id,
			key: `perf-${view.id}`,
			name: view.name,
			module: view.module,

			renders: formatCount(view.renders),
			rendersRaw: view.renders,
			wasted: formatCount(view.wasted),
			wastedRaw: view.wasted,
			wastedPct: formatPercent(wastedRatio(view.renders, view.wasted)),
			hasWaste: view.wasted > 0,
			isHighWaste: waste === 'high',
			mutations: formatCount(view.mutations),
			renderMs: formatMs(view.renderMs),
			patchMs: formatMs(view.patchMs),
			dataMs: formatMs(view.dataMs),

			heatLevel: heatLevel(view.renders, peak),
			heatWidth: heatWidth(view.renders, peak),
			heatClass: HEAT_BAR[heatLevel(view.renders, peak)],
			// Hatching gives high waste a SECOND, non-colour channel on the same
			// bar, so the distinction survives a colour-blind reader.
			hatchClass: waste === 'high' ? 'dt-heat-hatch' : '',
			wastedClass: WASTE_TEXT[waste],

			causes,
			navigable,
			/** Dims the row's identity the way a dead subscriber is dimmed. */
			dim: !navigable,
			rowClass: navigable ? 'cursor-pointer hover:bg-raised' : 'cursor-default',
			title: navigable
				? `${rowTitle(view, causes)} — click to show in the Views panel`
				: `${rowTitle(view, causes)} — no longer mounted`,
		};
	});
}

/** Column headers with their sort state — arrow AND colour, never colour alone. */
export function profileColumns(sort, direction) {
	return PROFILE_COLUMNS.map((column) => {
		const active = column.key === sort;
		return {
			key: column.key,
			label: column.label,
			hint: column.hint,
			active,
			ariaSort: active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none',
			indicator: active ? (direction === 'asc' ? '▲' : '▼') : '',
			cls: active ? 'text-accent' : 'text-faint hover:text-ink',
			align: column.numeric ? 'text-right' : 'text-left',
		};
	});
}

/**
 * `report.totals` → the summary row, with wasted renders pulled out as the
 * headline. Everything else is a supporting tile.
 */
export function profileTotals(totals) {
	const source = totals && typeof totals === 'object' ? totals : {};
	const renders = toNumber(source.renders);
	const wasted = toNumber(source.wastedRenders);
	const ratio = wastedRatio(renders, wasted);

	return {
		wasted: formatCount(wasted),
		wastedRaw: wasted,
		wastedPct: formatPercent(ratio),
		hasWaste: wasted > 0,
		// Green when there is nothing to report: the absence of waste is a
		// result, not an empty state.
		wastedToneClass: wasted === 0 ? 'text-ok' : ratio >= WASTE_HIGH_RATIO ? 'text-danger' : 'text-warn',
		rendersRaw: renders,
		tiles: [
			{ key: 'renders', label: 'renders', value: formatCount(renders) },
			{ key: 'domMutations', label: 'DOM mutations', value: formatCount(source.domMutations) },
			{ key: 'dataRuns', label: 'data() runs', value: formatCount(source.dataRuns) },
			{ key: 'storeFlushes', label: 'store flushes', value: formatCount(source.storeFlushes) },
			{
				key: 'storeNotifications',
				label: 'notifications',
				value: formatCount(source.storeNotifications),
			},
		],
	};
}

/**
 * The profile's `notified` is a COUNT, while the `flush` event's is an array of
 * subscriber ids. Both spellings are accepted so one reader serves either.
 */
function notifiedCount(value) {
	return Array.isArray(value) ? value.length : toNumber(value);
}

/** `report.flushes` → newest-first rows for the store-side timeline. */
export function profileFlushes(flushes, limit = 20) {
	const list = Array.isArray(flushes) ? flushes : [];
	return list
		.slice(-limit)
		.reverse()
		.map((flush, index) => {
			const keys = Array.isArray(flush?.keys) ? flush.keys : [];
			const label = keys.join(', ') || 'no keys';
			const notified = notifiedCount(flush?.notified);
			return {
				key: `flush-${toNumber(flush?.at)}-${index}`,
				keys: label,
				notified: formatCount(notified),
				durationMs: formatMs(flush?.durationMs),
				title: `${label} → ${formatCount(notified)} notified in ${formatMs(flush?.durationMs)} ms`,
			};
		});
}

const WARNING_LABEL = {
	'recursive-loop': 'recursive loop',
	'runaway-rerender': 'runaway re-render',
};

/**
 * Merge the report's `warnings` with the `perf-warning` events still in the
 * ring, worst first.
 *
 * Both sources describe the same detections, and each covers a gap in the
 * other: the EVENT arrives the instant the detector fires (before the next poll,
 * and even when nothing is polling), while the REPORT is authoritative and
 * survives the event ring's 200-message cap. Deduplication is by kind + view, and
 * the higher count wins because it is simply the later observation of one
 * ongoing loop.
 *
 * `knownIds`, when given, is the set of view ids the panel still has records
 * for — a warning about a view that has since been destroyed stays visible but
 * stops being a link.
 */
export function mergeWarnings(sampleWarnings, eventWarnings, knownIds = null) {
	const byKey = new Map();

	const push = (raw) => {
		if (!raw || typeof raw !== 'object') return;
		const kind = typeof raw.kind === 'string' && raw.kind !== '' ? raw.kind : 'unknown';
		const viewId = typeof raw.viewId === 'number' ? raw.viewId : null;
		const key = `${kind}#${viewId ?? '?'}`;
		const count = toNumber(raw.count);
		const detail = raw.detail == null ? '' : String(raw.detail);

		const existing = byKey.get(key);
		if (existing) {
			if (count > existing.countRaw) {
				existing.countRaw = count;
				existing.count = formatCount(count);
			}
			if (existing.detail === '' && detail !== '') existing.detail = detail;
			return;
		}

		const name =
			typeof raw.name === 'string' && raw.name !== ''
				? raw.name
				: viewId != null
					? `#${viewId}`
					: 'unknown view';
		const navigable = viewId != null && (knownIds ? knownIds.has(viewId) : true);

		byKey.set(key, {
			key,
			kind,
			kindLabel: WARNING_LABEL[kind] ?? kind,
			viewId: navigable ? viewId : null,
			name,
			detail,
			count: formatCount(count),
			countRaw: count,
			navigable,
			rowClass: navigable ? 'cursor-pointer hover:bg-raised' : 'cursor-default',
			title: navigable
				? `${name} — click to show in the Views panel`
				: `${name} — no longer mounted`,
		});
	};

	for (const warning of Array.isArray(sampleWarnings) ? sampleWarnings : []) push(warning);
	for (const warning of Array.isArray(eventWarnings) ? eventWarnings : []) push(warning);

	// Worst first, with a total order so a re-poll cannot reshuffle equal rows.
	return [...byKey.values()].sort(
		(a, b) => b.countRaw - a.countRaw || compare(a.kind, b.kind) || compare(a.name, b.name)
	);
}
