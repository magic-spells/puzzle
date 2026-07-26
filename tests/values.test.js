import { describe, it, expect } from 'vitest';
import {
	appendHistory,
	causeSummary,
	diffRecord,
	formatCount,
	formatDuration,
	formatMs,
	formatPercent,
	heatLevel,
	heatWidth,
	mergeWarnings,
	moduleLabel,
	moduleTitle,
	nextSortState,
	profileColumns,
	profileFlushes,
	profileRows,
	profileTotals,
	subscriptionKind,
	subscriptionParts,
	viewKind,
	wasteLevel,
	wastedRatio,
} from '../panel/app/values.js';

/*
 * Unit coverage for the panel's pure projection helpers.
 *
 * These import the SOURCE module, not the compiled bundle — values.js has no
 * imports of its own, so it loads standalone. The panel-app suite proves the
 * rules reach the DOM; this suite pins the rules themselves, including the cases
 * the fixture transcript never produces.
 */

describe('viewKind', () => {
	it('reads the kind off the module path directories', () => {
		expect(viewKind('layouts/Shell.pzl')).toBe('layout');
		expect(viewKind('views/Home.pzl')).toBe('view');
		expect(viewKind('components/Row.pzl')).toBe('component');
	});

	it('finds the segment at any depth', () => {
		expect(viewKind('app/layouts/admin/Shell.pzl')).toBe('layout');
		expect(viewKind('components/ui/Badge.pzl')).toBe('component');
	});

	it('falls back to a plain view', () => {
		expect(viewKind('widgets/Thing.pzl')).toBe('view');
		expect(viewKind('Thing.pzl')).toBe('view');
		// A hand-written class carries no module stamp at all.
		expect(viewKind(null)).toBe('view');
		expect(viewKind(undefined)).toBe('view');
		expect(viewKind('')).toBe('view');
	});

	it('only considers DIRECTORY segments, never the filename', () => {
		// A view whose FILE is named components.pzl is still a view.
		expect(viewKind('views/components.pzl')).toBe('view');
		expect(viewKind('views/layouts.pzl')).toBe('view');
	});

	it('prefers layout when a path could read as both', () => {
		expect(viewKind('layouts/components/Odd.pzl')).toBe('layout');
	});
});

describe('moduleLabel', () => {
	it('drops the path entirely when the basename just repeats the name', () => {
		// The redundancy this whole rule exists for: "MainLayout MainLayout.pzl".
		expect(moduleLabel('MainLayout', 'layouts/MainLayout.pzl')).toBe('');
		expect(moduleLabel('Home', 'views/Home.pzl')).toBe('');
		expect(moduleLabel('Badge', 'components/ui/Badge.pzl')).toBe('');
	});

	it('shows the basename only when it adds information', () => {
		expect(moduleLabel('FixtureLayout', 'layouts/Fixture.pzl')).toBe('Fixture.pzl');
		expect(moduleLabel('TodoRow', 'components/Row.pzl')).toBe('Row.pzl');
	});

	it('never shows a directory, however deep', () => {
		expect(moduleLabel('Thing', 'app/components/deeply/nested/Other.pzl')).toBe('Other.pzl');
	});

	it('is empty when there is no module', () => {
		expect(moduleLabel('Anon', null)).toBe('');
		expect(moduleLabel('Anon', undefined)).toBe('');
		expect(moduleLabel('Anon', '')).toBe('');
	});

	it('is case- and extension-exact', () => {
		// Only an exact `<Name>.pzl` match is redundant.
		expect(moduleLabel('Home', 'views/home.pzl')).toBe('home.pzl');
		expect(moduleLabel('Home', 'views/HomePage.pzl')).toBe('HomePage.pzl');
	});
});

describe('moduleTitle', () => {
	it('always carries the FULL path, even when the row hides it', () => {
		expect(moduleTitle('MainLayout', 'layouts/MainLayout.pzl')).toBe('layouts/MainLayout.pzl');
		expect(moduleTitle('FixtureLayout', 'layouts/Fixture.pzl')).toBe('layouts/Fixture.pzl');
	});

	it('falls back to the name when there is no module', () => {
		expect(moduleTitle('Anon', null)).toBe('Anon');
		expect(moduleTitle('Anon', '')).toBe('Anon');
	});
});

describe('subscriptionKind / subscriptionParts', () => {
	/*
	 * The separator is a SPACE, not a colon. The runtime builds record keys as
	 * `type + REC_SEP + id` with REC_SEP = ' ' (client-runtime/datastore/store.js,
	 * "never appears in a type name"), and the bridge forwards keys verbatim — so
	 * a live key is 'todo t2'. These tests exist to keep that pinned: a colon
	 * form would silently file every record subscription under Collections.
	 */
	it('treats a key with no space as a collection key', () => {
		expect(subscriptionKind('todo')).toBe('collection');
		expect(subscriptionKind('user')).toBe('collection');
		expect(subscriptionParts('todo')).toEqual({ type: 'todo', id: null, kind: 'collection' });
	});

	it('treats `type id` as a record key, splitting on the FIRST space', () => {
		expect(subscriptionKind('todo t2')).toBe('record');
		expect(subscriptionParts('todo t2')).toEqual({ type: 'todo', id: 't2', kind: 'record' });
	});

	it('does not treat a colon as a separator — that is not the runtime scheme', () => {
		// 'todo:t2' has no space, so it is a (weirdly named) COLLECTION key.
		expect(subscriptionKind('todo:t2')).toBe('collection');
		expect(subscriptionParts('todo:t2').type).toBe('todo:t2');
	});

	it('keeps a pk that contains spaces intact', () => {
		// Split once: the type cannot contain a space, but an id can.
		expect(subscriptionParts('todo my id 7')).toEqual({
			type: 'todo',
			id: 'my id 7',
			kind: 'record',
		});
		expect(subscriptionParts('todo a:b')).toEqual({ type: 'todo', id: 'a:b', kind: 'record' });
	});
});

describe('diffRecord', () => {
	it('reports changed fields with their old and new values', () => {
		const changes = diffRecord(
			{ id: 't1', text: 'old', priority: 1 },
			{ id: 't1', text: 'new', priority: 2 }
		);
		expect(changes).toEqual([
			{ field: 'text', from: 'old', to: 'new' },
			{ field: 'priority', from: 1, to: 2 },
		]);
	});

	it('reports added and removed fields', () => {
		expect(diffRecord({ id: 't1' }, { id: 't1', note: 'hi' })).toEqual([
			{ field: 'note', from: undefined, to: 'hi' },
		]);
		expect(diffRecord({ id: 't1', note: 'hi' }, { id: 't1' })).toEqual([
			{ field: 'note', from: 'hi', to: undefined },
		]);
	});

	it('returns nothing when the snapshot is unchanged', () => {
		const row = { id: 't1', text: 'same', completed: false, priority: 3 };
		expect(diffRecord(row, { ...row })).toEqual([]);
	});

	it('ignores _synced, which the bridge synthesizes per snapshot', () => {
		expect(diffRecord({ id: 't1', _synced: false }, { id: 't1', _synced: true })).toEqual([]);
	});

	it('compares structures by value, not identity', () => {
		// Snapshots are re-serialized every flush, so a fresh array with the same
		// contents must not read as a change.
		expect(diffRecord({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([]);
		expect(diffRecord({ tags: ['a'] }, { tags: ['a', 'b'] })).toHaveLength(1);
	});

	it('treats NaN as unchanged and distinguishes false from 0', () => {
		expect(diffRecord({ n: NaN }, { n: NaN })).toEqual([]);
		expect(diffRecord({ n: 0 }, { n: false })).toEqual([{ field: 'n', from: 0, to: false }]);
	});

	it('tolerates a missing side', () => {
		expect(diffRecord(null, { id: 't1' })).toEqual([{ field: 'id', from: undefined, to: 't1' }]);
		expect(diffRecord({ id: 't1' }, null)).toEqual([{ field: 'id', from: 't1', to: undefined }]);
		expect(diffRecord(null, null)).toEqual([]);
	});

	it('keeps previous-field order, then appends new keys', () => {
		const changes = diffRecord({ b: 1, a: 1 }, { b: 2, a: 2, c: 3 });
		expect(changes.map((c) => c.field)).toEqual(['b', 'a', 'c']);
	});
});

describe('appendHistory', () => {
	it('prepends newest-first and stamps each entry', () => {
		const first = appendHistory([], [{ field: 'text', from: 'a', to: 'b' }], 100);
		const second = appendHistory(first, [{ field: 'text', from: 'b', to: 'c' }], 200);

		expect(second).toHaveLength(2);
		expect(second[0]).toEqual({ field: 'text', from: 'b', to: 'c', at: 200 });
		expect(second[1]).toEqual({ field: 'text', from: 'a', to: 'b', at: 100 });
	});

	it('returns the SAME array when there is nothing to add', () => {
		const history = [{ field: 'x', from: 1, to: 2, at: 1 }];
		expect(appendHistory(history, [], 5)).toBe(history);
		expect(appendHistory(history, null, 5)).toBe(history);
	});

	it('trims the oldest past the cap', () => {
		let history = [];
		for (let i = 0; i < 35; i++) {
			history = appendHistory(history, [{ field: 'n', from: i, to: i + 1 }], i, 30);
		}
		expect(history).toHaveLength(30);
		expect(history[0].from).toBe(34); // newest kept
		expect(history[29].from).toBe(5); // oldest five dropped
	});

	it('keeps every change from one flush, in order', () => {
		const history = appendHistory(
			[],
			[
				{ field: 'text', from: 'a', to: 'b' },
				{ field: 'priority', from: 1, to: 2 },
			],
			50
		);
		expect(history.map((h) => h.field)).toEqual(['text', 'priority']);
	});
});

/* ========================================================================== */
/* Profiler projections                                                        */
/* ========================================================================== */

/*
 * The runtime half of the profiler ships separately from this extension, so
 * every reader below has to survive a report from a build that predates a
 * counter it names. "Missing counter renders as zero, never NaN" is the rule
 * these tests exist to hold.
 */

describe('profiler number formatting', () => {
	it('groups counts without depending on the machine locale', () => {
		expect(formatCount(0)).toBe('0');
		expect(formatCount(42)).toBe('42');
		expect(formatCount(1234)).toBe('1,234');
		expect(formatCount(1234567)).toBe('1,234,567');
	});

	it('reads a missing or junk count as zero', () => {
		expect(formatCount(undefined)).toBe('0');
		expect(formatCount(null)).toBe('0');
		expect(formatCount(NaN)).toBe('0');
		expect(formatCount('nonsense')).toBe('0');
		expect(formatCount(Infinity)).toBe('0');
	});

	it('keeps one decimal where per-view timings actually live', () => {
		expect(formatMs(0)).toBe('0');
		expect(formatMs(0.42)).toBe('0.4');
		expect(formatMs(12.35)).toBe('12.3');
		expect(formatMs(99.9)).toBe('99.9');
		// Past 100ms the decimal is noise and the column would jitter wider.
		expect(formatMs(1234.6)).toBe('1,235');
	});

	it('prints elapsed time as seconds, then m:ss', () => {
		expect(formatDuration(0)).toBe('0.0s');
		expect(formatDuration(4200)).toBe('4.2s');
		expect(formatDuration(59999)).toBe('60.0s');
		expect(formatDuration(60000)).toBe('1:00');
		expect(formatDuration(125000)).toBe('2:05');
	});

	it('never rounds a real percentage down to nothing', () => {
		expect(formatPercent(0)).toBe('0%');
		expect(formatPercent(0.5)).toBe('50%');
		expect(formatPercent(1)).toBe('100%');
		// "a little waste" and "no waste" are different answers.
		expect(formatPercent(0.004)).toBe('<1%');
	});
});

describe('wastedRatio / wasteLevel', () => {
	it('is the share of renders that changed no DOM', () => {
		expect(wastedRatio(10, 3)).toBeCloseTo(0.3);
		expect(wastedRatio(0, 0)).toBe(0);
		expect(wastedRatio(10, 0)).toBe(0);
	});

	it('clamps a counter race rather than reporting 140%', () => {
		expect(wastedRatio(5, 7)).toBe(1);
	});

	it('calls out sustained waste, not an unlucky two renders', () => {
		expect(wasteLevel(10, 0)).toBe('none');
		expect(wasteLevel(10, 1)).toBe('some');
		// 50% wasted, but only one wasted render — noise, not a finding.
		expect(wasteLevel(2, 1)).toBe('some');
		expect(wasteLevel(8, 6)).toBe('high');
		expect(wasteLevel(24, 21)).toBe('high');
	});
});

describe('heatLevel / heatWidth', () => {
	it('buckets by share of the busiest view in the same report', () => {
		expect(heatLevel(100, 100)).toBe(4);
		expect(heatLevel(80, 100)).toBe(4);
		expect(heatLevel(60, 100)).toBe(3);
		expect(heatLevel(40, 100)).toBe(2);
		expect(heatLevel(5, 100)).toBe(1);
		expect(heatLevel(0, 100)).toBe(0);
	});

	it('is relative, so the same count is hot or cold depending on its company', () => {
		expect(heatLevel(10, 10)).toBe(4);
		expect(heatLevel(10, 1000)).toBe(1);
	});

	it('has no heat when nothing rendered at all', () => {
		expect(heatLevel(0, 0)).toBe(0);
		expect(heatWidth(0, 0)).toBe('0%');
	});

	it('never lets a non-zero bar vanish — it is a signal, not decoration', () => {
		expect(heatWidth(100, 100)).toBe('100%');
		expect(heatWidth(50, 100)).toBe('50%');
		expect(heatWidth(1, 1000)).toBe('4%');
	});
});

describe('causeSummary', () => {
	it('prints the causes that fired, in SPEC order, skipping zeros', () => {
		expect(causeSummary({ store: 18, data: 5, parent: 6, route: 0 })).toBe(
			'data 5 · store 18 · parent 6'
		);
	});

	it('is empty when nothing is attributed', () => {
		expect(causeSummary({})).toBe('');
		expect(causeSummary({ data: 0, store: 0 })).toBe('');
		expect(causeSummary(null)).toBe('');
		expect(causeSummary('nope')).toBe('');
	});

	it('still shows a cause this build predates', () => {
		// Forward compatibility: a newer runtime's new cause is appended, not lost.
		expect(causeSummary({ data: 2, teleport: 9 })).toBe('data 2 · teleport 9');
	});
});

describe('nextSortState', () => {
	it('toggles direction when the same column is clicked again', () => {
		expect(nextSortState('wasted', 'desc', 'wasted')).toEqual({ sort: 'wasted', direction: 'asc' });
		expect(nextSortState('wasted', 'asc', 'wasted')).toEqual({ sort: 'wasted', direction: 'desc' });
	});

	it('opens a new numeric column at its useful end', () => {
		expect(nextSortState('wasted', 'asc', 'renders')).toEqual({
			sort: 'renders',
			direction: 'desc',
		});
	});

	it('opens the name column ascending, because that is what a name sort means', () => {
		expect(nextSortState('wasted', 'desc', 'name')).toEqual({ sort: 'name', direction: 'asc' });
	});
});

describe('profileRows', () => {
	const VIEWS = [
		{
			id: 1,
			name: 'Layout',
			module: 'layouts/Shell.pzl',
			renders: 2,
			wastedRenders: 0,
			domMutations: 3,
			renderMs: 0.8,
			patchMs: 0.6,
			dataMs: 0.4,
			causes: { route: 2 },
		},
		{
			id: 3,
			name: 'Row',
			module: 'components/Row.pzl',
			renders: 24,
			wastedRenders: 21,
			domMutations: 2,
			renderMs: 74.4,
			patchMs: 62.4,
			dataMs: 28.8,
			causes: { store: 18, parent: 6 },
			memoHits: 2,
			memoMisses: 22,
		},
		{
			id: 2,
			name: 'Home',
			module: 'views/Home.pzl',
			renders: 9,
			wastedRenders: 2,
			domMutations: 14,
			renderMs: 17.1,
			patchMs: 12.6,
			dataMs: 8.1,
			causes: { data: 5, store: 3 },
		},
	];

	it('defaults to worst-waste-first — the headline metric leads the table', () => {
		const rows = profileRows(VIEWS);
		expect(rows.map((row) => row.id)).toEqual([3, 2, 1]);
		expect(rows[0].wasted).toBe('21');
		expect(rows[0].wastedPct).toBe('88%');
	});

	it('sorts by any column, in both directions', () => {
		expect(profileRows(VIEWS, { sort: 'renders', direction: 'asc' }).map((r) => r.id)).toEqual([
			1, 2, 3,
		]);
		expect(profileRows(VIEWS, { sort: 'mutations', direction: 'desc' }).map((r) => r.id)).toEqual([
			2, 1, 3,
		]);
		expect(profileRows(VIEWS, { sort: 'name', direction: 'asc' }).map((r) => r.name)).toEqual([
			'Home',
			'Layout',
			'Row',
		]);
	});

	it('breaks ties the SAME way in both directions', () => {
		// The table is rebuilt from a fresh report once a second, and every view
		// with zero wasted renders ties on the default sort. Without a total order
		// the rows would reshuffle under the reader's cursor.
		const tied = [
			{ id: 5, name: 'Bravo', renders: 4, wastedRenders: 0 },
			{ id: 4, name: 'Alpha', renders: 4, wastedRenders: 0 },
			{ id: 6, name: 'Alpha', renders: 4, wastedRenders: 0 },
		];
		const desc = profileRows(tied, { sort: 'wasted', direction: 'desc' }).map((r) => r.id);
		const asc = profileRows(tied, { sort: 'wasted', direction: 'asc' }).map((r) => r.id);
		expect(desc).toEqual([4, 6, 5]);
		expect(asc).toEqual([4, 6, 5]);
	});

	it('is stable across repeated projections of the same report', () => {
		const once = profileRows(VIEWS).map((r) => r.id);
		const twice = profileRows(VIEWS).map((r) => r.id);
		expect(twice).toEqual(once);
	});

	it('scales heat against the busiest view in the report', () => {
		const rows = profileRows(VIEWS, { sort: 'renders', direction: 'desc' });
		expect(rows[0].heatLevel).toBe(4); // 24 of 24
		expect(rows[0].heatWidth).toBe('100%');
		expect(rows[0].heatClass).toBe('bg-heat-4');
		expect(rows[1].heatLevel).toBe(2); // 9 of 24 → 38%
		expect(rows[2].heatLevel).toBe(1); // 2 of 24 → 8%
	});

	it('gives high waste a second, non-colour channel', () => {
		const rows = profileRows(VIEWS);
		// Hatching, so the "hot" and "hot AND wasteful" cases are not one hue axis.
		expect(rows[0].isHighWaste).toBe(true);
		expect(rows[0].hatchClass).toBe('dt-heat-hatch');
		expect(rows[0].wastedClass).toContain('text-danger');

		const clean = rows.find((row) => row.id === 1);
		expect(clean.isHighWaste).toBe(false);
		expect(clean.hatchClass).toBe('');
	});

	it('carries the counters the table has no column for in the row title', () => {
		const row = profileRows(VIEWS).find((r) => r.id === 3);
		expect(row.title).toContain('#3 Row');
		expect(row.title).toContain('components/Row.pzl');
		expect(row.title).toContain('24 renders');
		expect(row.title).toContain('21 wasted (88%)');
		expect(row.title).toContain('causes: store 18 · parent 6');
		expect(row.title).toContain('memo 2 hit / 22 miss');
	});

	it('renders a view the profile names but the panel no longer knows', () => {
		const rows = profileRows(VIEWS, { knownIds: new Set([1, 2]) });
		const gone = rows.find((row) => row.id === 3);
		expect(gone.navigable).toBe(false);
		expect(gone.dim).toBe(true);
		expect(gone.rowClass).toContain('cursor-default');
		expect(gone.title).toContain('no longer mounted');

		const live = rows.find((row) => row.id === 1);
		expect(live.navigable).toBe(true);
		expect(live.title).toContain('click to show in the Views panel');
	});

	it('survives a report missing every counter it names', () => {
		const [row] = profileRows([{ id: 9 }]);
		expect(row.renders).toBe('0');
		expect(row.wasted).toBe('0');
		expect(row.renderMs).toBe('0');
		expect(row.name).toBe('View');
		expect(row.module).toBeNull();
		expect(row.heatLevel).toBe(0);
		expect(row.causes).toBe('');
	});

	it('tolerates a missing or malformed views array', () => {
		expect(profileRows(undefined)).toEqual([]);
		expect(profileRows(null)).toEqual([]);
		expect(profileRows('nope')).toEqual([]);
		expect(profileRows([null, 'junk', 7])).toEqual([]);
	});
});

describe('profileColumns', () => {
	it('marks the active column with an arrow as well as a colour', () => {
		const columns = profileColumns('wasted', 'desc');
		const wasted = columns.find((column) => column.key === 'wasted');
		const renders = columns.find((column) => column.key === 'renders');

		expect(wasted.active).toBe(true);
		expect(wasted.ariaSort).toBe('descending');
		// A greyscale screenshot still has to show which column is sorted.
		expect(wasted.indicator).toBe('▼');
		expect(renders.active).toBe(false);
		expect(renders.ariaSort).toBe('none');
		expect(renders.indicator).toBe('');
	});

	it('flips the arrow with the direction', () => {
		const wasted = profileColumns('wasted', 'asc').find((c) => c.key === 'wasted');
		expect(wasted.indicator).toBe('▲');
		expect(wasted.ariaSort).toBe('ascending');
	});

	it('right-aligns the numeric columns and left-aligns the name', () => {
		const columns = profileColumns('wasted', 'desc');
		expect(columns[0].key).toBe('name');
		expect(columns[0].align).toBe('text-left');
		expect(columns.slice(1).every((column) => column.align === 'text-right')).toBe(true);
	});
});

describe('profileTotals', () => {
	it('pulls wasted renders out as the headline, with its share', () => {
		const totals = profileTotals({
			renders: 100,
			wastedRenders: 60,
			domMutations: 40,
			dataRuns: 55,
			storeFlushes: 12,
			storeNotifications: 30,
		});

		expect(totals.wasted).toBe('60');
		expect(totals.wastedPct).toBe('60%');
		expect(totals.hasWaste).toBe(true);
		expect(totals.wastedToneClass).toBe('text-danger');
		expect(totals.tiles.map((tile) => tile.key)).toEqual([
			'renders',
			'domMutations',
			'dataRuns',
			'storeFlushes',
			'storeNotifications',
		]);
		expect(totals.tiles[0].value).toBe('100');
	});

	it('reads no waste as a RESULT, not as an empty state', () => {
		const totals = profileTotals({ renders: 40, wastedRenders: 0 });
		expect(totals.wasted).toBe('0');
		expect(totals.hasWaste).toBe(false);
		expect(totals.wastedToneClass).toBe('text-ok');
	});

	it('warns before it alarms', () => {
		expect(profileTotals({ renders: 100, wastedRenders: 10 }).wastedToneClass).toBe('text-warn');
	});

	it('renders zeros for a missing totals object', () => {
		const totals = profileTotals(undefined);
		expect(totals.wasted).toBe('0');
		expect(totals.tiles.every((tile) => tile.value === '0')).toBe(true);
	});
});

describe('profileFlushes', () => {
	it('lists newest first with the keys that fired', () => {
		const rows = profileFlushes([
			{ at: 1, keys: ['todo'], notified: 2, durationMs: 0.7 },
			{ at: 2, keys: ['todo', 'todo t2'], notified: 3, durationMs: 1.25 },
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].keys).toBe('todo, todo t2');
		expect(rows[0].notified).toBe('3');
		expect(rows[0].durationMs).toBe('1.3');
	});

	it('accepts notified as a COUNT or as the event-shaped id list', () => {
		// The profile reports a number; the `flush` event sends subscriber ids.
		expect(profileFlushes([{ keys: ['a'], notified: 4 }])[0].notified).toBe('4');
		expect(profileFlushes([{ keys: ['a'], notified: [2, 3, 'fn'] }])[0].notified).toBe('3');
	});

	it('says so when a flush named no keys', () => {
		expect(profileFlushes([{ keys: [] }])[0].keys).toBe('no keys');
		expect(profileFlushes([{}])[0].keys).toBe('no keys');
	});

	it('caps the list and tolerates a missing array', () => {
		const many = Array.from({ length: 50 }, (_, i) => ({ at: i, keys: [`k${i}`], notified: 1 }));
		const rows = profileFlushes(many, 20);
		expect(rows).toHaveLength(20);
		expect(rows[0].keys).toBe('k49'); // newest kept
		expect(profileFlushes(undefined)).toEqual([]);
	});
});

describe('mergeWarnings', () => {
	it('merges the report and the live events into one list', () => {
		const merged = mergeWarnings(
			[{ kind: 'runaway-rerender', viewId: 3, name: 'Row', detail: 'no DOM change', count: 4 }],
			[{ kind: 'recursive-loop', viewId: 5, name: 'Filters', detail: 'writes its own key', count: 1 }]
		);
		expect(merged.map((w) => w.kind)).toEqual(['runaway-rerender', 'recursive-loop']);
		expect(merged[0].count).toBe('4');
	});

	it('deduplicates one ongoing loop reported by both sources', () => {
		// Same detection, seen twice: the event fired at count 2, the later report
		// says 7. That is one row, not two, and the higher count is the truth.
		const merged = mergeWarnings(
			[{ kind: 'runaway-rerender', viewId: 3, name: 'Row', count: 7 }],
			[{ kind: 'runaway-rerender', viewId: 3, name: 'Row', count: 2 }]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].count).toBe('7');
	});

	it('takes a detail from whichever source carried one', () => {
		const merged = mergeWarnings(
			[{ kind: 'runaway-rerender', viewId: 3, count: 5 }],
			[{ kind: 'runaway-rerender', viewId: 3, count: 1, detail: 'rendered 40 times' }]
		);
		expect(merged[0].detail).toBe('rendered 40 times');
	});

	it('orders worst first, with a total order so a re-poll cannot reshuffle', () => {
		const merged = mergeWarnings(
			[
				{ kind: 'runaway-rerender', viewId: 1, name: 'A', count: 2 },
				{ kind: 'recursive-loop', viewId: 2, name: 'B', count: 9 },
				{ kind: 'runaway-rerender', viewId: 3, name: 'C', count: 2 },
			],
			[]
		);
		expect(merged.map((w) => w.name)).toEqual(['B', 'A', 'C']);
	});

	it('humanizes the kinds it knows and passes through the ones it does not', () => {
		const merged = mergeWarnings(
			[
				{ kind: 'recursive-loop', viewId: 1, count: 1 },
				{ kind: 'something-new', viewId: 2, count: 1 },
			],
			[]
		);
		expect(merged.find((w) => w.kind === 'recursive-loop').kindLabel).toBe('recursive loop');
		expect(merged.find((w) => w.kind === 'something-new').kindLabel).toBe('something-new');
	});

	it('keeps a warning about a destroyed view visible but unlinked', () => {
		const merged = mergeWarnings(
			[{ kind: 'runaway-rerender', viewId: 3, name: 'Row', count: 4 }],
			[],
			new Set([1, 2])
		);
		expect(merged[0].navigable).toBe(false);
		expect(merged[0].viewId).toBeNull();
		expect(merged[0].title).toContain('no longer mounted');
	});

	it('falls back to the id, then to a placeholder, when there is no name', () => {
		const merged = mergeWarnings(
			[
				{ kind: 'runaway-rerender', viewId: 7, count: 1 },
				{ kind: 'recursive-loop', count: 1 },
			],
			[]
		);
		expect(merged.find((w) => w.kind === 'runaway-rerender').name).toBe('#7');
		expect(merged.find((w) => w.kind === 'recursive-loop').name).toBe('unknown view');
	});

	it('ignores junk from either side', () => {
		expect(mergeWarnings(null, null)).toEqual([]);
		expect(mergeWarnings([null, 'nope', 7], undefined)).toEqual([]);
	});
});
